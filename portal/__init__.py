"""IITM BS Meetup Approval Portal — Flask application factory."""
import os
import secrets
from datetime import timedelta

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from . import auth, db
from .api import blueprints

STATIC_VERSION_FILES = ('static/css/style.css', 'static/js')


def _secret_key():
    """Stable per-install secret so sessions survive restarts. Override with SECRET_KEY in production."""
    if os.environ.get('SECRET_KEY'):
        return os.environ['SECRET_KEY']
    path = os.path.join(db.DATA_DIR, '.secret_key')
    os.makedirs(db.DATA_DIR, exist_ok=True)
    if not os.path.exists(path):
        with open(path, 'w') as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


def _asset_version(root):
    """Newest mtime across CSS/JS so browsers refetch only when files change."""
    latest = 0
    for rel in STATIC_VERSION_FILES:
        path = os.path.join(root, rel)
        if os.path.isdir(path):
            for dirpath, _, files in os.walk(path):
                for name in files:
                    latest = max(latest, os.path.getmtime(os.path.join(dirpath, name)))
        elif os.path.exists(path):
            latest = max(latest, os.path.getmtime(path))
    return int(latest)


def create_app():
    root = db.BASE_DIR
    app = Flask(__name__, static_folder=os.path.join(root, 'static'), template_folder=os.path.join(root, 'templates'))
    app.config.update(
        SECRET_KEY=_secret_key(),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        PERMANENT_SESSION_LIFETIME=timedelta(days=14),
        MAX_CONTENT_LENGTH=25 * 1024 * 1024,  # receipts upload cap
        SEND_FILE_MAX_AGE_DEFAULT=0,  # static files revalidate; ?v= busts the entry points
    )

    db.ensure_database()
    app.teardown_appcontext(db.close_db)

    app.register_blueprint(auth.bp)
    for bp in blueprints:
        app.register_blueprint(bp)

    @app.errorhandler(HTTPException)
    def http_error(err):
        if request.path.startswith('/api/'):
            return jsonify(error=err.description or err.name), err.code
        return err

    @app.after_request
    def no_cache_api(response):
        if request.path.startswith('/api/') or request.path == '/':
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/')
    def index():
        return render_template('index.html', v=_asset_version(root))

    return app
