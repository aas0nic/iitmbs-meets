"""Meetup lifecycle: propose → peer review → Administration review → completion.

    DRAFT ──submit──▶ PEER_REVIEW ──(all peers answered | host fast-forwards)──▶ PENDING
      ▲                  │                                                       │
      └──withdraw────────┴───────────────────────────────────────────────────────┤
                                                                     approve ◀───┴───▶ reject
                                                                        │                 │
                                                                    APPROVED          REJECTED ──edit + resubmit──▶ …
                                                                    │      │
                                                              complete    cancel
                                                                 ▼          ▼
                                                             COMPLETED  CANCELLED
"""
from datetime import date

from flask import Blueprint, abort, jsonify, request

from ..auth import current_user, login_required
from ..db import get_db, one, rows, utcnow
from .common import (BUDGET_PER_HEAD, CATEGORIES, PROPOSER_ROLES, INVITES_OPEN, TIME_RE, clean_int, clean_text, get_visible_meetup,
                     house_uhc_ids, log_activity, administration_ids, notify, today_iso, visibility_clause)

bp = Blueprint('meetups', __name__, url_prefix='/api')

LIST_SELECT = '''
    SELECT m.id, m.title, m.category, m.event_date, m.backup_date, m.start_time, m.end_time, m.city, m.venue, m.map_link,
           m.expected_attendees, m.budget_requested, m.status, m.submitted_at, m.reviewed_at, m.created_at,
           m.proposer_id, p.name AS proposer_name,
           m.house_id, h.name AS house_name, h.slug AS house_slug, h.color AS house_color,
           m.region_id, r.name AS region_name, r.code AS region_code,
           (SELECT COUNT(*) FROM meetup_invitations i WHERE i.meetup_id = m.id) AS invites_total,
           (SELECT COUNT(*) FROM meetup_invitations i WHERE i.meetup_id = m.id AND i.status = 'ACCEPTED') AS invites_accepted,
           (SELECT COUNT(*) FROM meetup_invitations i WHERE i.meetup_id = m.id AND i.status = 'INVITED') AS invites_waiting,
           (SELECT status FROM meetup_invitations i WHERE i.meetup_id = m.id AND i.invitee_id = ?) AS my_invitation,
           (SELECT status FROM claims c WHERE c.meetup_id = m.id) AS claim_status
    FROM meetups m
    JOIN users p ON p.id = m.proposer_id
    JOIN houses h ON h.id = m.house_id
    JOIN regions r ON r.id = m.region_id
'''


def list_meetups(user, where='1=1', params=(), order='m.event_date DESC', limit=None):
    clause, vparams = visibility_clause(user)
    sql = f'{LIST_SELECT} WHERE {clause} AND ({where}) ORDER BY {order}'
    if limit:
        sql += f' LIMIT {int(limit)}'
    return rows(get_db().execute(sql, [user['id'], *vparams, *params]))


# ── Permissions ─────────────────────────────────────────────────────────────

def permissions(m, user, my_invite):
    role, uid = user['role'], user['id']
    is_host = m['proposer_id'] == uid
    is_admin = role == 'ADMINISTRATION'
    past = m['event_date'] <= today_iso()
    status = m['status']
    return {
        'edit': is_host and status in ('DRAFT', 'REJECTED'),
        'delete': is_host and status == 'DRAFT',
        'submit': is_host and status in ('DRAFT', 'REJECTED'),
        'send_to_administration': is_host and status == 'PEER_REVIEW',
        'withdraw': is_host and status in ('PEER_REVIEW', 'PENDING'),
        'review': is_admin and status == 'PENDING',
        'complete': status == 'APPROVED' and (is_admin or (is_host and past)),
        'cancel': status in ('PEER_REVIEW', 'PENDING', 'APPROVED') and (is_admin or is_host),
        'respond': bool(my_invite) and status in INVITES_OPEN,
        'comment': status != 'DRAFT' and (
            is_admin or is_host or bool(my_invite)
            or (role == 'UHC' and user['house_id'] == m['house_id'])),
        'file_claim': is_host and (status == 'COMPLETED' or (status == 'APPROVED' and past)),
    }


def require(m, user, action):
    my_invite = get_db().execute('SELECT status FROM meetup_invitations WHERE meetup_id = ? AND invitee_id = ?',
                                 (m['id'], user['id'])).fetchone()
    if not permissions(m, user, my_invite)[action]:
        abort(403, 'That action is not available for this meetup right now.')


# ── Validation ──────────────────────────────────────────────────────────────

def parse_payload(data, for_submit, user):
    title = clean_text(data.get('title'), 'Title', 4, 120)
    description = clean_text(data.get('description'), 'Description', 20, 4000)
    category = data.get('category')
    if category not in CATEGORIES:
        abort(400, 'Choose a category.')
    try:
        event_date = date.fromisoformat(data.get('event_date') or '').isoformat()
    except ValueError:
        abort(400, 'Pick a valid preferred date.')
    try:
        backup_date = date.fromisoformat(data.get('backup_date') or '').isoformat()
    except ValueError:
        abort(400, 'Pick a backup date.')
    if backup_date == event_date:
        abort(400, 'The backup date must be different from the preferred date.')
    if for_submit and (event_date <= today_iso() or backup_date <= today_iso()):
        abort(400, 'Meetup dates must be in the future.')

    start, end = data.get('start_time') or '', data.get('end_time') or ''
    if not TIME_RE.match(start) or not TIME_RE.match(end):
        abort(400, 'Start and end times must be valid times.')
    if end <= start:
        abort(400, 'End time must be after the start time.')

    city = clean_text(data.get('city'), 'City', 2, 80)
    venue = clean_text(data.get('venue'), 'Location name', 3, 300)
    map_link = clean_text(data.get('map_link'), 'Map link', 10, 500)
    if not map_link.startswith(('https://', 'http://')):
        abort(400, 'Map link must be a full link starting with https:// (e.g. from Google Maps → Share).')
    attendees = clean_int(data.get('expected_attendees'), 'Expected attendance', 1, 2000)
    extra = clean_int(data.get('extra_budget') or 0, 'Extra budget', 0, 500000)
    extra_note = clean_text(data.get('extra_budget_note'), 'Reason for extra budget', 5, 1000, required=extra > 0)
    if not extra:
        extra_note = None

    # LHCs always propose for their own region; UHC members can pick any region.
    if user['role'] == 'UHC':
        region_id = clean_int(data.get('region_id'), 'Region', 1, 10_000)
        if not get_db().execute('SELECT 1 FROM regions WHERE id = ?', (region_id,)).fetchone():
            abort(400, 'Choose a region.')
    else:
        region_id = user['region_id']

    return {
        'title': title,
        'description': description,
        'category': category,
        'event_date': event_date,
        'backup_date': backup_date,
        'start_time': start,
        'end_time': end,
        'city': city,
        'venue': venue,
        'map_link': map_link,
        'expected_attendees': attendees,
        'budget_per_head': BUDGET_PER_HEAD,
        'extra_budget': extra,
        'extra_budget_note': extra_note,
        'budget_requested': BUDGET_PER_HEAD * attendees + extra,
        'region_id': region_id,
        **parse_collab(data),
    }


def parse_collab(data):
    """Collaboration block: nothing for NONE; name/plan/contact for both kinds; more for external bodies."""
    kind = data.get('collab_type') or 'NONE'
    if kind not in ('NONE', 'SOCIETY', 'EXTERNAL'):
        abort(400, 'Choose whether this meetup is a collaboration.')
    out = {'collab_type': kind, 'collab_name': None, 'collab_about': None, 'collab_agenda': None,
           'collab_contact': None, 'collab_sponsored': None, 'collab_sponsorship': None}
    if kind == 'NONE':
        return out
    who = 'Society' if kind == 'SOCIETY' else 'Organisation'
    out['collab_name'] = clean_text(data.get('collab_name'), f'{who} name', 2, 150)
    out['collab_agenda'] = clean_text(data.get('collab_agenda'), 'Collaboration plan', 10, 2000)
    out['collab_contact'] = clean_text(data.get('collab_contact'), 'Point of contact', 4, 200)
    if kind == 'EXTERNAL':
        out['collab_about'] = clean_text(data.get('collab_about'), 'About the organisation', 10, 1000)
        sponsored = data.get('collab_sponsored')
        if sponsored not in ('yes', 'no'):
            abort(400, 'Say whether the organisation is sponsoring the meetup.')
        out['collab_sponsored'] = 1 if sponsored == 'yes' else 0
        if out['collab_sponsored']:
            out['collab_sponsorship'] = clean_text(data.get('collab_sponsorship'), 'Sponsorship details', 10, 1000)
    return out


def invitable_clause(host):
    """Who `host` may invite: LHC → LHCs of the same region; UHC → other UHC members (any house)."""
    if host['role'] == 'UHC':
        return "u.role = 'UHC' AND u.is_active = 1 AND u.id <> ?", [host['id']]
    return "u.role = 'LHC' AND u.is_active = 1 AND u.region_id = ? AND u.id <> ?", [host['region_id'], host['id']]


def _sync_invitations(meetup_id, host, invitee_ids):
    """Make the invitation set match `invitee_ids`, enforcing who the host may invite."""
    db = get_db()
    wanted = [i for i in dict.fromkeys(invitee_ids or []) if i and i != host['id']]
    if wanted:
        clause, params = invitable_clause(host)
        marks = ','.join('?' * len(wanted))
        valid = {r[0] for r in db.execute(f'SELECT u.id FROM users u WHERE {clause} AND u.id IN ({marks})',
                                          [*params, *wanted])}
        if any(i not in valid for i in wanted):
            abort(400, 'UHC members can only invite other UHC members.' if host['role'] == 'UHC'
                  else 'You can only invite LHCs from your own region.')
    existing = {r['invitee_id']: r['status'] for r in db.execute(
        'SELECT invitee_id, status FROM meetup_invitations WHERE meetup_id = ?', (meetup_id,))}
    removed = [i for i in existing if i not in wanted]
    if removed:
        db.execute(f"DELETE FROM meetup_invitations WHERE meetup_id = ? AND invitee_id IN ({','.join('?' * len(removed))})",
                   [meetup_id, *removed])
    now = utcnow()
    db.executemany('INSERT INTO meetup_invitations (meetup_id, invitee_id, created_at) VALUES (?,?,?)',
                   [(meetup_id, i, now) for i in wanted if i not in existing])


def _submit(m, host, resubmit):
    """Move a DRAFT/REJECTED meetup into the review pipeline and notify everyone involved."""
    db = get_db()
    waiting = [r[0] for r in db.execute(
        "SELECT invitee_id FROM meetup_invitations WHERE meetup_id = ? AND status = 'INVITED'", (m['id'],))]
    new_status = 'PEER_REVIEW' if waiting else 'PENDING'
    db.execute('''UPDATE meetups SET status = ?, submitted_at = ?, updated_at = ?,
                      review_comments = NULL, reviewed_by = NULL, reviewed_at = NULL
                  WHERE id = ?''', (new_status, utcnow(), utcnow(), m['id']))
    log_activity(m['id'], host['id'], 'RESUBMITTED' if resubmit else 'SUBMITTED')
    region = db.execute('SELECT name FROM regions WHERE id = ?', (m['region_id'],)).fetchone()[0]
    if waiting:
        notify(waiting, 'Co-host invitation',
               f'{host["name"]} invited you to co-host "{m["title"]}".', m['id'])
    if new_status == 'PENDING':
        notify(administration_ids(), 'New proposal to review',
               f'"{m["title"]}" from {region} is waiting for a decision.', m['id'])
    notify(house_uhc_ids(m['house_id']), f'New {host["house_name"]} proposal',
           f'{host["name"]} ({region}) {"re" if resubmit else ""}submitted "{m["title"]}".', m['id'])
    return new_status


def _move_to_pending(m, actor_id, note=None):
    db = get_db()
    db.execute("UPDATE meetups SET status = 'PENDING', updated_at = ? WHERE id = ?", (utcnow(), m['id']))
    log_activity(m['id'], actor_id, 'SENT_TO_ADMINISTRATION', note)
    notify(administration_ids(), 'New proposal to review', f'"{m["title"]}" is waiting for a decision.', m['id'])


# ── Read ────────────────────────────────────────────────────────────────────

@bp.get('/meetups')
@login_required()
def index():
    user = current_user()
    where, params = ['1=1'], []
    statuses = [s for s in (request.args.get('status') or '').split(',') if s]
    if statuses:
        where.append(f"m.status IN ({','.join('?' * len(statuses))})")
        params += statuses
    for key in ('house_id', 'region_id', 'category'):
        if request.args.get(key):
            where.append(f'm.{key} = ?')
            params.append(request.args[key])
    if request.args.get('mine'):
        where.append('''(m.proposer_id = ? OR EXISTS (SELECT 1 FROM meetup_invitations mi
                         WHERE mi.meetup_id = m.id AND mi.invitee_id = ? AND mi.status <> 'DECLINED'))''')
        params += [user['id'], user['id']]
    if request.args.get('invited'):
        where.append('''m.status <> 'DRAFT' AND EXISTS (SELECT 1 FROM meetup_invitations mi
                         WHERE mi.meetup_id = m.id AND mi.invitee_id = ?)''')
        params.append(user['id'])
    if request.args.get('when') == 'upcoming':
        where.append('m.event_date >= ?')
        params.append(today_iso())
    elif request.args.get('when') == 'past':
        where.append('m.event_date < ?')
        params.append(today_iso())
    q = (request.args.get('q') or '').strip()
    if q:
        where.append('(m.title LIKE ? OR m.venue LIKE ? OR m.city LIKE ? OR p.name LIKE ?)')
        params += [f'%{q}%'] * 4

    sort = request.args.get('sort')
    order = {
        'date_asc': 'm.event_date ASC, m.start_time ASC',
        'submitted': 'm.submitted_at ASC',
    }.get(sort, 'm.event_date DESC, m.start_time DESC')
    return jsonify(meetups=list_meetups(user, ' AND '.join(where), params, order, limit=200))


@bp.get('/meetups/<int:meetup_id>')
@login_required()
def show(meetup_id):
    user = current_user()
    db = get_db()
    get_visible_meetup(meetup_id, user)
    m = one(db.execute('''
        SELECT m.*, p.name AS proposer_name, p.email AS proposer_email, p.roll_number AS proposer_roll,
               h.name AS house_name, h.slug AS house_slug, h.color AS house_color,
               r.name AS region_name, r.code AS region_code,
               rv.name AS reviewer_name, rv.title AS reviewer_title
        FROM meetups m
        JOIN users p ON p.id = m.proposer_id
        JOIN houses h ON h.id = m.house_id
        JOIN regions r ON r.id = m.region_id
        LEFT JOIN users rv ON rv.id = m.reviewed_by
        WHERE m.id = ?''', (meetup_id,)).fetchone())

    invitations = rows(db.execute('''
        SELECT i.id, i.status, i.response_note, i.responded_at, i.invitee_id,
               u.name, u.roll_number, h.name AS house_name, h.slug AS house_slug, h.color AS house_color
        FROM meetup_invitations i
        JOIN users u ON u.id = i.invitee_id
        JOIN houses h ON h.id = u.house_id
        WHERE i.meetup_id = ?
        ORDER BY CASE i.status WHEN 'ACCEPTED' THEN 0 WHEN 'INVITED' THEN 1 ELSE 2 END, u.name''', (meetup_id,)))
    my_invite = next((i for i in invitations if i['invitee_id'] == user['id']), None)

    activity = rows(db.execute('''
        SELECT a.id, a.action, a.note, a.created_at, a.actor_id, u.name AS actor_name, u.role AS actor_role,
               u.title AS actor_title
        FROM meetup_activity a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.meetup_id = ? ORDER BY a.created_at, a.id''', (meetup_id,)))

    from .claims import claim_for_meetup  # local import: claims depends on common/profile only
    claim = claim_for_meetup(meetup_id, user)

    m['category_label'] = CATEGORIES[m['category']]
    return jsonify(meetup=m, invitations=invitations, my_invitation=my_invite, activity=activity, claim=claim,
                   can=permissions(m, user, my_invite))


@bp.get('/peers')
@login_required(*PROPOSER_ROLES)
def peers():
    """The people the current user may invite as co-hosts."""
    user = current_user()
    clause, params = invitable_clause(user)
    return jsonify(peers=rows(get_db().execute(f'''
        SELECT u.id, u.name, u.roll_number, u.title, h.id AS house_id, h.name AS house_name, h.slug AS house_slug,
               h.color AS house_color
        FROM users u JOIN houses h ON h.id = u.house_id
        WHERE {clause}
        ORDER BY h.name, u.name''', params)), region_name=user['region_name'])


# ── Write ───────────────────────────────────────────────────────────────────

@bp.post('/meetups')
@login_required(*PROPOSER_ROLES)
def create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    submit = bool(data.get('submit'))
    fields = parse_payload(data, for_submit=submit, user=user)
    db = get_db()
    now = utcnow()
    cur = db.execute(f'''INSERT INTO meetups ({', '.join(fields)}, proposer_id, house_id, status,
                             created_at, updated_at)
                         VALUES ({', '.join('?' * len(fields))}, ?, ?, 'DRAFT', ?, ?)''',
                     [*fields.values(), user['id'], user['house_id'], now, now])
    meetup_id = cur.lastrowid
    log_activity(meetup_id, user['id'], 'CREATED')
    _sync_invitations(meetup_id, user, data.get('invitee_ids'))
    status = 'DRAFT'
    if submit:
        status = _submit({**fields, 'id': meetup_id, 'house_id': user['house_id']}, user, resubmit=False)
    db.commit()
    return jsonify(id=meetup_id, status=status), 201


@bp.put('/meetups/<int:meetup_id>')
@login_required(*PROPOSER_ROLES)
def update(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'edit')
    data = request.get_json(silent=True) or {}
    submit = bool(data.get('submit'))
    fields = parse_payload(data, for_submit=submit, user=user)
    db = get_db()
    db.execute(f"UPDATE meetups SET {', '.join(f'{k} = ?' for k in fields)}, updated_at = ? WHERE id = ?",
               [*fields.values(), utcnow(), meetup_id])
    if m['status'] == 'REJECTED':
        log_activity(meetup_id, user['id'], 'EDITED')
    _sync_invitations(meetup_id, user, data.get('invitee_ids'))
    status = m['status']
    if submit:
        status = _submit({**m, **fields}, user, resubmit=m['status'] == 'REJECTED')
    db.commit()
    return jsonify(id=meetup_id, status=status)


@bp.delete('/meetups/<int:meetup_id>')
@login_required(*PROPOSER_ROLES)
def destroy(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'delete')
    db = get_db()
    db.execute('DELETE FROM meetups WHERE id = ?', (meetup_id,))
    db.commit()
    return jsonify(ok=True)


@bp.post('/meetups/<int:meetup_id>/submit')
@login_required(*PROPOSER_ROLES)
def submit(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'submit')
    if m['event_date'] <= today_iso():
        abort(400, 'The meetup date has passed. Edit the date before submitting.')
    status = _submit(m, user, resubmit=m['status'] == 'REJECTED')
    get_db().commit()
    return jsonify(status=status)


@bp.post('/meetups/<int:meetup_id>/send-to-administration')
@login_required(*PROPOSER_ROLES)
def send_to_administration(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'send_to_administration')
    _move_to_pending(m, user['id'], 'Sent without waiting for remaining co-host replies.')
    get_db().commit()
    return jsonify(status='PENDING')


@bp.post('/meetups/<int:meetup_id>/withdraw')
@login_required(*PROPOSER_ROLES)
def withdraw(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'withdraw')
    db = get_db()
    db.execute("UPDATE meetups SET status = 'DRAFT', updated_at = ? WHERE id = ?", (utcnow(), meetup_id))
    log_activity(meetup_id, user['id'], 'WITHDRAWN')
    db.commit()
    return jsonify(status='DRAFT')


@bp.post('/meetups/<int:meetup_id>/review')
@login_required('ADMINISTRATION')
def review(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'review')
    data = request.get_json(silent=True) or {}
    decision = data.get('decision')
    if decision not in ('APPROVE', 'REJECT'):
        abort(400, 'Decision must be APPROVE or REJECT.')
    comments = clean_text(data.get('comments'), 'Feedback', 10, 2000, required=decision == 'REJECT')
    status = 'APPROVED' if decision == 'APPROVE' else 'REJECTED'
    db = get_db()
    now = utcnow()
    if decision == 'APPROVE' and data.get('date_choice') == 'BACKUP':
        if not m['backup_date']:
            abort(400, 'This proposal has no backup date.')
        if m['backup_date'] <= today_iso():
            abort(400, 'The backup date has already passed.')
        # The approved date becomes the meetup's date; the other is kept as the alternate.
        db.execute('UPDATE meetups SET event_date = ?, backup_date = ? WHERE id = ?',
                   (m['backup_date'], m['event_date'], meetup_id))
        comments = f"Approved for the backup date. {comments or ''}".strip()
        m = {**m, 'event_date': m['backup_date']}
    db.execute('UPDATE meetups SET status = ?, review_comments = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? '
               'WHERE id = ?', (status, comments, user['id'], now, now, meetup_id))
    log_activity(meetup_id, user['id'], status, comments)

    cohosts = [r[0] for r in db.execute(
        "SELECT invitee_id FROM meetup_invitations WHERE meetup_id = ? AND status = 'ACCEPTED'", (meetup_id,))]
    if status == 'APPROVED':
        notify([m['proposer_id']], 'Meetup approved', f'"{m["title"]}" was approved.' +
               (f' Note from {user["name"]}: {comments}' if comments else ''), meetup_id)
        notify(cohosts, 'Co-hosted meetup approved', f'"{m["title"]}", which you are co-hosting, was approved.', meetup_id)
    else:
        notify([m['proposer_id']], 'Changes needed', f'"{m["title"]}" was not approved: {comments}', meetup_id)
    notify(house_uhc_ids(m['house_id']), f'Meetup {status.lower()}', f'"{m["title"]}" was {status.lower()}.', meetup_id)
    db.commit()
    return jsonify(status=status)


@bp.post('/meetups/<int:meetup_id>/complete')
@login_required()
def complete(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'complete')
    db = get_db()
    now = utcnow()
    db.execute("UPDATE meetups SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?",
               (now, now, meetup_id))
    log_activity(meetup_id, user['id'], 'COMPLETED')
    if user['id'] != m['proposer_id']:
        notify([m['proposer_id']], 'Meetup marked complete',
               f'"{m["title"]}" is marked complete. You can now file a reimbursement claim.', meetup_id)
    db.commit()
    return jsonify(status='COMPLETED')


@bp.post('/meetups/<int:meetup_id>/cancel')
@login_required()
def cancel(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'cancel')
    reason = clean_text((request.get_json(silent=True) or {}).get('reason'), 'Reason', 5, 1000)
    db = get_db()
    db.execute("UPDATE meetups SET status = 'CANCELLED', updated_at = ? WHERE id = ?", (utcnow(), meetup_id))
    log_activity(meetup_id, user['id'], 'CANCELLED', reason)
    cohosts = [r[0] for r in db.execute(
        "SELECT invitee_id FROM meetup_invitations WHERE meetup_id = ? AND status = 'ACCEPTED'", (meetup_id,))]
    notify([m['proposer_id'], *cohosts], 'Meetup cancelled', f'"{m["title"]}" was cancelled: {reason}', meetup_id)
    db.commit()
    return jsonify(status='CANCELLED')


@bp.post('/meetups/<int:meetup_id>/comments')
@login_required()
def comment(meetup_id):
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'comment')
    body = clean_text((request.get_json(silent=True) or {}).get('body'), 'Comment', 1, 2000)
    log_activity(meetup_id, user['id'], 'COMMENT', body)
    if user['id'] != m['proposer_id']:
        notify([m['proposer_id']], f'New comment from {user["name"]}', body[:140], meetup_id)
    get_db().commit()
    return jsonify(ok=True), 201


@bp.post('/invitations/<int:meetup_id>/respond')
@login_required(*PROPOSER_ROLES)
def respond(meetup_id):
    """Accept/decline a co-host invite. Keyed by meetup id: one invite per (meetup, user)."""
    user = current_user()
    m = get_visible_meetup(meetup_id, user)
    require(m, user, 'respond')
    data = request.get_json(silent=True) or {}
    decision = data.get('decision')
    if decision not in ('ACCEPT', 'DECLINE'):
        abort(400, 'Decision must be ACCEPT or DECLINE.')
    note = clean_text(data.get('note'), 'Note', 0, 500, required=False)
    status = 'ACCEPTED' if decision == 'ACCEPT' else 'DECLINED'
    db = get_db()
    db.execute('UPDATE meetup_invitations SET status = ?, response_note = ?, responded_at = ? '
               'WHERE meetup_id = ? AND invitee_id = ?', (status, note, utcnow(), meetup_id, user['id']))
    log_activity(meetup_id, user['id'], f'INVITE_{status}', note)
    notify([m['proposer_id']], f'Invitation {status.lower()}',
           f'{user["name"]} {status.lower()} your co-host invitation for "{m["title"]}".', meetup_id)

    # Last outstanding reply moves the proposal on to Administration automatically.
    if m['status'] == 'PEER_REVIEW':
        waiting = db.execute("SELECT COUNT(*) FROM meetup_invitations WHERE meetup_id = ? AND status = 'INVITED'",
                             (meetup_id,)).fetchone()[0]
        if waiting == 0:
            _move_to_pending(m, None, 'All co-hosts have replied.')
    db.commit()
    return jsonify(status=status)
