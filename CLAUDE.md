# CLAUDE.md — Instructions for Claude AI Assistant

## ⚠️ MANDATORY: Read PROJECT.md first, and keep it updated

> [!IMPORTANT]
> **[`PROJECT.md`](PROJECT.md) is the living reference for this codebase** — product, every business rule,
> architecture, routes, data model, design system, gotchas, how to verify, and a dated change log.
> Read it before any change. **Every change that touches a feature, rule, schema, API or UI convention must
> update `PROJECT.md` in the same change** (relevant section + a dated line in its change log).
> Verify with `node tools/e2e.mjs` (extend it for new workflows) and `node tools/shoot.mjs` for screenshots.

## ⚠️ MANDATORY: Refer to WORKFLOW.md for System Truth

> [!IMPORTANT]
> **Always refer to [`WORKFLOW.md`](file:///Users/itz_ats_sama/iitmbs-meets/WORKFLOW.md)** before designing, implementing, refactoring, or modifying any feature in this repository.
>
> `WORKFLOW.md` is the **single authoritative source of truth** for:
> 1. Complete institutional hierarchy (12 Houses & 10 Geographic Regions).
> 2. Role-Based Access Control (RBAC) permissions matrix across Management, UHC, and LHC.
> 3. Meetup proposal state transition lifecycle (`DRAFT` → `PEER_REVIEW` → `PENDING` → `APPROVED` / `REJECTED` → `COMPLETED`).
> 4. Regional peer invitation constraints and rules.
> 5. Post-meetup reimbursement verification workflow.
> 6. SQLite database schema definitions and entity relationships.
> 7. REST API endpoint contracts, payloads, and response structures.

---

## 1. Project Overview

The **IIT Madras BS Degree Meetup Approval Portal** is an institutional governance and event management platform. It allows Lower House Council (LHC) representatives across India and abroad to propose, co-host, and manage local student meetups, while providing the central Management team with review, approval, budget tracking, and reimbursement oversight.

### Tech Stack
- **Backend**: Python 3.8+ / Flask, organised as the `portal/` package (app factory in `portal/__init__.py`, entry point `app.py`)
- **Database**: SQLite3 (`data/iitmbs_meets.db`), schema in `portal/schema.sql`, demo seed in `portal/seed.py`
- **Frontend**: Vanilla JavaScript ES modules (`static/js/app.js` + `static/js/views/*.js`), Vanilla CSS (`static/css/style.css`), Jinja2 shell (`templates/index.html`)
- **Dependencies**: `Flask` only at runtime (Pillow was used once for asset cropping)

---

## 2. Institutional Hierarchy & Core Rules

### 2.1 The Two Axes
- **Vertical Axis (12 Houses)**: Bandipur, Corbett, Gir, Kanha, Kaziranga, Nallamala, Namdapha, Nilgiri, Pichavaram, Saranda, Sundarbans, Wayanad.
- **Horizontal Axis (10 Geographic Regions)**: Delhi (NCR), Chennai, Bengaluru, Hyderabad, Mumbai, Kolkata, Patna, Chandigarh, Lucknow, International.

### 2.2 User Hierarchy (Total: 157+ Roster)
1. **Management (Central Authority)**:
   - Final authority to approve or reject meetups (with mandatory feedback).
   - Reviews and verifies post-meetup reimbursement claims.
   - Can inspect global analytics across all 12 houses and 10 regions.
2. **Upper House Council (UHC — 36 Members / 3 per House)**:
   - House leadership and mentorship tier.
   - Read-only calendar and oversight access over house activities.
3. **Lower House Council (LHC — 120 Members / 10 per House)**:
   - Grassroots event organizers.
   - Each LHC belongs to **1 House** and is physically located in **1 Geographic Region** (~12 LHCs per region).

### 2.3 Strict Business Constraints (Do NOT violate)
- **Regional Peer Co-Hosting Rule**: When an LHC proposes a meetup, they can **ONLY** invite fellow LHC members from their **exact same geographic region** (`region_id`), regardless of house. Cross-region LHC invites are disallowed. (UHC proposers invite UHC members instead — see below.)
- **Peer Review Threshold**: If peer invites are issued, the meetup stays in `PEER_REVIEW` until peers accept/decline, or the host fast-forwards submission to Management review (`PENDING`).
- **Management Feedback**: Rejection by Management requires mandatory explanation text stored in `review_comments`.
- **UHC Proposals**: UHC members can also propose meetups, in **any** of the 10 regions (they pick `region_id`), and can only invite **other UHC members** (any house) as co-hosts. LHCs still propose for their own region and invite same-region LHCs. See `invitable_clause()` in `portal/api/meetups.py`.
- **Collaboration**: `collab_type` is `NONE`, `SOCIETY` (IITM BS society) or `EXTERNAL` (outside body). For SOCIETY/EXTERNAL, name, plan/agenda and point of contact are mandatory; EXTERNAL also requires "about the organisation" and a sponsorship yes/no, with details when yes.
- **Mandatory Fields**: Every proposal field is required (including the backup date) except co-hosts and the collaboration block. The form validates client-side, marks each missing field inline and scrolls/focuses to the first; the server re-validates everything.
- **Payout Details**: LHC/UHC members can save default bank details (`payout_details` table, `/api/me/payout`).
- **Claims**: filed on a full page (`#/meetups/:id/claim`) with an attendee list (manual or CSV/XLSX import via `/api/attendees/parse`), amount suggested at ₹200 × attendees (overrun allowed), receipts, a post link, and a payee: SELF (saved back to profile), OTHER (typed details), or COHOST (accepted co-host from another house; their saved details are hidden from the claimant and they must confirm before Management sees the claim). Bank fields are only returned to Management, the payee, and the claimant for SELF/OTHER (`claims.present()`).
- **Insights per role**: Management → institute-wide (`/api/stats`); UHC → own house (`/api/insights/house`); LHC → self + region (`/api/insights/me`).
- **Offline Only**: Every meetup is held in person at a physical venue (`venue` is required). There is no online/hybrid mode.
- **Dates**: A proposal has a preferred date (`event_date`) and an optional backup date (`backup_date`). When approving, Management picks one; choosing the backup swaps the two so `event_date` is always the date on the calendar.
- **Budget**: Standard allowance is ₹200 × expected attendees (`BUDGET_PER_HEAD` in `portal/api/common.py`, mirrored in `portal/seed.py`). Hosts may request `extra_budget` on top (e.g. venue booking for large meetups) with a mandatory `extra_budget_note`. `budget_requested` = allowance + extra and is computed server-side, never taken from the client.
- **Reimbursement Eligibility**: Only `APPROVED` or `COMPLETED` meetups can file expense claims with bill receipts.

---

## 3. Design System & Frontend Constraints

### 3.1 Strict Styling Directives
- **NO Tailwind CSS**: The project strictly uses hand-crafted Vanilla CSS in `static/css/style.css`. Do not add Tailwind or external CSS utility frameworks.
- **NO Frontend Build Steps**: No Node.js build pipeline, no Webpack/Vite, no NPM bundling. Keep standard native HTML, CSS, and JS served directly by Flask.
- **Design Aesthetic**: Quiet, premium and low-gloss (reference points: Linear, Things, Notion Calendar). No blur/glassmorphism, glows, gradients or emoji; status is shown as a small glyph + muted label, not saturated pills. Accent colour is used sparingly.
- **Theme system** (tokens in `static/css/style.css`, picked in Settings, stored per device in `localStorage.prefs`):
  - `data-theme`: `light` (warm paper `#F3F0E9`), `dark` (soft graphite `#141317`, default), `black` (true black for OLED); Auto follows the OS.
  - `data-accent`: terracotta (default, IITM), maroon, indigo, forest, ocean, gold, graphite — each defines `--a-dark` / `--a-light`; components only use `--accent`, `--accent-text`, `--accent-soft`.
  - `data-font`: Plus Jakarta Sans (default), Inter, Geist. JetBrains Mono is only for roll numbers; numbers use tabular figures of the UI font.
  - Never hard-code colours in components; add a token instead.

### 3.2 Mobile Responsiveness Rules
- Must maintain a **native-app feel on mobile devices** (`<768px` and 375px–430px iPhone viewports):
  - **Zero horizontal scroll/overflow** (`overflow-x: hidden`).
  - Top bar (`.topbar`) with hamburger, brand, new-proposal shortcut, notifications and avatar.
  - Off-canvas sidebar drawer (`.sidebar.open`) over a blurred scrim (`#scrim`).
  - Bottom tab bar (`.tabbar`) with four role-specific destinations plus **Me** (account menu).
  - Dialogs (`<dialog id="dialog">`, opened with `openDialog()` in `ui.js`) render as bottom sheets on phones.

---

## 4. Repository Structure & Key Files

| Path | Purpose |
| :--- | :--- |
| [`WORKFLOW.md`](WORKFLOW.md) | **Master specification**: RBAC matrix, lifecycle diagram, schema, API contracts. |
| [`app.py`](app.py) | Entry point — `python app.py` serves on port 5050. |
| [`portal/__init__.py`](portal/__init__.py) | Flask app factory: config, blueprints, JSON error handling, asset versioning. |
| [`portal/schema.sql`](portal/schema.sql) | All tables, CHECK constraints and indexes. Bump `SCHEMA_VERSION` in `portal/db.py` after editing. |
| [`portal/db.py`](portal/db.py) | Connections (per request via `flask.g`), schema version check, reset. |
| [`portal/seed.py`](portal/seed.py) | 12 houses, 10 regions, 2 Management + 36 UHC + 120 LHC, sample meetups relative to today. |
| [`portal/auth.py`](portal/auth.py) | Session sign-in and `login_required(*roles)`. The acting user always comes from the session. |
| [`portal/api/meetups.py`](portal/api/meetups.py) | Meetup lifecycle, `permissions()` (single source of who-can-do-what), invitations, comments. |
| [`portal/api/claims.py`](portal/api/claims.py) | Reimbursement claims and receipt uploads (`data/uploads/`). |
| [`portal/api/overview.py`](portal/api/overview.py) | Role-specific home data, stats, notifications, badges, admin reset. |
| [`templates/index.html`](templates/index.html) | App shell, SVG icon sprite, overlay containers. |
| [`static/css/style.css`](static/css/style.css) | Design tokens (dark + light), components, responsive tiers. |
| [`static/js/app.js`](static/js/app.js) | Boot, session, hash router, navigation, notifications, account menu, sign-in screen. |
| [`static/js/ui.js`](static/js/ui.js) | Escaping `html` template tag, formatters, status glyphs, shared components, dialog/popover/toast, appearance prefs. |
| [`static/js/calendar.js`](static/js/calendar.js) | Month calendar + day agenda used on every home screen (`/api/calendar`). |
| [`static/js/palette.js`](static/js/palette.js) | ⌘K command palette: pages, actions, theme switching, meetup search. |
| [`static/js/views/`](static/js/views/) | One module per screen: `home`, `meetups`, `detail`, `propose`, `invites`, `claims`, `insights`, `settings`. |
| [`static/img/`](static/img/) | Official IITM crest and the 12 circular house crests (`houses/<slug>.png`). |

## 5. Development & Testing Commands

### Setup & Run
```bash
# Activate virtual environment
source .venv/bin/activate

# Install dependencies (if needed)
pip install -r requirements.txt

# Run server (default port: 5050)
python app.py
```
Application URL: `http://127.0.0.1:5050`

### Database Management
- Database file is stored at `data/iitmbs_meets.db`.
- To re-initialize seed data from scratch, either:
  - Delete `data/iitmbs_meets.db` and restart `app.py`.
  - Or sign in as Management and use **Settings → Reset database**.
- The database is rebuilt automatically when `SCHEMA_VERSION` in `portal/db.py` changes.

---

## 6. Guidelines for Making Code Changes

When working on this repository, Claude should follow these rules:

1. **Check `WORKFLOW.md` first**: Do not invent new roles, bypass hierarchy checks, or alter status enums without ensuring consistency with [`WORKFLOW.md`](file:///Users/itz_ats_sama/iitmbs-meets/WORKFLOW.md).
2. **Preserve RBAC**: Never read the acting user from a request body — use `current_user()` and `login_required(...)`. Lifecycle actions go through `permissions()` / `require()` in `portal/api/meetups.py`.
3. **Maintain Mobile Parity**: Any new UI must work at all three tiers (sidebar ≥1180px, icon rail 768–1179px, phone <768px with drawer, bottom tab bar and bottom-sheet dialogs via `openDialog`).
4. **Cache Invalidation**: `?v={{ v }}` is the newest CSS/JS mtime; static files are served with `max-age=0` so modules revalidate. Import JS modules by relative path without a query string — importing `app.js` from a view would load a second copy of the app.
5. **No Regressions on Assets**: Always use the authentic extracted circular crests in `static/img/houses/` rather than placeholder SVGs.
