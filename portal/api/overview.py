"""Role-specific home data, analytics, notifications, reference data and admin."""
from datetime import date, datetime, timedelta
from statistics import median

from flask import Blueprint, abort, jsonify, request

from ..auth import current_user, login_required
from ..db import get_db, reset_database, rows
from .claims import CLAIM_SELECT
from .common import BUDGET_PER_HEAD, CATEGORIES, today_iso
from .meetups import list_meetups

bp = Blueprint('overview', __name__, url_prefix='/api')


@bp.get('/meta')
def meta():
    db = get_db()
    return jsonify(
        houses=rows(db.execute('SELECT id, slug, name, motto, color FROM houses ORDER BY name')),
        regions=rows(db.execute('SELECT id, code, name, states FROM regions ORDER BY id')),
        categories=[{'id': k, 'label': v} for k, v in CATEGORIES.items()],
        today=today_iso(),
        budget_per_head=BUDGET_PER_HEAD,
    )


# ── Home ────────────────────────────────────────────────────────────────────

@bp.get('/home')
@login_required()
def home():
    user = current_user()
    builder = {'ADMINISTRATION': _home_administration, 'UHC': _home_uhc, 'LHC': _home_lhc}[user['role']]
    return jsonify(builder(user))


def _soon():
    return (date.today() + timedelta(days=14)).isoformat()


def _home_administration(user):
    db = get_db()
    today = today_iso()
    queue = list_meetups(user, "m.status = 'PENDING'", order='m.submitted_at ASC')
    claims = rows(db.execute(f"{CLAIM_SELECT} WHERE c.status IN ('PENDING_REVIEW','IN_PROGRESS') "
                             "ORDER BY c.status = 'IN_PROGRESS', c.created_at LIMIT 6"))
    upcoming = list_meetups(user, "m.status = 'APPROVED' AND m.event_date BETWEEN ? AND ?", (today, _soon()),
                            order='m.event_date ASC', limit=8)
    to_close = list_meetups(user, "m.status = 'APPROVED' AND m.event_date < ?", (today,), order='m.event_date ASC')
    peer = db.execute("SELECT COUNT(*) FROM meetups WHERE status = 'PEER_REVIEW'").fetchone()[0]
    return {
        'queue': queue,
        'claims': claims,
        'upcoming': upcoming,
        'to_close': to_close,
        'counts': {
            'pending': len(queue),
            'peer_review': peer,
            'claims': len(claims),
            'upcoming': len(upcoming),
            'to_close': len(to_close),
        },
        'activity': _recent_activity('1=1', []),
    }


def _home_uhc(user):
    db = get_db()
    hid = user['house_id']
    today = today_iso()
    counts = {r['status']: r['n'] for r in db.execute(
        "SELECT status, COUNT(*) AS n FROM meetups WHERE house_id = ? AND status <> 'DRAFT' GROUP BY status", (hid,))}
    regions = rows(db.execute('''
        SELECT r.id, r.name, r.code,
               (SELECT COUNT(*) FROM meetups m WHERE m.region_id = r.id AND m.house_id = ? AND m.status <> 'DRAFT') AS meetups,
               (SELECT u.name FROM users u WHERE u.role = 'LHC' AND u.house_id = ? AND u.region_id = r.id) AS lhc_name
        FROM regions r ORDER BY r.id''', (hid, hid)))
    return {
        'house': {'id': hid, 'name': user['house_name'], 'slug': user['house_slug'], 'color': user['house_color']},
        'counts': counts,
        'in_review': list_meetups(user, "m.house_id = ? AND m.status IN ('PEER_REVIEW','PENDING')", (hid,),
                                  order='m.submitted_at ASC'),
        'upcoming': list_meetups(user, "m.house_id = ? AND m.status = 'APPROVED' AND m.event_date >= ?", (hid, today),
                                 order='m.event_date ASC', limit=8),
        'regions': regions,
        'activity': _recent_activity('m.house_id = ?', [hid]),
        **{k: v for k, v in _personal(user).items() if k != 'mine'},
    }


def _personal(user):
    """What a proposer (LHC or UHC) personally needs to act on."""
    uid = user['id']
    today = today_iso()
    invites = list_meetups(user, '''m.status IN ('PEER_REVIEW','PENDING','APPROVED') AND EXISTS (
        SELECT 1 FROM meetup_invitations i WHERE i.meetup_id = m.id AND i.invitee_id = ? AND i.status = 'INVITED')''',
                           (uid,), order='m.event_date ASC')
    mine = list_meetups(user, 'm.proposer_id = ?', (uid,), order='m.event_date ASC')

    todo = []
    for m in mine:
        if m['status'] == 'DRAFT':
            todo.append({'kind': 'draft', 'meetup': m})
        elif m['status'] == 'REJECTED' and m['event_date'] > today:
            todo.append({'kind': 'rejected', 'meetup': m})
        elif m['status'] == 'APPROVED' and m['event_date'] < today:
            todo.append({'kind': 'close', 'meetup': m})
        elif m['status'] == 'COMPLETED' and not m['claim_status'] and m['budget_requested'] > 0:
            todo.append({'kind': 'claim', 'meetup': m})
        elif m['claim_status'] == 'PAYEE_DECLINED':
            todo.append({'kind': 'repayee', 'meetup': m})

    # Claims where this person was named as the co-host payee and needs to confirm their bank details.
    for c in rows(get_db().execute('''SELECT c.id, c.meetup_id, m.title, m.event_date, u.name AS claimant_name
                                      FROM claims c JOIN meetups m ON m.id = c.meetup_id JOIN users u ON u.id = c.claimant_id
                                      WHERE c.payee_user_id = ? AND c.payout_mode = 'COHOST' AND c.status = 'AWAITING_PAYEE' ''',
                                   (uid,))):
        todo.insert(0, {'kind': 'payee', 'meetup': {'id': c['meetup_id'], 'title': c['title'],
                                                    'event_date': c['event_date'], 'claimant_name': c['claimant_name']}})
    return {
        'invites': invites,
        'todo': todo,
        'in_flight': [m for m in mine if m['status'] in ('PEER_REVIEW', 'PENDING')],
        'mine': mine,
    }


def _home_lhc(user):
    uid = user['id']
    today = today_iso()
    p = _personal(user)
    mine = p.pop('mine')
    upcoming = list_meetups(user, '''m.status = 'APPROVED' AND m.event_date >= ? AND (m.proposer_id = ? OR EXISTS (
        SELECT 1 FROM meetup_invitations i WHERE i.meetup_id = m.id AND i.invitee_id = ? AND i.status = 'ACCEPTED'))''',
                            (today, uid, uid), order='m.event_date ASC')
    region = list_meetups(user, "m.region_id = ? AND m.status IN ('APPROVED','PENDING','PEER_REVIEW') "
                                'AND m.event_date >= ? AND m.proposer_id <> ?',
                          (user['region_id'], today, uid), order='m.event_date ASC', limit=8)
    return {
        **p,
        'upcoming': upcoming,
        'region': region,
        'counts': {
            'proposed': sum(1 for m in mine if m['status'] != 'DRAFT'),
            'approved': sum(1 for m in mine if m['status'] in ('APPROVED', 'COMPLETED')),
            'completed': sum(1 for m in mine if m['status'] == 'COMPLETED'),
        },
    }


def _recent_activity(where, params, limit=8):
    return rows(get_db().execute(f'''
        SELECT a.id, a.action, a.note, a.created_at, u.name AS actor_name, m.id AS meetup_id, m.title AS meetup_title
        FROM meetup_activity a
        JOIN meetups m ON m.id = a.meetup_id
        LEFT JOIN users u ON u.id = a.actor_id
        WHERE m.status <> 'DRAFT' AND a.action NOT IN ('CREATED') AND {where}
        ORDER BY a.created_at DESC, a.id DESC LIMIT {limit}''', params))


# ── Calendar ────────────────────────────────────────────────────────────────

@bp.get('/calendar')
@login_required()
def calendar():
    """Meetups between `start` and `end` (inclusive ISO dates) that are on, or headed for, the calendar."""
    user = current_user()
    try:
        start = date.fromisoformat(request.args.get('start', '')).isoformat()
        end = date.fromisoformat(request.args.get('end', '')).isoformat()
    except ValueError:
        abort(400, 'start and end must be YYYY-MM-DD dates.')
    where = ["m.status IN ('PEER_REVIEW','PENDING','APPROVED','COMPLETED')", 'm.event_date BETWEEN ? AND ?']
    params = [start, end]
    scope = request.args.get('scope', 'all')
    if scope == 'region' and user['region_id']:
        where.append('m.region_id = ?')
        params.append(user['region_id'])
    elif scope == 'house' and user['house_id']:
        where.append('m.house_id = ?')
        params.append(user['house_id'])
    elif scope == 'mine':
        where.append('''(m.proposer_id = ? OR EXISTS (SELECT 1 FROM meetup_invitations i
                         WHERE i.meetup_id = m.id AND i.invitee_id = ? AND i.status = 'ACCEPTED'))''')
        params += [user['id'], user['id']]
    return jsonify(meetups=list_meetups(user, ' AND '.join(where), params, order='m.event_date, m.start_time'))


# ── Analytics ───────────────────────────────────────────────────────────────

@bp.get('/stats')
@login_required()
def stats():
    db = get_db()
    where, params = ["m.status <> 'DRAFT'"], []
    for key in ('house_id', 'region_id'):
        if request.args.get(key):
            where.append(f'm.{key} = ?')
            params.append(int(request.args[key]))
    w = ' AND '.join(where)

    meetups = rows(db.execute(f'''
        SELECT m.id, m.house_id, m.region_id, m.status, m.category, m.event_date, m.expected_attendees,
               m.budget_requested, m.submitted_at, m.reviewed_at,
               c.actual_attendance, c.amount_claimed, c.amount_approved, c.status AS claim_status
        FROM meetups m LEFT JOIN claims c ON c.meetup_id = m.id WHERE {w}''', params))

    def bucket(status):
        if status in ('PEER_REVIEW', 'PENDING'):
            return 'in_review'
        return status.lower()

    def tally(items):
        t = {'total': 0, 'in_review': 0, 'approved': 0, 'completed': 0, 'rejected': 0, 'cancelled': 0, 'reached': 0}
        for m in items:
            t['total'] += 1
            t[bucket(m['status'])] += 1
            if m['status'] == 'COMPLETED':
                t['reached'] += m['actual_attendance'] if m['actual_attendance'] is not None else m['expected_attendees']
        return t

    houses = rows(db.execute('SELECT id, name, slug, color FROM houses ORDER BY name'))
    regions = rows(db.execute('SELECT id, name, code FROM regions ORDER BY id'))
    by_house = [{**h, **tally([m for m in meetups if m['house_id'] == h['id']])} for h in houses]
    by_region = [{**r, **tally([m for m in meetups if m['region_id'] == r['id']])} for r in regions]
    matrix = {f"{h['id']}-{r['id']}": 0 for h in houses for r in regions}
    for m in meetups:
        matrix[f"{m['house_id']}-{m['region_id']}"] += 1

    decided = [m for m in meetups if m['status'] in ('APPROVED', 'COMPLETED', 'REJECTED')]
    approved = [m for m in decided if m['status'] != 'REJECTED']
    review_hours = []
    for m in meetups:
        if m['submitted_at'] and m['reviewed_at']:
            delta = datetime.fromisoformat(m['reviewed_at']) - datetime.fromisoformat(m['submitted_at'])
            review_hours.append(max(delta.total_seconds() / 3600, 0))

    months = []
    first = date.today().replace(day=1)
    for back in range(5, -1, -1):
        y, mo = first.year, first.month - back
        while mo <= 0:
            y, mo = y - 1, mo + 12
        key = f'{y:04d}-{mo:02d}'
        months.append({'month': key, 'count': sum(1 for m in meetups if m['event_date'].startswith(key))})

    total = tally(meetups)
    return jsonify(
        totals={
            **total,
            'approval_rate': round(100 * len(approved) / len(decided)) if decided else None,
            'median_review_hours': round(median(review_hours), 1) if review_hours else None,
            'budget_approved': sum(m['budget_requested'] for m in meetups if m['status'] in ('APPROVED', 'COMPLETED')),
            'claimed': sum(m['amount_claimed'] or 0 for m in meetups),
            'disbursed': sum(m['amount_approved'] or 0 for m in meetups if m['claim_status'] == 'APPROVED'),
        },
        by_house=by_house,
        by_region=by_region,
        matrix=matrix,
        by_category=[{'id': k, 'label': v, 'count': sum(1 for m in meetups if m['category'] == k)}
                     for k, v in CATEGORIES.items()],
        months=months,
    )


# ── Notifications ───────────────────────────────────────────────────────────

@bp.get('/notifications')
@login_required()
def notifications():
    uid = current_user()['id']
    db = get_db()
    items = rows(db.execute('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 40',
                            (uid,)))
    unread = db.execute('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0', (uid,)).fetchone()[0]
    return jsonify(notifications=items, unread=unread)


@bp.post('/notifications/read')
@login_required()
def mark_read():
    db = get_db()
    db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', (current_user()['id'],))
    db.commit()
    return jsonify(ok=True)


@bp.get('/badges')
@login_required()
def badges():
    """Counts for the navigation badges."""
    user = current_user()
    db = get_db()
    out = {'notifications': db.execute('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0',
                                       (user['id'],)).fetchone()[0]}
    if user['role'] == 'ADMINISTRATION':
        out['meetups'] = db.execute("SELECT COUNT(*) FROM meetups WHERE status = 'PENDING'").fetchone()[0]
        out['claims'] = db.execute("SELECT COUNT(*) FROM claims WHERE status = 'PENDING_REVIEW'").fetchone()[0]
    else:
        out['invites'] = db.execute('''
            SELECT COUNT(*) FROM meetup_invitations i JOIN meetups m ON m.id = i.meetup_id
            WHERE i.invitee_id = ? AND i.status = 'INVITED' AND m.status IN ('PEER_REVIEW','PENDING','APPROVED')''',
                                    (user['id'],)).fetchone()[0]
        out['claims'] = db.execute('''SELECT COUNT(*) FROM claims WHERE payee_user_id = ? AND payout_mode = 'COHOST'
                                      AND status = 'AWAITING_PAYEE' ''', (user['id'],)).fetchone()[0]
    return jsonify(out)


# ── Admin ───────────────────────────────────────────────────────────────────

@bp.post('/admin/reset')
@login_required('ADMINISTRATION')
def reset():
    if (request.get_json(silent=True) or {}).get('confirm') != 'RESET':
        abort(400, 'Confirmation missing.')
    get_db().close()
    reset_database()
    return jsonify(ok=True)


# ── Role-specific insights (UHC: their house · LHC: themselves and their region) ──

def _fetch(where='1=1', params=()):
    return rows(get_db().execute(f'''
        SELECT m.id, m.proposer_id, m.house_id, m.region_id, m.status, m.category, m.event_date,
               m.expected_attendees, m.budget_requested, c.actual_attendance, c.amount_claimed,
               c.amount_approved, c.status AS claim_status
        FROM meetups m LEFT JOIN claims c ON c.meetup_id = m.id
        WHERE m.status <> 'DRAFT' AND ({where})''', params))


def _tally(items):
    t = {'total': 0, 'in_review': 0, 'approved': 0, 'completed': 0, 'rejected': 0, 'cancelled': 0, 'reached': 0,
         'reimbursed': 0}
    for m in items:
        t['total'] += 1
        t['in_review' if m['status'] in ('PEER_REVIEW', 'PENDING') else m['status'].lower()] += 1
        if m['status'] == 'COMPLETED':
            t['reached'] += m['actual_attendance'] if m['actual_attendance'] is not None else m['expected_attendees']
        if m['claim_status'] == 'APPROVED':
            t['reimbursed'] += m['amount_approved'] or 0
    decided = t['approved'] + t['completed'] + t['rejected']
    t['approval_rate'] = round(100 * (t['approved'] + t['completed']) / decided) if decided else None
    return t


def _months(items, n=6):
    first = date.today().replace(day=1)
    out = []
    for back in range(n - 1, -1, -1):
        y, mo = first.year, first.month - back
        while mo <= 0:
            y, mo = y - 1, mo + 12
        key = f'{y:04d}-{mo:02d}'
        out.append({'month': key, 'count': sum(1 for m in items if m['event_date'].startswith(key))})
    return out


def _rank(items, key, target):
    """1-based rank of `target` among groups of `items` by number of meetups held (ties share a rank)."""
    held = {}
    for m in items:
        held.setdefault(m[key], 0)
        if m['status'] == 'COMPLETED':
            held[m[key]] += 1
    mine = held.get(target, 0)
    return 1 + sum(1 for v in held.values() if v > mine)


def _people(user_rows, items):
    """Per-person activity: proposals, approvals, held, reach, co-hosting."""
    db = get_db()
    cohost = {r[0]: r[1] for r in db.execute(
        "SELECT invitee_id, COUNT(*) FROM meetup_invitations WHERE status = 'ACCEPTED' GROUP BY invitee_id")}
    out = []
    for u in user_rows:
        own = [m for m in items if m['proposer_id'] == u['id']]
        t = _tally(own)
        out.append({**u, 'proposed': t['total'], 'approved': t['approved'] + t['completed'], 'held': t['completed'],
                    'reached': t['reached'], 'cohosted': cohost.get(u['id'], 0),
                    'last_date': max((m['event_date'] for m in own), default=None)})
    return sorted(out, key=lambda p: (-p['held'], -p['proposed'], p['name']))


@bp.get('/insights/house')
@login_required('UHC')
def insights_house():
    user = current_user()
    db = get_db()
    hid = user['house_id']
    everything = _fetch()
    house = [m for m in everything if m['house_id'] == hid]
    regions = rows(db.execute('SELECT id, name, code FROM regions ORDER BY id'))
    lhcs = rows(db.execute('''SELECT u.id, u.name, u.roll_number, r.name AS region_name, r.code AS region_code
                              FROM users u JOIN regions r ON r.id = u.region_id
                              WHERE u.role = 'LHC' AND u.house_id = ? ORDER BY r.id''', (hid,)))
    return jsonify(
        house={'id': hid, 'name': user['house_name'], 'slug': user['house_slug']},
        totals=_tally(house),
        institute=_tally(everything),
        rank=_rank(everything, 'house_id', hid),
        of=db.execute('SELECT COUNT(*) FROM houses').fetchone()[0],
        by_region=[{**r, **_tally([m for m in house if m['region_id'] == r['id']])} for r in regions],
        lhcs=_people(lhcs, house),
        months=_months(house),
    )


@bp.get('/insights/me')
@login_required('LHC')
def insights_me():
    user = current_user()
    db = get_db()
    uid, rid = user['id'], user['region_id']
    everything = _fetch()
    mine = [m for m in everything if m['proposer_id'] == uid]
    region = [m for m in everything if m['region_id'] == rid]
    houses = rows(db.execute('SELECT id, name, slug FROM houses ORDER BY name'))
    peers = rows(db.execute('''SELECT u.id, u.name, h.name AS house_name, h.slug AS house_slug
                               FROM users u JOIN houses h ON h.id = u.house_id
                               WHERE u.role = 'LHC' AND u.region_id = ?''', (rid,)))
    me = _tally(mine)
    me['cohosted'] = db.execute("SELECT COUNT(*) FROM meetup_invitations WHERE invitee_id = ? AND status = 'ACCEPTED'",
                                (uid,)).fetchone()[0]
    reg = _tally(region)
    reg['upcoming'] = sum(1 for m in region if m['status'] == 'APPROVED' and m['event_date'] >= today_iso())
    return jsonify(
        me=me,
        region={'id': rid, 'name': user['region_name'], **reg},
        rank=_rank(everything, 'region_id', rid),
        of=db.execute('SELECT COUNT(*) FROM regions').fetchone()[0],
        by_house=[{**h, **_tally([m for m in region if m['house_id'] == h['id']])} for h in houses],
        peers=_people(peers, region),
        months=_months(region),
        my_months=_months(mine),
    )
