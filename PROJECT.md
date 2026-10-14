# PROJECT.md — Meetup Planner (IIT Madras BS) · living project reference

> **Purpose of this file.** The single, complete reference for anyone (human or Claude) changing this
> codebase: what the product does, every rule it enforces, how the code is organised, how to verify a
> change, and the history of decisions. **Update it in the same change as any feature, rule, schema,
> API, or UI convention change** — the "Change log" at the bottom gets a dated line every time.
>
> Related docs: `CLAUDE.md` (short rules for Claude, points here) · `WORKFLOW.md` (formal spec: RBAC
> matrix, lifecycle diagrams, API contract) · `README.md` (quick start).
>
> Last updated: **2026-10-14** (schema version **8**)
>
> **Naming:** the top tier is **Administration** everywhere — UI text and code alike: role key
> `ADMINISTRATION`, `administration_ids()`, `permissions().send_to_administration`, demo ids `admin-1`/`admin-2`.
> (It was called "Management" / `MANAGEMENT` before 2026-10-14; People import still accepts that old label.)

---

## 1. What the product is

**Meetup Planner** is the IIT Madras BS Degree portal where house councils propose offline student
meetups, get them approved by Administration, and get reimbursed afterwards.

- **12 houses** (vertical identity): Bandipur, Corbett, Gir, Kanha, Kaziranga, Nallamala, Namdapha,
  Nilgiri, Pichavaram, Saranda, Sundarbans, Wayanad. Crests: `static/img/houses/<slug>.png`
  (temporary artwork — the real logos will be dropped in with the same file names).
- **10 regions** (geography): Delhi NCR, Chennai, Bengaluru, Hyderabad, Mumbai, Kolkata, Patna,
  Chandigarh, Lucknow, International.
- **People** (seeded roster = 158):
  - **Administration** (2; role key `ADMINISTRATION`): final approval of meetups; verifies and pays
    reimbursement claims; manages people and portal access.
  - **UHC** — Upper House Council (36 = 3 per house; titles Secretary / Deputy Secretary / Web Admin).
    House oversight, and can propose meetups in **any** region. Each UHC seat has a **fixed position email**
    (`<house>.<position>@study.iitm.ac.in`, e.g. `sundarbans.secretary@…`) handed to each newly elected member.
  - **LHC** — Lower House Council (120 = 10 per house). LHC member *n* of each house sits in region *n*,
    so each region has exactly **one LHC per house** (12 per region). LHCs sign in with their **own student
    email**.

## 2. Business rules (enforced server-side; the UI mirrors them)

| Area | Rule | Where |
|---|---|---|
| Who proposes | LHC (own region only) and UHC (chooses any region). Administration cannot. | `meetups.parse_payload`, `PROPOSER_ROLES` |
| Co-hosts | LHC host → LHCs of the **same region** (any house). UHC host → **other UHC members** (any house). Optional. | `meetups.invitable_clause` |
| Offline only | Every meetup is in person; `venue` required. No online/hybrid mode exists. | schema, `parse_payload` |
| Mandatory fields | Everything required except co-hosts and the collaboration block. Includes **backup date**. | `parse_payload` + `propose.js validate()` |
| Dates | Preferred `event_date` + `backup_date` (must differ, both in the future on submit). Administration approves one; choosing BACKUP **swaps** them so `event_date` is always the calendar date. | `meetups.review` |
| Budget | Allowance = **₹200 × expected attendees** (`BUDGET_PER_HEAD`, `portal/api/common.py`; mirrored in `portal/seed.py`). Optional `extra_budget` (e.g. venue booking) needs `extra_budget_note`. `budget_requested` = allowance + extra, computed server-side (DB CHECK enforces the sum). | `parse_payload`, schema |
| Collaboration | `collab_type` NONE / SOCIETY / EXTERNAL. SOCIETY & EXTERNAL need name, plan/agenda, point of contact. EXTERNAL also needs "about" and sponsorship yes/no (+ details if yes). | `meetups.parse_collab`, schema CHECKs |
| Rejection | Administration must give feedback (≥10 chars); DB CHECK too. | `meetups.review` |
| Completion | Administration any time, or host once the date has passed. Filing a claim on a past APPROVED meetup also completes it. | `permissions()` |
| Claims | Only the host files, once, after the meetup. Amount **may exceed** approved budget and attendance may exceed expected (soft warnings only); Administration approves any amount ≤ claimed. | `claims.create`, `claims.review` |
| Attendance | Claim must list attendees (name + valid email), typed or imported from CSV/XLSX. `actual_attendance` = list length. | `claims.parse_attendees`, `portal/importers.py` |
| Post link | Claim needs a URL to the social post (e.g. Instagram). | `claims.create` |
| Payout | SELF (claimant; saved back to their profile) · OTHER (details typed on the claim) · COHOST (accepted co-host **from another house** with saved details; claimant never sees the details; co-host must confirm → then Administration). Decline → claimant picks another payee. | `claims.resolve_payout`, `payee_response`, `change_payee` |
| Bank detail privacy | Bank fields are returned only to Administration, the payee, and the claimant for SELF/OTHER. Everyone else (incl. UHC oversight) gets `bank_hidden: true`. | `claims.present()` |
| Identity | The acting user **always** comes from the signed session cookie, never the request body. | `portal/auth.py` |
| People & access | Only Administration. Edit name/email/roll/house/region/position; role can't change (add a new person instead). Emails must end in `iitm.ac.in`; email and roll number unique. `is_active = 0` turns access off (can't sign in, can't be invited, existing session is dropped); records are never deleted. Can't turn off your own access. Bulk: CSV/XLSX → preview (create/update/unchanged/error) → apply (all-or-nothing re-validation). Rows match by `ID` (from Export) then email. | `portal/api/people.py` |

### Meetup lifecycle

```
DRAFT ─submit─▶ PEER_REVIEW ─(all co-hosts replied | host sends now)─▶ PENDING ─approve(primary|backup)─▶ APPROVED ─▶ COMPLETED
  ▲   (no invites: straight to PENDING)                                   │                                  │
  └──── withdraw (PEER_REVIEW / PENDING) ◀────────────────────────────────┤                          cancel ─▶ CANCELLED
                                                                    reject (feedback) ─▶ REJECTED ─edit+resubmit─▶ …
```
`permissions(m, user, my_invite)` in `portal/api/meetups.py` is the single source of who can do what;
the UI renders only actions where `can.<action>` is true.

### Claim lifecycle

```
file (SELF/OTHER) ─────────────────────────────▶ PENDING_REVIEW ─▶ IN_PROGRESS ─▶ APPROVED (paid)
file (COHOST) ─▶ AWAITING_PAYEE ─co-host confirms─▶ PENDING_REVIEW        └──────▶ REJECTED (notes required)
                      └─co-host declines─▶ PAYEE_DECLINED ─host changes payee─▶ (AWAITING_PAYEE | PENDING_REVIEW)
```

## 3. Architecture

**Stack:** Python 3 + Flask (only runtime dependency) · SQLite (stdlib `sqlite3`) · vanilla JS ES modules
· hand-written CSS · Jinja shell. **No build step, no npm, no Tailwind.** Fonts from Google Fonts.

```
app.py                     entry: `python app.py` → http://localhost:5050 (debug, auto-reload)
portal/
  __init__.py              app factory: config, blueprints, JSON errors for /api, asset version (?v=)
  db.py                    connections (per request in flask.g), SCHEMA_VERSION, reset_database()
  schema.sql               all tables + CHECKs + indexes (drops & recreates — only run via reset)
  seed.py                  demo roster + sample meetups/claims, dates relative to today
  auth.py                  session sign-in (demo picker), current_user(), login_required(*roles)
  importers.py             CSV / XLSX attendee parsing (stdlib zipfile + ElementTree, size guards)
  api/common.py            constants (CATEGORIES, BUDGET_PER_HEAD, PROPOSER_ROLES), visibility, notify,
                           log_activity, clean_text/clean_int, parse_bank (+ regexes)
  api/meetups.py           list/detail, create/update/delete, submit/withdraw/review/complete/cancel,
                           comments, invitations, peers, permissions()
  api/claims.py            claims: setup, attendee import, create, change payee, payee response, review,
                           receipt download; present() masks bank fields
  api/overview.py          /meta, /home (per role), /calendar, /stats (Mgmt), /insights/house (UHC),
                           /insights/me (LHC), notifications, badges, admin reset
  api/profile.py           /api/me/payout (saved bank details) + save_payout_details()
  api/people.py            Administration: people list/add/edit, access on/off, export CSV, import preview/apply
templates/index.html       shell: SVG icon sprite, sidebar, topbar, tab bar, overlays; pre-paint prefs script
static/css/style.css       design tokens (themes/accents/fonts) → components → responsive tiers
static/js/
  app.js                   boot, session, hash router, nav, rail/drawer, notifications, account menu, sign-in
  api.js                   fetch wrapper (throws Error(message); 401 → sign-in)
  ui.js                    html`` escaping template tag, formatters, status glyphs, components,
                           dialog/popover/toast, field-error helpers, appearance prefs
  calendar.js              month calendar + day agenda (home)
  palette.js               ⌘K command palette
  views/                   one module per screen:
    home.js meetups.js detail.js propose.js invites.js claims.js claim-form.js insights.js settings.js people.js
tools/                     cdp.mjs (Chrome driver) · e2e.mjs (regression) · shoot.mjs (screenshots)
data/                      iitmbs_meets.db, uploads/, .secret_key — generated, git-ignored
```

### Routes (hash router in `app.js`)

| Route | View | Roles |
|---|---|---|
| `#/home` | home.js — per-role dashboard + calendar | all |
| `#/meetups` | meetups.js — tabs per role + filters | all |
| `#/meetups/:id` | detail.js — overview, actions, people, activity, claim card, payee confirm | all (visibility rules) |
| `#/meetups/:id/edit`, `#/new` | propose.js | LHC, UHC |
| `#/meetups/:id/claim` | claim-form.js — file a claim, or change payee | host (LHC/UHC) |
| `#/invites` | invites.js | LHC, UHC |
| `#/claims` (`?open=<id>`) | claims.js — list + claim dialog (review for Mgmt) | all (scoped) |
| `#/insights` | insights.js — Mgmt institute / UHC house / LHC personal+region | all |
| `#/settings` | settings.js — theme, accent, font, payout details, demo reset (Admin) | all |
| `#/people` (`?tab=LHC\|UHC\|ADMINISTRATION\|off`) | people.js — People & access | Administration |

### Data model (schema v6) — key tables

- `houses(id, slug, name, motto, color)`, `regions(id, code, name, states)`
- `users(id, name, email, role, title, house_id, region_id, roll_number, is_active, updated_at)` — CHECK:
  LHC has house+region, UHC house only, Administration neither. New people get ids `lhc-…`/`uhc-…`/`admin-…`.
- `meetups(...)` — title, description, category, proposer/house/region, `event_date`, `backup_date`,
  times, venue, `expected_attendees`, `budget_per_head`, `extra_budget`, `extra_budget_note`,
  `budget_requested`, `collab_*`, status, review fields, timestamps.
- `meetup_invitations(meetup_id, invitee_id, status INVITED|ACCEPTED|DECLINED, response_note)`
- `meetup_activity(meetup_id, actor_id, action, note)` — audit trail **and** comment thread.
- `claims(...)` — amount_claimed/approved, actual_attendance, expense_notes, post_link, `payout_mode`,
  `payee_user_id`, bank snapshot (`payee_name, bank_name, account_number, ifsc, upi_id`), payee response,
  status, review fields.
- `claim_attendees(claim_id, name, email)`, `claim_files(claim_id, original_name, stored_name, size_bytes)`
- `payout_details(user_id PK, account_holder, bank_name, account_number, ifsc, upi_id)` — saved per member.
- `notifications(user_id, title, body, meetup_id, is_read)`

**Changing the schema:** edit `portal/schema.sql`, bump `SCHEMA_VERSION` in `portal/db.py`, update
`seed.py`. On next start the DB is **rebuilt from seed** (demo data only — there is no migration path
yet; add real migrations before production data exists).

### API (all JSON under `/api`, errors `{"error": msg}`)
Session/meta: `GET|POST|DELETE /session`, `GET /directory`, `GET /meta` ·
Dashboards: `GET /home`, `/badges`, `/calendar?start&end&scope`, `/stats` (Mgmt), `/insights/house` (UHC), `/insights/me` (LHC) ·
Meetups: `GET /meetups` (filters), `GET /meetups/:id`, `GET /peers`, `POST /meetups`, `PUT|DELETE /meetups/:id`,
`POST /meetups/:id/{submit,send-to-administration,withdraw,review,complete,cancel,comments}`, `POST /invitations/:meetupId/respond` ·
Claims: `GET /meetups/:id/claim-setup`, `POST /attendees/parse` (multipart file), `POST /meetups/:id/claim` (multipart),
`GET /claims`, `GET /claims/:id`, `POST /claims/:id/{payee,payee-response,review}`, `GET /claims/:id/files/:fid` ·
Profile: `GET|PUT|DELETE /me/payout` · People (Admin): `GET /admin/people?role&q&house_id&region_id&active`, `POST /admin/people`, `PUT /admin/people/:id`, `GET /admin/people/export.csv`, `POST /admin/people/import` (multipart → preview), `POST /admin/people/import/apply {rows}` · Admin: `POST /admin/reset {confirm:"RESET"}` · Notifications: `GET /notifications`, `POST /notifications/read`.
Full payloads: `WORKFLOW.md` §6.

## 4. Design system & UX conventions

- **Feel:** quiet, premium, low-gloss (references: Linear, Things, Notion Calendar). No blur/glass, glows,
  gradients or emoji. Accent used sparingly.
- **Themes** (`data-theme` on `<html>`): `light` warm paper `#F3F0E9`, `dark` soft graphite `#141317`
  (default), `black` true black; Auto follows OS. **Accents** (`data-accent`): terracotta (default),
  maroon, indigo, forest, ocean, gold, graphite — each defines `--a-dark`/`--a-light`. **Fonts**
  (`data-font`): Plus Jakarta Sans (default), Inter, Geist. Saved per device in `localStorage.prefs`
  and applied pre-paint by the inline script in `index.html`. **Never hard-code colours — use tokens.**
- **Status** = small glyph + muted label (`status()` in ui.js). The meetup ring fills as it progresses:
  dashed (draft) → ¼ (co-hosts) → ½ (awaiting) → ¾ (approved) → ✓ (held); ✕ rejected; ⊘ cancelled.
- **Layout tiers:** ≥1180 sidebar (collapsible to rail with `[` / toggle, saved as `prefs.sidebar`) ·
  768–1179 icon rail · <768 **no sidebar**: top bar + bottom tab bar (5 pages) + bottom-sheet dialogs.
- **One profile entry point:** the avatar at the **top right** on every size (account menu: theme,
  appearance & settings, switch account, sign out). Not in the sidebar, not in the tab bar. No page-level
  horizontal scroll at any width (wide content like the heatmap scrolls inside its card).
- **Forms:** containers carry `data-field="<name>"`; validate client-side into `[[name, msg], …]` and call
  `showFieldErrors(form, problems)` (marks fields, scrolls/focuses first, toasts the count);
  `clearFieldError(form, name)` on input. The server re-validates everything.
- **Copy:** plain, specific, sentence case; say what happens next ("The host has been notified").

## 5. Gotchas learned the hard way

1. `overflow-x: hidden` on `html, body` turns `<body>` into a scroll container and **breaks
   `position: sticky`** (sidebar/topbar scrolled away). Use `overflow-x: clip`.
2. Never import `app.js` from a view: the page loads `app.js?v=…`, a plain `../app.js` import is a
   *different module URL* → the app boots twice and every document listener fires twice. Shared helpers
   live in `ui.js`.
3. The router replaces `#view` with a fresh clone each render so view listeners don't accumulate.
4. `form.someRadio.value` returns the value even when unchecked if there is only **one** radio with that
   name — use `form.querySelector('[name=x]:checked')`.
5. Attribute selectors like `[data-accent="…"]` / `[data-font="…"]` are theme hooks — don't reuse those
   attribute names on ordinary elements (pickers use `data-pick-*`).
6. Sign-in brand used `flex: 1` from the sidebar and stretched vertically — scope layout rules.
7. Seed data uses obviously fake bank details (`Demo Bank`, IFSC `DEMO0…`). Keep it that way.
8. The Flask dev server can be killed externally; if every browser check fails, check it is running.
9. The DB is rebuilt only when `SCHEMA_VERSION` changes. If you bump the version and then keep editing
   `seed.py`, the running server may already have rebuilt from the old seed — run
   `.venv/bin/python -c "from portal.db import reset_database; reset_database()"` after seed edits.
10. The shell is zsh: an unquoted `$FILES` is *not* split into words. Use `| xargs …` (or `${=FILES}`) for
    bulk `sed` across files.

## 6. Running & verifying

```bash
.venv/bin/python app.py                       # server on :5050 (rebuilds DB if schema version changed)
node tools/e2e.mjs                            # 30-step browser regression across all roles (resets data)
node tools/shoot.mjs .shots "admin-1|/home|1440|admin-home" "lhc-11-5|/new|390|new-phone|dark"
```
Demo accounts: `admin-1` Dr. Meera Krishnan (Administration) · `uhc-11-1` Vikram Rao (UHC Sundarbans) ·
`lhc-11-5` Rahul Verma (LHC Sundarbans, Mumbai) · `lhc-2-5` Sneha Roy (LHC Corbett, Mumbai; has saved
bank details for the co-host payout demo). Sign-in is a demo picker until Google OAuth is added
(`portal/auth.py::sign_in` is the seam).

**Definition of done for a change:** server-side rule + client mirror, works at 1440/900/390 widths and
in light/dark/black, `node tools/e2e.mjs` passes (extend it for new workflows), docs updated (this file's
relevant section + change log; `WORKFLOW.md` for spec-level changes; `CLAUDE.md` if a rule changes).

## 7. Open items / ideas

- Google OAuth sign-in (restrict to the institute domain) replacing the demo picker.
- Real schema migrations before any production data exists.
- Replace temporary house crests with official logos (same file names).
- Possibly let UHC see (read-only) their house's LHC roster; audit log of People & access changes.
- Possible: attendance minimum/maximum rules, extra-budget thresholds by size, CSV export of claims for
  Accounts, email notifications.

## 8. Change log

- **2026-10-14** — Initial rebuild: `portal/` package, session auth, full meetup lifecycle, activity log,
  receipts upload, new UI (sidebar/rail/drawer), role homes, insights, ⌘K palette.
- **2026-10-14** — Themes (light warm / dark soft / black), 7 accents, 3 fonts; home calendar;
  meetups made offline-only.
- **2026-10-14** — Sticky nav fix (`overflow-x: clip`), collapsible sidebar, renamed to *Meetup Planner*,
  sign-in layout rebuilt.
- **2026-10-14** — Preferred + backup dates (Administration picks one); budget = ₹200/attendee + optional
  extra with reason.
- **2026-10-14** — Collaboration block (society/external, sponsorship); all fields mandatory with inline
  jump-to-field validation; UHC can propose in any region and invite UHC members; saved payout details;
  per-role insights (UHC house, LHC personal + region).
- **2026-10-14** — Claims redesigned as a full page: attendee list (manual + CSV/XLSX import), amount
  auto-suggested at ₹200/attendee (overrun allowed with warning), post link, payout to self / another
  student / co-host from another house (hidden details + co-host confirmation). Added `tools/` e2e +
  screenshot scripts and this file.
- **2026-10-14** — "Management" renamed **Administration** in all user-facing text.
  New **People & access** page: edit LHC email/roll/house/region, hand over UHC seats (fixed seat emails),
  access on/off, add people, CSV export, CSV/XLSX import with preview. Navigation: phones have no sidebar
  (5-tab bottom bar), the only profile entry point is the top-right avatar. Schema v7 (`users.is_active`).
- **2026-10-14** — Role key renamed `MANAGEMENT` → `ADMINISTRATION` (plus `administration_ids()`,
  `SENT_TO_ADMINISTRATION`, `/send-to-administration`, demo ids `admin-1`/`admin-2`). Schema v8.
