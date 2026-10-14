-- IITM BS Meetup Approval Portal — SQLite schema
-- Bump SCHEMA_VERSION in portal/db.py whenever this file changes; an outdated
-- database is rebuilt from seed on startup.

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS payout_details;
DROP TABLE IF EXISTS claim_attendees;
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
    email       TEXT NOT NULL UNIQUE,          -- UHC: fixed seat address handed over after elections; LHC: student ID email
    role        TEXT NOT NULL CHECK (role IN ('ADMINISTRATION', 'UHC', 'LHC')),
    title       TEXT,                      -- e.g. "Student Activities Office", "House Secretary"
    house_id    INTEGER REFERENCES houses(id),
    region_id   INTEGER REFERENCES regions(id),
    roll_number TEXT UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),   -- portal access on/off (Administration)
    updated_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    -- Each tier has a fixed shape: LHC = house + region, UHC = house only, Administration = neither.
    CHECK (
        (role = 'LHC'        AND house_id IS NOT NULL AND region_id IS NOT NULL) OR
        (role = 'UHC'        AND house_id IS NOT NULL AND region_id IS NULL)     OR
        (role = 'ADMINISTRATION' AND house_id IS NULL     AND region_id IS NULL)
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
    region_id          INTEGER NOT NULL REFERENCES regions(id),   -- LHC: own region; UHC: any region they choose
    event_date         TEXT NOT NULL,                             -- YYYY-MM-DD; preferred date, or the approved one once decided
    backup_date        TEXT,                                      -- alternate date Administration may approve instead
    start_time         TEXT NOT NULL,                             -- HH:MM (24h)
    end_time           TEXT NOT NULL,                             -- HH:MM (24h)
    city               TEXT NOT NULL,                             -- meetups are offline-only
    venue              TEXT NOT NULL,                             -- location name (shown as "Location")
    map_link           TEXT NOT NULL,                             -- e.g. a Google Maps link to the location
    expected_attendees INTEGER NOT NULL CHECK (expected_attendees > 0),
    budget_per_head    INTEGER NOT NULL DEFAULT 200 CHECK (budget_per_head >= 0),  -- standard allowance (₹) at time of proposal
    extra_budget       INTEGER NOT NULL DEFAULT 0 CHECK (extra_budget >= 0),       -- on top of the allowance, e.g. venue booking
    extra_budget_note  TEXT,                                                       -- required when extra_budget > 0
    budget_requested   INTEGER NOT NULL DEFAULT 0 CHECK (budget_requested >= 0),  -- per_head × attendees + extra (whole rupees)
    -- Optional collaboration with an IITM society or an external organisation
    collab_type        TEXT NOT NULL DEFAULT 'NONE' CHECK (collab_type IN ('NONE', 'SOCIETY', 'EXTERNAL')),
    collab_name        TEXT,                                      -- society / organisation name
    collab_about       TEXT,                                      -- EXTERNAL: what the organisation is
    collab_agenda      TEXT,                                      -- what the collaboration involves
    collab_contact     TEXT,                                      -- point of contact on their side
    collab_sponsored   INTEGER CHECK (collab_sponsored IN (0, 1)),-- EXTERNAL: is there sponsorship?
    collab_sponsorship TEXT,                                      -- amount / in-kind, and what they expect in return
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
    CHECK (end_time > start_time),
    CHECK (backup_date IS NULL OR backup_date <> event_date),
    CHECK (extra_budget = 0 OR length(trim(coalesce(extra_budget_note, ''))) > 0),
    CHECK (budget_requested = budget_per_head * expected_attendees + extra_budget),
    CHECK (collab_type = 'NONE' OR (length(trim(coalesce(collab_name, ''))) > 0
                                    AND length(trim(coalesce(collab_agenda, ''))) > 0
                                    AND length(trim(coalesce(collab_contact, ''))) > 0)),
    CHECK (collab_type <> 'EXTERNAL' OR (length(trim(coalesce(collab_about, ''))) > 0 AND collab_sponsored IS NOT NULL)),
    CHECK (coalesce(collab_sponsored, 0) = 0 OR length(trim(coalesce(collab_sponsorship, ''))) > 0)
);
CREATE INDEX idx_meetups_status   ON meetups(status);
CREATE INDEX idx_meetups_region   ON meetups(region_id, status);
CREATE INDEX idx_meetups_house    ON meetups(house_id, status);
CREATE INDEX idx_meetups_proposer ON meetups(proposer_id);
CREATE INDEX idx_meetups_date     ON meetups(event_date);

-- Co-host invitations. Who may be invited is enforced in the API layer
-- (LHC host → LHCs of the same region; UHC host → other UHC members)
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
                   'INVITE_ACCEPTED', 'INVITE_DECLINED', 'SENT_TO_ADMINISTRATION',
                   'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'COMMENT',
                   'CLAIM_FILED', 'CLAIM_PAYEE_CONFIRMED', 'CLAIM_PAYEE_DECLINED',
                   'CLAIM_IN_PROGRESS', 'CLAIM_APPROVED', 'CLAIM_REJECTED')),
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activity_meetup ON meetup_activity(meetup_id, created_at);

-- ── Reimbursement claims ────────────────────────────────────────────────────

CREATE TABLE claims (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    meetup_id          INTEGER NOT NULL UNIQUE REFERENCES meetups(id) ON DELETE CASCADE,
    claimant_id        TEXT NOT NULL REFERENCES users(id),
    amount_claimed     INTEGER NOT NULL CHECK (amount_claimed > 0),      -- may exceed the approved budget
    amount_approved    INTEGER CHECK (amount_approved IS NULL OR amount_approved >= 0),
    actual_attendance  INTEGER NOT NULL CHECK (actual_attendance >= 0),  -- = rows in claim_attendees
    expense_notes      TEXT NOT NULL,
    post_link          TEXT NOT NULL,                                    -- social post about the meetup (e.g. Instagram)
    -- Who gets paid. SELF = the claimant; OTHER = a student whose details the claimant entered;
    -- COHOST = a co-host from another house, paid to their saved details (hidden from the claimant)
    -- after they confirm them.
    payout_mode        TEXT NOT NULL CHECK (payout_mode IN ('SELF', 'OTHER', 'COHOST')),
    payee_user_id      TEXT REFERENCES users(id),                        -- SELF: claimant · COHOST: the co-host
    payee_name         TEXT,                                             -- bank snapshot used for the payout
    bank_name          TEXT,
    account_number     TEXT,
    ifsc               TEXT,
    upi_id             TEXT,
    payee_note         TEXT,                                             -- co-host's note when declining
    payee_responded_at TEXT,
    status             TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN (
                           'AWAITING_PAYEE', 'PAYEE_DECLINED',               -- co-host payout only
                           'PENDING_REVIEW', 'IN_PROGRESS', 'APPROVED', 'REJECTED')),
    review_notes       TEXT,
    reviewed_by        TEXT REFERENCES users(id),
    reviewed_at        TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (status <> 'REJECTED' OR length(trim(coalesce(review_notes, ''))) > 0),
    CHECK (payout_mode = 'OTHER' OR payee_user_id IS NOT NULL),
    -- Once a claim reaches Administration, it must carry complete bank details.
    CHECK (status IN ('AWAITING_PAYEE', 'PAYEE_DECLINED')
           OR (payee_name IS NOT NULL AND bank_name IS NOT NULL AND account_number IS NOT NULL AND ifsc IS NOT NULL))
);
CREATE INDEX idx_claims_status ON claims(status);

CREATE INDEX idx_claims_payee ON claims(payee_user_id, status);

-- Students who attended, as entered or imported (CSV / Excel) with the claim.
CREATE TABLE claim_attendees (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    email    TEXT NOT NULL,
    UNIQUE (claim_id, email)
);

CREATE TABLE claim_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id      INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL UNIQUE,                           -- file under data/uploads/
    size_bytes    INTEGER NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Saved payout details (LHC / UHC), used to pre-fill reimbursement claims ──

CREATE TABLE payout_details (
    user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    account_holder TEXT NOT NULL,
    bank_name      TEXT NOT NULL,
    account_number TEXT NOT NULL,
    ifsc           TEXT NOT NULL,
    upi_id         TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
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
