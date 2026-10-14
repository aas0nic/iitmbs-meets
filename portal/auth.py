"""Session-based identity.

The acting user always comes from the signed session cookie — never from a
request body — so role checks on the server can't be bypassed by the client.
Sign-in is a demo account picker for now; swap `sign_in` for institutional
Google OAuth later without touching the endpoints.
"""
from functools import wraps

from flask import Blueprint, abort, g, jsonify, request, session

from .db import get_db, one, rows
from .seed import DEMO_ACCOUNTS

bp = Blueprint('auth', __name__, url_prefix='/api')

USER_SELECT = '''
    SELECT u.id, u.name, u.email, u.role, u.title, u.roll_number, u.is_active,
           u.house_id, h.name AS house_name, h.slug AS house_slug, h.color AS house_color,
           u.region_id, r.name AS region_name, r.code AS region_code
    FROM users u
    LEFT JOIN houses h ON h.id = u.house_id
    LEFT JOIN regions r ON r.id = u.region_id
'''


def load_user(user_id):
    return one(get_db().execute(USER_SELECT + ' WHERE u.id = ?', (user_id,)).fetchone())


def current_user():
    if 'user' not in g:
        uid = session.get('uid')
        user = load_user(uid) if uid else None
        g.user = user if user and user['is_active'] else None  # access revoked → signed out
    return g.user


def login_required(*roles):
    """Require a signed-in user, optionally restricted to the given roles."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                abort(401, 'Sign in to continue.')
            if roles and user['role'] not in roles:
                abort(403, 'Your role does not have access to this action.')
            return fn(*args, **kwargs)
        return wrapper
    return decorator


@bp.get('/session')
def get_session():
    return jsonify(user=current_user())


@bp.post('/session')
def sign_in():
    uid = (request.get_json(silent=True) or {}).get('user_id')
    user = load_user(uid) if uid else None
    if not user:
        abort(404, 'No such account.')
    if not user['is_active']:
        abort(403, 'Portal access for this account is turned off. Contact Administration.')
    session.clear()
    session['uid'] = user['id']
    session.permanent = True
    g.user = user
    return jsonify(user=user)


@bp.delete('/session')
def sign_out():
    session.clear()
    return jsonify(ok=True)


@bp.get('/directory')
def directory():
    """Roster for the demo sign-in screen."""
    q = (request.args.get('q') or '').strip()
    sql = USER_SELECT + ' WHERE u.is_active = 1'
    params = []
    if q:
        sql += ' AND (u.name LIKE ? OR u.roll_number LIKE ? OR h.name LIKE ? OR r.name LIKE ?)'
        params += [f'%{q}%'] * 4
    sql += " ORDER BY CASE u.role WHEN 'ADMINISTRATION' THEN 0 WHEN 'UHC' THEN 1 ELSE 2 END, h.name, r.id, u.name LIMIT 60"
    db = get_db()
    featured = [u for u in (load_user(uid) for uid in DEMO_ACCOUNTS) if u and u['is_active']]
    return jsonify(users=rows(db.execute(sql, params)), featured=featured)
