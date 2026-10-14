"""SQLite connection handling and schema bootstrap.

Timestamps are stored as UTC strings ('YYYY-MM-DD HH:MM:SS'); the browser
localises them. Event dates/times are stored as the organiser entered them.
"""
import os
import sqlite3
from datetime import datetime, timezone

from flask import g

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'iitmbs_meets.db')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), 'schema.sql')

SCHEMA_VERSION = 8


def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def get_db():
    """Per-request connection, closed in teardown."""
    if 'db' not in g:
        g.db = connect()
    return g.db


def close_db(_exc=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def utcnow():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def rows(cursor_or_list):
    return [dict(r) for r in cursor_or_list]


def one(row):
    return dict(row) if row is not None else None


def reset_database():
    """Drop everything, recreate from schema.sql, seed demo data, clear uploads."""
    from .seed import seed

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
        if os.path.isfile(path):
            os.remove(path)

    # Cleanly remove existing database file to prevent foreign key drop order issues
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
        except OSError:
            pass

    conn = connect()
    with open(SCHEMA_PATH, encoding='utf-8') as f:
        conn.executescript(f.read())
    seed(conn)
    conn.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
    conn.commit()
    conn.close()


def ensure_database():
    """Create/seed the DB on first run, or rebuild it if the schema is outdated."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    needs_reset = not os.path.exists(DB_PATH)
    if not needs_reset:
        conn = connect()
        version = conn.execute('PRAGMA user_version').fetchone()[0]
        conn.close()
        needs_reset = version != SCHEMA_VERSION
    if needs_reset:
        reset_database()
