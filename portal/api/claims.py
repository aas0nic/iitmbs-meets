"""Post-meetup reimbursement claims, with receipt uploads stored under data/uploads/."""
import os
import uuid

from flask import Blueprint, abort, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from ..auth import current_user, login_required
from ..db import UPLOAD_DIR, get_db, one, rows, utcnow
from .common import clean_int, clean_text, get_visible_meetup, log_activity, management_ids, notify, today_iso

bp = Blueprint('claims', __name__, url_prefix='/api')

ALLOWED_EXT = {'.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic'}
MAX_FILES = 10

CLAIM_SELECT = '''
    SELECT c.*, m.title AS meetup_title, m.event_date, m.budget_requested, m.expected_attendees,
           m.house_id, h.name AS house_name, h.slug AS house_slug, h.color AS house_color,
           m.region_id, r.name AS region_name, u.name AS claimant_name, u.roll_number AS claimant_roll,
           rv.name AS reviewer_name,
           (SELECT COUNT(*) FROM claim_files f WHERE f.claim_id = c.id) AS file_count
    FROM claims c
    JOIN meetups m ON m.id = c.meetup_id
    JOIN houses h ON h.id = m.house_id
    JOIN regions r ON r.id = m.region_id
    JOIN users u ON u.id = c.claimant_id
    LEFT JOIN users rv ON rv.id = c.reviewed_by
'''


def claim_scope(user):
    """Management sees all claims, UHC their house's, LHC their own."""
    if user['role'] == 'MANAGEMENT':
        return '1=1', []
    if user['role'] == 'UHC':
        return 'm.house_id = ?', [user['house_id']]
    return 'c.claimant_id = ?', [user['id']]


def load_claim(claim_id, user):
    scope, params = claim_scope(user)
    claim = one(get_db().execute(f'{CLAIM_SELECT} WHERE c.id = ? AND {scope}', [claim_id, *params]).fetchone())
    if not claim:
        abort(404, 'Claim not found.')
    return claim


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
              ORDER BY CASE c.status WHEN 'PENDING_REVIEW' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
                       c.created_at DESC'''
    return jsonify(claims=rows(get_db().execute(sql, params)))


@bp.get('/claims/<int:claim_id>')
@login_required()
def show(claim_id):
    user = current_user()
    claim = load_claim(claim_id, user)
    claim['files'] = rows(get_db().execute(
        "SELECT id, original_name, size_bytes, stored_name LIKE 'sample-%' AS is_sample FROM claim_files WHERE claim_id = ?",
        (claim_id,)))
    claim['can_review'] = user['role'] == 'MANAGEMENT' and claim['status'] in ('PENDING_REVIEW', 'IN_PROGRESS')
    return jsonify(claim=claim)


@bp.post('/meetups/<int:meetup_id>/claim')
@login_required('LHC')
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
    amount = clean_int(form.get('amount_claimed'), 'Amount', 1, 500000)
    attendance = clean_int(form.get('actual_attendance'), 'Attendance', 0, 5000)
    attendance_notes = clean_text(form.get('attendance_notes'), 'Attendance proof', 0, 1000, required=False)
    expense_notes = clean_text(form.get('expense_notes'), 'Expense breakdown', 5, 2000)
    payout = clean_text(form.get('payout_details'), 'Payout details', 4, 200)

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

    cur = db.execute('''INSERT INTO claims (meetup_id, claimant_id, amount_claimed, actual_attendance,
                            attendance_notes, expense_notes, payout_details, created_at)
                        VALUES (?,?,?,?,?,?,?,?)''',
                     (meetup_id, user['id'], amount, attendance, attendance_notes, expense_notes, payout, now))
    claim_id = cur.lastrowid

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

    log_activity(meetup_id, user['id'], 'CLAIM_FILED', f'₹{amount:,} for {attendance} attendees')
    notify(management_ids(), 'Claim filed', f'{user["name"]} filed a ₹{amount:,} claim for "{m["title"]}".', meetup_id)
    db.commit()
    return jsonify(id=claim_id), 201


@bp.post('/claims/<int:claim_id>/review')
@login_required('MANAGEMENT')
def review(claim_id):
    user = current_user()
    claim = load_claim(claim_id, user)
    if claim['status'] not in ('PENDING_REVIEW', 'IN_PROGRESS'):
        abort(400, 'This claim has already been settled.')
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
    notify([claim['claimant_id']], 'Claim update', body, claim['meetup_id'])
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
