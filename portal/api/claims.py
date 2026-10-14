"""Post-meetup reimbursement claims.

A claim carries: who attended (name + email, typed or imported from CSV/Excel), what was spent
(amount may exceed the approved budget — Administration decides), receipts (stored under data/uploads/),
a post link, and who gets paid:

  SELF    the claimant — details pre-filled from and saved back to their profile
  OTHER   another student — details entered on the claim
  COHOST  an accepted co-host from another house — paid to *their* saved details, which the claimant
          never sees. The claim waits (AWAITING_PAYEE) until the co-host confirms those details; if they
          decline (PAYEE_DECLINED) the claimant picks another payee.

Bank details are only ever returned to Administration, the payee, and (for SELF/OTHER) the claimant.
"""
import json
import os
import uuid

from flask import Blueprint, abort, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from ..auth import current_user, login_required
from ..db import UPLOAD_DIR, get_db, one, rows, utcnow
from ..importers import ImportError_, read_attendees
from .common import (BUDGET_PER_HEAD, EMAIL_RE, PROPOSER_ROLES, clean_int, clean_text, get_visible_meetup,
                     log_activity, administration_ids, notify, parse_bank, today_iso)
from .profile import load_payout, save_payout_details

bp = Blueprint('claims', __name__, url_prefix='/api')

ALLOWED_EXT = {'.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic'}
MAX_FILES = 10
BANK_FIELDS = ('payee_name', 'bank_name', 'account_number', 'ifsc', 'upi_id')

CLAIM_SELECT = '''
    SELECT c.*, m.title AS meetup_title, m.event_date, m.budget_requested, m.expected_attendees,
           m.house_id, h.name AS house_name, h.slug AS house_slug, h.color AS house_color,
           m.region_id, r.name AS region_name, u.name AS claimant_name, u.roll_number AS claimant_roll,
           rv.name AS reviewer_name, pu.name AS payee_user_name, ph.name AS payee_house_name,
           (SELECT COUNT(*) FROM claim_files f WHERE f.claim_id = c.id) AS file_count
    FROM claims c
    JOIN meetups m ON m.id = c.meetup_id
    JOIN houses h ON h.id = m.house_id
    JOIN regions r ON r.id = m.region_id
    JOIN users u ON u.id = c.claimant_id
    LEFT JOIN users rv ON rv.id = c.reviewed_by
    LEFT JOIN users pu ON pu.id = c.payee_user_id
    LEFT JOIN houses ph ON ph.id = pu.house_id
'''


def claim_scope(user):
    """Administration sees all claims; UHC their house's and their own; LHC their own. Payees see claims paying them."""
    if user['role'] == 'ADMINISTRATION':
        return '1=1', []
    if user['role'] == 'UHC':
        return '(m.house_id = ? OR c.claimant_id = ? OR c.payee_user_id = ?)', [user['house_id'], user['id'], user['id']]
    return '(c.claimant_id = ? OR c.payee_user_id = ?)', [user['id'], user['id']]


def can_see_bank(claim, user):
    return (user['role'] == 'ADMINISTRATION' or claim['payee_user_id'] == user['id']
            or (claim['claimant_id'] == user['id'] and claim['payout_mode'] != 'COHOST'))


def present(claim, user):
    """Strip bank details the viewer may not see, and add what they can do."""
    if not can_see_bank(claim, user):
        for f in BANK_FIELDS:
            claim[f] = None
        claim['bank_hidden'] = True
    claim['can_review'] = user['role'] == 'ADMINISTRATION' and claim['status'] in ('PENDING_REVIEW', 'IN_PROGRESS')
    claim['can_confirm_payee'] = claim['payee_user_id'] == user['id'] and claim['payout_mode'] == 'COHOST' \
        and claim['status'] == 'AWAITING_PAYEE'
    claim['can_change_payee'] = claim['claimant_id'] == user['id'] and claim['status'] in ('AWAITING_PAYEE', 'PAYEE_DECLINED')
    return claim


def load_claim(claim_id, user):
    scope, params = claim_scope(user)
    claim = one(get_db().execute(f'{CLAIM_SELECT} WHERE c.id = ? AND {scope}', [claim_id, *params]).fetchone())
    if not claim:
        abort(404, 'Claim not found.')
    return claim


def claim_for_meetup(meetup_id, user):
    """Claim attached to a meetup page, presented for `user` (or None)."""
    row = one(get_db().execute(f'{CLAIM_SELECT} WHERE c.meetup_id = ?', (meetup_id,)).fetchone())
    if not row:
        return None
    row['files'] = rows(get_db().execute('SELECT id, original_name, size_bytes FROM claim_files WHERE claim_id = ?',
                                         (row['id'],)))
    return present(row, user)


def eligible_cohosts(m, claimant):
    """Accepted co-hosts from a different house than the claimant, with whether they've saved bank details."""
    return rows(get_db().execute('''
        SELECT u.id, u.name, u.role, h.name AS house_name, h.slug AS house_slug,
               EXISTS (SELECT 1 FROM payout_details p WHERE p.user_id = u.id) AS has_details
        FROM meetup_invitations i
        JOIN users u ON u.id = i.invitee_id
        JOIN houses h ON h.id = u.house_id
        WHERE i.meetup_id = ? AND i.status = 'ACCEPTED' AND u.house_id <> ?
        ORDER BY u.name''', (m['id'], claimant['house_id'])))


# ── Payout resolution (shared by create and change-payee) ───────────────────

def resolve_payout(m, user, data):
    """→ (columns dict, status, cohost_id or None). Saves SELF details back to the profile."""
    mode = data.get('payout_mode')
    if mode not in ('SELF', 'OTHER', 'COHOST'):
        abort(400, 'Choose who should be reimbursed.')
    cols = {'payout_mode': mode, 'payee_user_id': None, **{f: None for f in BANK_FIELDS}}
    if mode == 'SELF':
        bank = parse_bank(data)
        save_payout_details(user['id'], bank)  # keep the profile current for next time
        return {**cols, **bank, 'payee_user_id': user['id']}, 'PENDING_REVIEW', None
    if mode == 'OTHER':
        return {**cols, **parse_bank(data, "Student's name")}, 'PENDING_REVIEW', None
    payee = data.get('payee_user_id')
    match = next((c for c in eligible_cohosts(m, user) if c['id'] == payee), None)
    if not match:
        abort(400, 'Pick one of your co-hosts from another house.')
    if not match['has_details']:
        abort(400, f'{match["name"]} has not saved bank details yet.')
    return {**cols, 'payee_user_id': payee}, 'AWAITING_PAYEE', match


def apply_payout(claim_id, m, user, data, actor_verb='filed'):
    cols, status, cohost = resolve_payout(m, user, data)
    db = get_db()
    db.execute(f"UPDATE claims SET {', '.join(f'{k} = ?' for k in cols)}, status = ?, payee_note = NULL, "
               'payee_responded_at = NULL WHERE id = ?', [*cols.values(), status, claim_id])
    if cohost:
        notify([cohost['id']], 'Confirm your bank details',
               f'{user["name"]} {actor_verb} a claim for "{m["title"]}" to be paid to you. '
               'Check your saved bank details and confirm so it can go to Administration.', m['id'])
    else:
        notify(administration_ids(), 'Claim to verify', f'A claim for "{m["title"]}" is ready for review.', m['id'])
    return status


def parse_attendees(raw):
    try:
        items = json.loads(raw or '[]')
    except ValueError:
        abort(400, 'Attendee list is not valid.')
    if not isinstance(items, list) or not items:
        abort(400, 'Add the students who attended.')
    seen, out = set(), []
    for i, a in enumerate(items, 1):
        name = str((a or {}).get('name') or '').strip()
        email = str((a or {}).get('email') or '').strip().lower()
        if not name:
            abort(400, f'Attendee {i}: name is missing.')
        if not EMAIL_RE.match(email):
            abort(400, f'Attendee {i} ({name}): email "{email}" is not valid.')
        if email in seen:
            continue
        seen.add(email)
        out.append((name[:120], email[:200]))
    if len(out) > 5000:
        abort(400, 'Too many attendees.')
    return out


# ── Read ────────────────────────────────────────────────────────────────────

@bp.get('/claims')
@login_required()
def index():
    user = current_user()
    scope, params = claim_scope(user)
    where = [scope]
    statuses = [s for s in (request.args.get('status') or '').split(',') if s]
    if statuses:
        where.append(f"c.status IN ({','.join('?' * len(statuses))})")
        params += statuses
    sql = f'''{CLAIM_SELECT} WHERE {' AND '.join(where)}
              ORDER BY CASE c.status WHEN 'PENDING_REVIEW' THEN 0 WHEN 'IN_PROGRESS' THEN 1
                                     WHEN 'AWAITING_PAYEE' THEN 2 WHEN 'PAYEE_DECLINED' THEN 2 ELSE 3 END,
                       c.created_at DESC'''
    return jsonify(claims=[present(c, user) for c in rows(get_db().execute(sql, params))])


@bp.get('/claims/<int:claim_id>')
@login_required()
def show(claim_id):
    user = current_user()
    claim = present(load_claim(claim_id, user), user)
    db = get_db()
    claim['files'] = rows(db.execute(
        "SELECT id, original_name, size_bytes, stored_name LIKE 'sample-%' AS is_sample FROM claim_files WHERE claim_id = ?",
        (claim_id,)))
    claim['attendees'] = rows(db.execute('SELECT name, email FROM claim_attendees WHERE claim_id = ? ORDER BY name',
                                         (claim_id,)))
    return jsonify(claim=claim)


@bp.get('/meetups/<int:meetup_id>/claim-setup')
@login_required(*PROPOSER_ROLES)
def setup(meetup_id):
    """What the claim form needs: rate, the host's saved details, and payable co-hosts."""
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    if m['proposer_id'] != user['id']:
        abort(403, 'Only the meetup host can file its claim.')
    return jsonify(per_head=BUDGET_PER_HEAD, payout=load_payout(user['id']), cohosts=eligible_cohosts(m, user))


@bp.post('/attendees/parse')
@login_required(*PROPOSER_ROLES)
def parse_upload():
    f = request.files.get('file')
    if not f or not f.filename:
        abort(400, 'Choose a CSV or Excel file.')
    try:
        attendees, skipped = read_attendees(f.filename, f.read(2 * 1024 * 1024 + 1))
    except ImportError_ as e:
        abort(400, str(e))
    if not attendees:
        abort(400, 'No rows with both a name and a valid email were found. Use columns "Name" and "Email".')
    return jsonify(attendees=attendees, skipped=skipped)


# ── Write ───────────────────────────────────────────────────────────────────

@bp.post('/meetups/<int:meetup_id>/claim')
@login_required(*PROPOSER_ROLES)
def create(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    if m['proposer_id'] != user['id']:
        abort(403, 'Only the meetup host can file its claim.')
    eligible = m['status'] == 'COMPLETED' or (m['status'] == 'APPROVED' and m['event_date'] <= today_iso())
    if not eligible:
        abort(400, 'Claims can be filed once the meetup has taken place.')
    db = get_db()
    if db.execute('SELECT 1 FROM claims WHERE meetup_id = ?', (meetup_id,)).fetchone():
        abort(409, 'A claim has already been filed for this meetup.')

    form = request.form
    attendees = parse_attendees(form.get('attendees'))
    amount = clean_int(form.get('amount_claimed'), 'Amount spent', 1, 1_000_000)
    expense_notes = clean_text(form.get('expense_notes'), 'What the money was spent on', 5, 2000)
    post_link = clean_text(form.get('post_link'), 'Post link', 8, 500)
    if not post_link.startswith(('http://', 'https://')):
        abort(400, 'Post link must be a full URL starting with https://')

    files = [f for f in request.files.getlist('receipts') if f and f.filename]
    if not files:
        abort(400, 'Attach at least one bill or receipt.')
    if len(files) > MAX_FILES:
        abort(400, f'Attach at most {MAX_FILES} files.')
    for f in files:
        if os.path.splitext(f.filename)[1].lower() not in ALLOWED_EXT:
            abort(400, f'{f.filename}: only PDF and image files are accepted.')

    now = utcnow()
    if m['status'] == 'APPROVED':
        db.execute("UPDATE meetups SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?",
                   (now, now, meetup_id))
        log_activity(meetup_id, user['id'], 'COMPLETED')

    # Insert as AWAITING_PAYEE (no bank details yet), then let apply_payout fill details and set the real status.
    cur = db.execute('''INSERT INTO claims (meetup_id, claimant_id, amount_claimed, actual_attendance, expense_notes,
                            post_link, payout_mode, payee_user_id, status, created_at)
                        VALUES (?,?,?,?,?,?,'OTHER',NULL,'AWAITING_PAYEE',?)''',
                     (meetup_id, user['id'], amount, len(attendees), expense_notes, post_link, now))
    claim_id = cur.lastrowid
    db.executemany('INSERT INTO claim_attendees (claim_id, name, email) VALUES (?,?,?)',
                   [(claim_id, n, e) for n, e in attendees])
    status = apply_payout(claim_id, m, user, form)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    saved = []
    try:
        for f in files:
            original = secure_filename(f.filename) or 'receipt'
            stored = f'{claim_id}-{uuid.uuid4().hex[:12]}{os.path.splitext(original)[1].lower()}'
            path = os.path.join(UPLOAD_DIR, stored)
            f.save(path)
            saved.append(path)
            db.execute('INSERT INTO claim_files (claim_id, original_name, stored_name, size_bytes, created_at) '
                       'VALUES (?,?,?,?,?)', (claim_id, original, stored, os.path.getsize(path), now))
    except Exception:
        for path in saved:
            os.remove(path)
        raise

    log_activity(meetup_id, user['id'], 'CLAIM_FILED', f'₹{amount:,} for {len(attendees)} attendees')
    db.commit()
    return jsonify(id=claim_id, status=status), 201


@bp.post('/claims/<int:claim_id>/payee')
@login_required(*PROPOSER_ROLES)
def change_payee(claim_id):
    """Claimant picks a different payee while a co-host payout is pending or was declined."""
    user = current_user()
    claim = present(load_claim(claim_id, user), user)
    if not claim['can_change_payee']:
        abort(403, 'The payee can no longer be changed on this claim.')
    m = get_visible_meetup(claim['meetup_id'], user)
    status = apply_payout(claim_id, m, user, request.get_json(silent=True) or {}, actor_verb='updated')
    get_db().commit()
    return jsonify(status=status)


@bp.post('/claims/<int:claim_id>/payee-response')
@login_required(*PROPOSER_ROLES)
def payee_response(claim_id):
    """The co-host confirms (snapshotting their current saved details) or declines."""
    user = current_user()
    claim = present(load_claim(claim_id, user), user)
    if not claim['can_confirm_payee']:
        abort(403, 'There is nothing for you to confirm on this claim.')
    data = request.get_json(silent=True) or {}
    decision = data.get('decision')
    db = get_db()
    now = utcnow()
    if decision == 'CONFIRM':
        saved = load_payout(user['id'])
        if not saved:
            abort(400, 'Save your bank details in Settings first.')
        db.execute('''UPDATE claims SET payee_name = ?, bank_name = ?, account_number = ?, ifsc = ?, upi_id = ?,
                          status = 'PENDING_REVIEW', payee_responded_at = ? WHERE id = ?''',
                   (saved['account_holder'], saved['bank_name'], saved['account_number'], saved['ifsc'],
                    saved['upi_id'], now, claim_id))
        log_activity(claim['meetup_id'], user['id'], 'CLAIM_PAYEE_CONFIRMED')
        notify([claim['claimant_id']], 'Payee confirmed',
               f'{user["name"]} confirmed their bank details. Your claim for "{claim["meetup_title"]}" is with Administration.',
               claim['meetup_id'])
        notify(administration_ids(), 'Claim to verify', f'A claim for "{claim["meetup_title"]}" is ready for review.',
               claim['meetup_id'])
    elif decision == 'DECLINE':
        note = clean_text(data.get('note'), 'Reason', 3, 500)
        db.execute("UPDATE claims SET status = 'PAYEE_DECLINED', payee_note = ?, payee_responded_at = ? WHERE id = ?",
                   (note, now, claim_id))
        log_activity(claim['meetup_id'], user['id'], 'CLAIM_PAYEE_DECLINED', note)
        notify([claim['claimant_id']], 'Choose another payee',
               f'{user["name"]} declined to receive the payout for "{claim["meetup_title"]}": {note}', claim['meetup_id'])
    else:
        abort(400, 'Decision must be CONFIRM or DECLINE.')
    db.commit()
    return jsonify(status='PENDING_REVIEW' if decision == 'CONFIRM' else 'PAYEE_DECLINED')


@bp.post('/claims/<int:claim_id>/review')
@login_required('ADMINISTRATION')
def review(claim_id):
    user = current_user()
    claim = load_claim(claim_id, user)
    if claim['status'] not in ('PENDING_REVIEW', 'IN_PROGRESS'):
        abort(400, 'This claim is not ready for review.')
    data = request.get_json(silent=True) or {}
    decision = data.get('decision')
    status = {'APPROVE': 'APPROVED', 'IN_PROGRESS': 'IN_PROGRESS', 'REJECT': 'REJECTED'}.get(decision)
    if not status:
        abort(400, 'Decision must be APPROVE, IN_PROGRESS or REJECT.')
    notes = clean_text(data.get('notes'), 'Notes', 5, 1000, required=status == 'REJECTED')
    approved = None
    if status == 'APPROVED':
        raw = data.get('amount_approved')
        approved = claim['amount_claimed'] if raw in (None, '') else clean_int(raw, 'Approved amount', 0, claim['amount_claimed'])

    db = get_db()
    db.execute('UPDATE claims SET status = ?, amount_approved = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ? '
               'WHERE id = ?', (status, approved, notes, user['id'], utcnow(), claim_id))
    log_activity(claim['meetup_id'], user['id'], f'CLAIM_{status}', notes)
    body = {
        'APPROVED': f'₹{approved:,} approved for "{claim["meetup_title"]}".' if approved is not None else '',
        'IN_PROGRESS': f'Your claim for "{claim["meetup_title"]}" is being processed by Accounts.',
        'REJECTED': f'Your claim for "{claim["meetup_title"]}" was rejected: {notes}',
    }[status]
    notify([claim['claimant_id'], claim['payee_user_id'] if claim['payout_mode'] == 'COHOST' else None],
           'Claim update', body, claim['meetup_id'])
    db.commit()
    return jsonify(status=status)


@bp.get('/claims/<int:claim_id>/files/<int:file_id>')
@login_required()
def download(claim_id, file_id):
    load_claim(claim_id, current_user())
    f = one(get_db().execute('SELECT * FROM claim_files WHERE id = ? AND claim_id = ?', (file_id, claim_id)).fetchone())
    if not f or f['stored_name'].startswith('sample-'):
        abort(404, 'This sample receipt has no file attached.')
    return send_from_directory(UPLOAD_DIR, f['stored_name'], download_name=f['original_name'])
