"""Administration: manage who can sign in, and as what (LHC / UHC / Administration).

- LHCs sign in with their own student email; Administration can correct email, roll number, house
  and region.
- UHC seats have fixed position emails (e.g. sundarbans.secretary@…) that pass to each newly elected
  member: hand a seat over by changing the holder's name and roll number — the email stays.
- Access can be turned off without deleting anyone (their meetups and claims stay intact).
- Bulk changes come from a CSV/Excel file: preview first, then apply. Rows match an existing person by
  the `ID` column (from the export) or by email; anything else is a new person.
"""
import csv
import io
import re
import uuid

from flask import Blueprint, Response, abort, jsonify, request

from ..auth import current_user, login_required
from ..db import get_db, one, rows, utcnow
from ..importers import ImportError_, read_table
from .common import EMAIL_RE

bp = Blueprint('people', __name__, url_prefix='/api/admin/people')

ROLES = {'LHC': 'LHC', 'UHC': 'UHC', 'ADMINISTRATION': 'ADMINISTRATION', 'ADMIN': 'ADMINISTRATION',
         'MANAGEMENT': 'ADMINISTRATION'}  # accept the old label in older spreadsheets
ROLL_RE = re.compile(r'^\d{2}[a-z]{1,2}\d{5,8}$')
FIELDS = ('name', 'email', 'roll_number', 'house_id', 'region_id', 'title', 'is_active')

SELECT = '''
    SELECT u.id, u.name, u.email, u.role, u.title, u.roll_number, u.is_active, u.updated_at,
           u.house_id, h.name AS house_name, h.slug AS house_slug, u.region_id, r.name AS region_name, r.code AS region_code,
           (SELECT COUNT(*) FROM meetups m WHERE m.proposer_id = u.id AND m.status <> 'DRAFT') AS meetups
    FROM users u LEFT JOIN houses h ON h.id = u.house_id LEFT JOIN regions r ON r.id = u.region_id
'''


class RowError(ValueError):
    pass


def _lookups():
    db = get_db()
    houses = {}
    for h in db.execute('SELECT id, slug, name FROM houses'):
        houses[h['slug'].lower()] = h['id']
        houses[h['name'].lower()] = h['id']
        houses[str(h['id'])] = h['id']
    regions = {}
    for r in db.execute('SELECT id, code, name FROM regions'):
        regions[r['code'].lower()] = r['id']
        regions[r['name'].lower()] = r['id']
        regions[r['name'].lower().replace(' ncr', '')] = r['id']
        regions[str(r['id'])] = r['id']
    return houses, regions


def normalise(data, existing=None, lookups=None):
    """Validate one person (create when existing is None) → dict of FIELDS (+ role). Raises RowError."""
    houses, regions = lookups or _lookups()
    role = existing['role'] if existing else ROLES.get(str(data.get('role') or '').strip().upper())
    if not role:
        raise RowError('Role must be LHC, UHC or Administration.')
    if existing and data.get('role') and ROLES.get(str(data['role']).strip().upper()) not in (None, role):
        raise RowError("Role can't be changed — add a new person instead.")

    def pick(key):
        return data[key] if key in data and data[key] not in (None,) else (existing or {}).get(key)

    name = str(pick('name') or '').strip()
    if not 2 <= len(name) <= 120:
        raise RowError('Name is required.')
    email = str(pick('email') or '').strip().lower()
    if not EMAIL_RE.match(email) or not email.endswith('iitm.ac.in'):
        raise RowError(f'Email "{email}" must be an IIT Madras address (…iitm.ac.in).')
    roll = str(pick('roll_number') or '').strip().lower() or None
    if role in ('LHC', 'UHC') and not roll:
        raise RowError('Roll number is required.')
    if roll and not ROLL_RE.match(roll):
        raise RowError(f'Roll number "{roll}" should look like 23f1000123.')

    house_raw = pick('house_id') if 'house_id' in data or existing else data.get('house')
    house_raw = data.get('house', house_raw) if 'house' in data else house_raw
    house_id = houses.get(str(house_raw).strip().lower()) if house_raw not in (None, '') else None
    region_raw = data.get('region') if 'region' in data else pick('region_id')
    region_id = regions.get(str(region_raw).strip().lower()) if region_raw not in (None, '') else None
    if role in ('LHC', 'UHC') and not house_id:
        raise RowError(f'House "{house_raw or ""}" not recognised.')
    if role == 'LHC' and not region_id:
        raise RowError(f'Region "{region_raw or ""}" not recognised.')
    if role == 'UHC':
        region_id = None
    if role == 'ADMINISTRATION':
        house_id = region_id = None

    title = str(pick('title') or '').strip() or None
    if role == 'UHC' and not title:
        raise RowError('UHC position is required (e.g. Secretary).')
    if role == 'LHC':
        title = None

    active_raw = pick('is_active')
    if isinstance(active_raw, str):
        active = 0 if active_raw.strip().lower() in ('0', 'no', 'false', 'off', 'n', 'disabled', 'inactive') else 1
    else:
        active = 0 if active_raw in (0, False) else 1
    return {'role': role, 'name': name, 'email': email, 'roll_number': roll, 'house_id': house_id,
            'region_id': region_id, 'title': title, 'is_active': active}


def _check_unique(rec, self_id=None):
    db = get_db()
    clash = db.execute('SELECT name FROM users WHERE email = ? AND id IS NOT ?', (rec['email'], self_id)).fetchone()
    if clash:
        raise RowError(f'{rec["email"]} is already used by {clash[0]}.')
    if rec['roll_number']:
        clash = db.execute('SELECT name FROM users WHERE roll_number = ? AND id IS NOT ?', (rec['roll_number'], self_id)).fetchone()
        if clash:
            raise RowError(f'Roll number {rec["roll_number"]} is already used by {clash[0]}.')


def _guard_self(existing, rec):
    me = current_user()
    if existing and existing['id'] == me['id'] and not rec['is_active']:
        raise RowError("You can't turn off your own access.")


def _write(rec, existing=None):
    db = get_db()
    now = utcnow()
    values = [rec[f] for f in FIELDS]
    if existing:
        db.execute(f"UPDATE users SET {', '.join(f'{f} = ?' for f in FIELDS)}, updated_at = ? WHERE id = ?",
                   [*values, now, existing['id']])
        return existing['id']
    prefix = {'LHC': 'lhc', 'UHC': 'uhc', 'ADMINISTRATION': 'admin'}[rec['role']]
    uid = f'{prefix}-{uuid.uuid4().hex[:8]}'
    db.execute(f"INSERT INTO users (id, role, {', '.join(FIELDS)}, updated_at) VALUES (?, ?, {', '.join('?' * len(FIELDS))}, ?)",
               [uid, rec['role'], *values, now])
    return uid


def _get(uid):
    return one(get_db().execute(SELECT + ' WHERE u.id = ?', (uid,)).fetchone())


def _fail(e):
    abort(400, str(e))


# ── List / single edits ─────────────────────────────────────────────────────

@bp.get('')
@login_required('ADMINISTRATION')
def index():
    where, params = ['1=1'], []
    if request.args.get('role'):
        where.append('u.role = ?')
        params.append(request.args['role'])
    for key in ('house_id', 'region_id'):
        if request.args.get(key):
            where.append(f'u.{key} = ?')
            params.append(request.args[key])
    if request.args.get('active') in ('0', '1'):
        where.append('u.is_active = ?')
        params.append(int(request.args['active']))
    q = (request.args.get('q') or '').strip()
    if q:
        where.append('(u.name LIKE ? OR u.email LIKE ? OR u.roll_number LIKE ?)')
        params += [f'%{q}%'] * 3
    people = rows(get_db().execute(f"{SELECT} WHERE {' AND '.join(where)} ORDER BY h.name, r.id, u.title, u.name", params))
    counts = {r['role']: r['n'] for r in get_db().execute('SELECT role, COUNT(*) AS n FROM users GROUP BY role')}
    counts['inactive'] = get_db().execute('SELECT COUNT(*) FROM users WHERE is_active = 0').fetchone()[0]
    return jsonify(people=people, counts=counts)


@bp.post('')
@login_required('ADMINISTRATION')
def create():
    try:
        rec = normalise(request.get_json(silent=True) or {})
        _check_unique(rec)
    except RowError as e:
        _fail(e)
    uid = _write(rec)
    get_db().commit()
    return jsonify(person=_get(uid)), 201


@bp.put('/<uid>')
@login_required('ADMINISTRATION')
def update(uid):
    existing = one(get_db().execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone())
    if not existing:
        abort(404, 'No such person.')
    try:
        rec = normalise(request.get_json(silent=True) or {}, existing)
        _check_unique(rec, uid)
        _guard_self(existing, rec)
    except RowError as e:
        _fail(e)
    _write(rec, existing)
    get_db().commit()
    return jsonify(person=_get(uid))


# ── Bulk: export, preview, apply ────────────────────────────────────────────

HEADER = ['ID', 'Role', 'Name', 'Email', 'Roll number', 'House', 'Region', 'Position', 'Access']
ALIASES = {
    'id': 'id', 'user id': 'id', 'role': 'role', 'name': 'name', 'full name': 'name', 'student name': 'name',
    'email': 'email', 'email id': 'email', 'mail': 'email', 'email address': 'email',
    'roll': 'roll_number', 'roll number': 'roll_number', 'roll no': 'roll_number', 'roll no.': 'roll_number', 'roll_number': 'roll_number',
    'house': 'house', 'region': 'region', 'position': 'title', 'title': 'title', 'designation': 'title',
    'access': 'is_active', 'active': 'is_active', 'status': 'is_active',
}


@bp.get('/export.csv')
@login_required('ADMINISTRATION')
def export():
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(HEADER)
    label = {'LHC': 'LHC', 'UHC': 'UHC', 'ADMINISTRATION': 'Administration'}
    for p in get_db().execute(SELECT + " ORDER BY CASE u.role WHEN 'ADMINISTRATION' THEN 0 WHEN 'UHC' THEN 1 ELSE 2 END, h.name, r.id, u.name"):
        w.writerow([p['id'], label[p['role']], p['name'], p['email'], p['roll_number'] or '', p['house_name'] or '',
                    p['region_name'] or '', p['title'] or '', 'On' if p['is_active'] else 'Off'])
    return Response('﻿' + out.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': 'attachment; filename="meetup-planner-people.csv"'})


def _plan(records):
    """records: list of (line, dict). → list of preview rows with action/changes/error and the record to apply."""
    db = get_db()
    lookups = _lookups()
    by_id = {r['id']: dict(r) for r in db.execute('SELECT * FROM users')}
    by_email = {u['email']: u for u in by_id.values()}
    house_names = {r['id']: r['name'] for r in db.execute('SELECT id, name FROM houses')}
    region_names = {r['id']: r['name'] for r in db.execute('SELECT id, name FROM regions')}
    seen_emails, seen_rolls, plan = set(), set(), []
    for line, data in records:
        row = {'line': line, 'name': data.get('name') or '', 'email': (data.get('email') or '').lower()}
        try:
            existing = by_id.get(str(data.get('id') or '').strip()) or by_email.get(row['email'])
            if data.get('id') and not by_id.get(str(data['id']).strip()):
                raise RowError(f'ID "{data["id"]}" not found. Leave ID empty to add a new person.')
            rec = normalise(data, existing, lookups)
            if rec['email'] in seen_emails:
                raise RowError('Same email appears twice in the file.')
            if rec['roll_number'] and rec['roll_number'] in seen_rolls:
                raise RowError('Same roll number appears twice in the file.')
            seen_emails.add(rec['email'])
            if rec['roll_number']:
                seen_rolls.add(rec['roll_number'])
            _check_unique(rec, existing['id'] if existing else None)
            if existing:
                _guard_self(existing, rec)
                changes = []
                for f in FIELDS:
                    if (existing.get(f) or None) != (rec[f] or None) and not (f == 'is_active' and existing[f] == rec[f]):
                        old, new = existing.get(f), rec[f]
                        if f == 'house_id':
                            old, new = house_names.get(old), house_names.get(new)
                        if f == 'region_id':
                            old, new = region_names.get(old), region_names.get(new)
                        if f == 'is_active':
                            old, new = ('On' if old else 'Off'), ('On' if new else 'Off')
                        label = {'house_id': 'House', 'region_id': 'Region', 'roll_number': 'Roll number',
                                 'is_active': 'Access', 'title': 'Position'}.get(f, f.capitalize())
                        changes.append(f'{label}: {old or "—"} → {new or "—"}')
                row.update(action='update' if changes else 'unchanged', changes=changes, id=existing['id'], record=rec)
            else:
                row.update(action='create', changes=[], record=rec)
            row['name'], row['email'], row['role'] = rec['name'], rec['email'], rec['role']
        except RowError as e:
            row.update(action='error', error=str(e))
        plan.append(row)
    return plan


@bp.post('/import')
@login_required('ADMINISTRATION')
def preview():
    """Parse a CSV/Excel roster and return what would change. Nothing is written."""
    f = request.files.get('file')
    if not f or not f.filename:
        abort(400, 'Choose a CSV or Excel file.')
    try:
        table = read_table(f.filename, f.read(2 * 1024 * 1024 + 1))
    except ImportError_ as e:
        abort(400, str(e))
    if len(table) < 2:
        abort(400, 'The file needs a header row and at least one person.')
    header = [ALIASES.get(h.strip().lower()) for h in table[0]]
    if 'email' not in header or 'name' not in header:
        abort(400, 'The header row needs at least "Name" and "Email" columns. Download the template for the full layout.')
    records = []
    for i, r in enumerate(table[1:], start=2):
        data = {key: (r[j] if j < len(r) else '') for j, key in enumerate(header) if key}
        data = {k: v for k, v in data.items() if v != ''}
        records.append((i, data))
    plan = _plan(records)
    summary = {a: sum(1 for p in plan if p['action'] == a) for a in ('create', 'update', 'unchanged', 'error')}
    return jsonify(rows=plan, summary=summary)


@bp.post('/import/apply')
@login_required('ADMINISTRATION')
def apply():
    """Apply previewed rows. Every row is re-validated; if any fails, nothing is written."""
    items = (request.get_json(silent=True) or {}).get('rows') or []
    records = []
    for it in items:
        rec = dict(it.get('record') or {})
        if it.get('id'):
            rec['id'] = it['id']
        records.append((it.get('line'), rec))
    plan = _plan(records)
    bad = [p for p in plan if p['action'] == 'error']
    if bad:
        abort(400, f'Line {bad[0]["line"]}: {bad[0]["error"]}')
    db = get_db()
    by_id = {r['id']: dict(r) for r in db.execute('SELECT * FROM users')}
    done = {'create': 0, 'update': 0}
    for p in plan:
        if p['action'] == 'create':
            _write(p['record'])
            done['create'] += 1
        elif p['action'] == 'update':
            _write(p['record'], by_id[p['id']])
            done['update'] += 1
    db.commit()
    return jsonify(applied=done)
