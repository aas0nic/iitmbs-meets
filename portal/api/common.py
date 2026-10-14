"""Helpers shared by the API blueprints: constants, visibility rules, notifications."""
import re
from datetime import date

from flask import abort

from ..db import get_db, utcnow

CATEGORIES = {
    'STUDY_JAM': 'Study jam',
    'HACKATHON': 'Hackathon',
    'PROJECT': 'Project collaboration',
    'NETWORKING': 'Peer networking',
    'ALUMNI_TALK': 'Alumni talk',
    'CULTURAL': 'Cultural',
    'SPORTS': 'Sports',
}

# Statuses a meetup can be in when its co-host invitations are live.
INVITES_OPEN = ('PEER_REVIEW', 'PENDING', 'APPROVED')

TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')


def today_iso():
    return date.today().isoformat()


def visibility_clause(user, alias='m'):
    """SQL predicate (and params) limiting meetups to what `user` may see.

    Management and UHC see every submitted meetup. An LHC sees their own
    meetups (drafts included), meetups they're invited to, everything
    submitted in their own region, and approved/completed meetups anywhere.
    """
    if user['role'] in ('MANAGEMENT', 'UHC'):
        return f"{alias}.status <> 'DRAFT'", []
    return (
        f"""({alias}.proposer_id = ?
            OR ({alias}.status <> 'DRAFT' AND (
                {alias}.region_id = ?
                OR {alias}.status IN ('APPROVED', 'COMPLETED')
                OR EXISTS (SELECT 1 FROM meetup_invitations vi
                           WHERE vi.meetup_id = {alias}.id AND vi.invitee_id = ?))))""",
        [user['id'], user['region_id'], user['id']],
    )


def get_visible_meetup(meetup_id, user):
    clause, params = visibility_clause(user)
    row = get_db().execute(f'SELECT m.* FROM meetups m WHERE m.id = ? AND {clause}',
                           [meetup_id, *params]).fetchone()
    if row is None:
        abort(404, 'Meetup not found.')
    return dict(row)


def notify(user_ids, title, body, meetup_id=None):
    db = get_db()
    now = utcnow()
    db.executemany(
        'INSERT INTO notifications (user_id, title, body, meetup_id, created_at) VALUES (?,?,?,?,?)',
        [(uid, title, body, meetup_id, now) for uid in dict.fromkeys(user_ids) if uid])


def management_ids():
    return [r[0] for r in get_db().execute("SELECT id FROM users WHERE role = 'MANAGEMENT'")]


def house_uhc_ids(house_id):
    return [r[0] for r in get_db().execute("SELECT id FROM users WHERE role = 'UHC' AND house_id = ?", (house_id,))]


def log_activity(meetup_id, actor_id, action, note=None):
    get_db().execute('INSERT INTO meetup_activity (meetup_id, actor_id, action, note, created_at) VALUES (?,?,?,?,?)',
                     (meetup_id, actor_id, action, note, utcnow()))


def clean_text(value, field, min_len=0, max_len=4000, required=True):
    text = (value or '').strip() if isinstance(value, str) else ('' if value is None else str(value).strip())
    if required and not text:
        abort(400, f'{field} is required.')
    if text and len(text) < min_len:
        abort(400, f'{field} must be at least {min_len} characters.')
    if len(text) > max_len:
        abort(400, f'{field} must be at most {max_len} characters.')
    return text or None


def clean_int(value, field, lo, hi):
    try:
        n = int(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        abort(400, f'{field} must be a whole number.')
    if not lo <= n <= hi:
        abort(400, f'{field} must be between {lo:,} and {hi:,}.')
    return n
