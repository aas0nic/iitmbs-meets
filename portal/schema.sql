-- IITM BS Meetup Approval Portal — SQLite schema
-- Bump SCHEMA_VERSION in portal/db.py whenever this file changes; an outdated
-- database is rebuilt from seed on startup.

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS claim_files;
DROP TABLE IF EXISTS claims;
DROP TABLE IF EXISTS meetup_activity;
DROP TABLE IF EXISTS meetup_invitations;
DROP TABLE IF EXISTS meetups;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS houses;
-- legacy tables from schema v1
DROP TABLE IF EXISTS reimbursements;
DROP TABLE IF EXISTS meetup_proposals;

-- ── Organisation ────────────────────────────────────────────────────────────

CREATE TABLE houses (
    id      INTEGER PRIMARY KEY,
    slug    TEXT NOT NULL UNIQUE,          -- matches static/img/houses/<slug>.png
    name    TEXT NOT NULL UNIQUE,
    motto   TEXT,
    color   TEXT NOT NULL
);

CREATE TABLE regions (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,          -- DEL, MAA, BLR …
    name    TEXT NOT NULL UNIQUE,
    states  TEXT
);

CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL CHECK (role IN ('MANAGEMENT', 'UHC', 'LHC')),
    title       TEXT,                      -- e.g. "Student Activities Office", "House Secretary"
    house_id    INTEGER REFERENCES houses(id),
    region_id   INTEGER REFERENCES regions(id),
    roll_number TEXT UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    -- Each tier has a fixed shape: LHC = house + region, UHC = house only, Management = neither.
    CHECK (
        (role = 'LHC'        AND house_id IS NOT NULL AND region_id IS NOT NULL) OR
        (role = 'UHC'        AND house_id IS NOT NULL AND region_id IS NULL)     OR
        (role = 'MANAGEMENT' AND house_id IS NULL     AND region_id IS NULL)
    )
);
CREATE INDEX idx_users_role_region ON users(role, region_id);
CREATE INDEX idx_users_role_house  ON users(role, house_id);

-- ── Meetups ─────────────────────────────────────────────────────────────────

CREATE TABLE meetups (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    title              TEXT NOT NULL,
    description        TEXT NOT NULL,
    category           TEXT NOT NULL CHECK (category IN (
                           'STUDY_JAM', 'HACKATHON', 'PROJECT', 'NETWORKING',
                           'ALUMNI_TALK', 'CULTURAL', 'SPORTS')),
    proposer_id        TEXT NOT NULL REFERENCES users(id),
    house_id           INTEGER NOT NULL REFERENCES houses(id),    -- proposer's house at time of proposal
    region_id          INTEGER NOT NULL REFERENCES regions(id),   -- proposer's region at time of proposal
    event_date         TEXT NOT NULL,                             -- YYYY-MM-DD
    start_time         TEXT NOT NULL,                             -- HH:MM (24h)
    end_time           TEXT NOT NULL,                             -- HH:MM (24h)
    venue              TEXT NOT NULL,                             -- meetups are offline-only
    expected_attendees INTEGER NOT NULL CHECK (expected_attendees > 0),
    budget_requested   INTEGER NOT NULL DEFAULT 0 CHECK (budget_requested >= 0),  -- whole rupees
    budget_breakdown   TEXT,
    status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                           'DRAFT', 'PEER_REVIEW', 'PENDING', 'APPROVED',
                           'REJECTED', 'COMPLETED', 'CANCELLED')),
    review_comments    TEXT,                                      -- mandatory when REJECTED
    reviewed_by        TEXT REFERENCES users(id),
    reviewed_at        TEXT,
    submitted_at       TEXT,                                      -- latest submission (first or re-submit)
    completed_at       TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (status <> 'REJECTED' OR length(trim(coalesce(review_comments, ''))) > 0),
    CHECK (end_time > start_time)
);
CREATE INDEX idx_meetups_status   ON meetups(status);
CREATE INDEX idx_meetups_region   ON meetups(region_id, status);
CREATE INDEX idx_meetups_house    ON meetups(house_id, status);
CREATE INDEX idx_meetups_proposer ON meetups(proposer_id);
CREATE INDEX idx_meetups_date     ON meetups(event_date);

-- Co-host invitations. Same-region rule is enforced in the API layer
-- (portal/api/meetups.py::_sync_invitations) because SQLite CHECKs can't see other rows.
CREATE TABLE meetup_invitations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    meetup_id     INTEGER NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
    invitee_id    TEXT NOT NULL REFERENCES users(id),
    status        TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'ACCEPTED', 'DECLINED')),
    response_note TEXT,
    responded_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (meetup_id, invitee_id)
);
CREATE INDEX idx_invitations_invitee ON meetup_invitations(invitee_id, status);

-- Append-only audit trail + discussion thread for a meetup.
CREATE TABLE meetup_activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    meetup_id  INTEGER NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
    actor_id   TEXT REFERENCES users(id),
    action     TEXT NOT NULL CHECK (action IN (
                   'CREATED', 'EDITED', 'SUBMITTED', 'RESUBMITTED', 'WITHDRAWN',
                   'INVITE_ACCEPTED', 'INVITE_DECLINED', 'SENT_TO_MANAGEMENT',
                   'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'COMMENT',
                   'CLAIM_FILED', 'CLAIM_IN_PROGRESS', 'CLAIM_APPROVED', 'CLAIM_REJECTED')),
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activity_meetup ON meetup_activity(meetup_id, created_at);

-- ── Reimbursement claims ────────────────────────────────────────────────────

CREATE TABLE claims (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    meetup_id         INTEGER NOT NULL UNIQUE REFERENCES meetups(id) ON DELETE CASCADE,
    claimant_id       TEXT NOT NULL REFERENCES users(id),
    amount_claimed    INTEGER NOT NULL CHECK (amount_claimed > 0),
    amount_approved   INTEGER CHECK (amount_approved IS NULL OR amount_approved >= 0),
    actual_attendance INTEGER NOT NULL CHECK (actual_attendance >= 0),
    attendance_notes  TEXT,
    expense_notes     TEXT NOT NULL,
    payout_details    TEXT NOT NULL,                              -- UPI id / bank account
    status            TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN (
                          'PENDING_REVIEW', 'IN_PROGRESS', 'APPROVED', 'REJECTED')),
    review_notes      TEXT,
    reviewed_by       TEXT REFERENCES users(id),
    reviewed_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (status <> 'REJECTED' OR length(trim(coalesce(review_notes, ''))) > 0)
);
CREATE INDEX idx_claims_status ON claims(status);

CREATE TABLE claim_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id      INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL UNIQUE,                           -- file under data/uploads/
    size_bytes    INTEGER NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Notifications ───────────────────────────────────────────────────────────

CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    meetup_id  INTEGER REFERENCES meetups(id) ON DELETE CASCADE,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at);
