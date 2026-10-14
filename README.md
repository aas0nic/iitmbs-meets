# IIT Madras BS — Student Activities Meetup Approval Portal

A web application built for the **IIT Madras BS Degree Student Community**, designed to manage regional student meetups across **12 Houses** and **10 Geographic Regions** with governance by **Management**, **Upper House Council (UHC)**, and **Lower House Council (LHC)**.

Styled faithfully in alignment with the official **IIT Madras Student Activities Portal** dark theme design system.

---

## 📖 Complete Documentation & Specification

For the full architectural breakdown, role access control matrices, Mermaid lifecycle diagrams, SQLite schemas, and REST API specifications, please refer to:

👉 **[WORKFLOW.md](WORKFLOW.md)** — Architectural specification, RBAC matrix, database schema, and API contracts.  
👉 **[CLAUDE.md](CLAUDE.md)** — Direct instructions, constraints, and development guidelines for Claude AI.

---

## 🏛️ Governance & Hierarchy Overview

- **Management (Top Tier)**: Final review and approval authority. Reviews meetups, verifies budget and venue logistics, and can Approve or Reject with mandatory feedback.
- **Upper House Council (UHC — 36 Members)**: 12 Houses &times; 3 representatives per house. Provides house-level oversight, calendar visibility, and advisory support.
- **Lower House Council (LHC — 120 Members)**: 12 Houses &times; 10 representatives per house. Mapped across 10 Geographic Regions (~12 members per region).
- **Regional Peer Collaboration**: Proposing LHC members can invite fellow LHC members from their **same region** across any of the 12 houses to co-host.

---

## 💾 Data Storage

All data is stored in a persistent local SQLite database file at:
`data/iitmbs_meets.db`

- Seeded with **12 Houses**, **10 Regions**, **120 LHCs**, **36 UHCs**, and **Management**.
- Fully ACID-compliant and persistent across server reboots.
- Schema in `portal/schema.sql`; rebuilt automatically when the schema version changes.
- Management can reset to seed data from **Settings**.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Python 3.8+ (tested with Python 3.14)

### 2. Run Locally
```bash
# Clone and enter directory
cd iitmbs-meets

# Use existing virtual environment or create one
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start the application server (runs on port 5050)
python3 app.py
```

Open **`http://localhost:5050`** in your browser.

---

## 🧪 Trying the Workflows

Sign-in is a demo account picker until Google sign-in is connected:

1. **Rahul Verma** (LHC · Sundarbans · Mumbai) — propose a meetup and invite Mumbai LHCs as co-hosts.
2. **Sneha Roy** (LHC · Corbett · Mumbai) — accept the co-host invite from Home.
3. **Dr. Meera Krishnan** (Management) — approve or reject from the decision queue; verify claims under Reimbursements.
4. **Vikram Rao** (UHC · Sundarbans) — follow house activity and region coverage, comment on proposals.
