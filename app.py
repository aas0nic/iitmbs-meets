from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import datetime
import os
from db import get_db_connection, init_db, DB_PATH

app = Flask(__name__)

# Ensure database is initialized on app startup
if not os.path.exists(DB_PATH):
    init_db()

def dict_from_row(row):
    if row is None:
        return None
    return dict(row)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/')
def index():
    return render_template('index.html', v=int(datetime.now().timestamp()))

@app.route('/api/bootstrap', methods=['GET'])
def get_bootstrap():
    conn = get_db_connection()
    c = conn.cursor()

    # Houses
    c.execute("SELECT id, name, motto, color FROM houses ORDER BY id")
    houses = [dict_from_row(r) for r in c.fetchall()]

    # Regions
    c.execute("SELECT id, name, states, short_code FROM regions ORDER BY id")
    regions = [dict_from_row(r) for r in c.fetchall()]

    # Curated demo switchers so users can test immediately
    c.execute("""
        SELECT u.id, u.name, u.email, u.role, u.roll_number, u.avatar_url,
               h.name as house_name, h.color as house_color,
               r.name as region_name, r.id as region_id
        FROM users u
        LEFT JOIN houses h ON u.house_id = h.id
        LEFT JOIN regions r ON u.region_id = r.id
        WHERE u.id IN ('mgmt-1', 'uhc-11-1', 'lhc-11-5', 'lhc-2-5', 'lhc-3-5')
        ORDER BY CASE u.role 
            WHEN 'MANAGEMENT' THEN 1 
            WHEN 'UHC' THEN 2 
            WHEN 'LHC' THEN 3 
        END
    """)
    demo_users = [dict_from_row(r) for r in c.fetchall()]

    # Stats
    c.execute("SELECT COUNT(*) FROM meetup_proposals")
    total_meetups = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM meetup_proposals WHERE status = 'PENDING'")
    pending_meetups = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM meetup_proposals WHERE status = 'APPROVED'")
    approved_meetups = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM meetup_proposals WHERE status = 'COMPLETED'")
    completed_meetups = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM reimbursements WHERE status = 'PENDING_REVIEW'")
    pending_reimbursements = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM users WHERE role = 'LHC'")
    total_lhcs = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM users WHERE role = 'UHC'")
    total_uhcs = c.fetchone()[0]

    conn.close()

    return jsonify({
        "houses": houses,
        "regions": regions,
        "demo_users": demo_users,
        "stats": {
            "total_meetups": total_meetups,
            "pending_meetups": pending_meetups,
            "approved_meetups": approved_meetups,
            "completed_meetups": completed_meetups,
            "pending_reimbursements": pending_reimbursements,
            "total_lhcs": total_lhcs,
            "total_uhcs": total_uhcs,
            "total_houses": len(houses),
            "total_regions": len(regions)
        }
    })

@app.route('/api/users', methods=['GET'])
def get_users():
    role = request.args.get('role')
    house_id = request.args.get('house_id')
    region_id = request.args.get('region_id')
    exclude_id = request.args.get('exclude_id')

    query = """
        SELECT u.id, u.name, u.email, u.role, u.roll_number, u.avatar_url,
               u.house_id, h.name as house_name, h.color as house_color,
               u.region_id, r.name as region_name
        FROM users u
        LEFT JOIN houses h ON u.house_id = h.id
        LEFT JOIN regions r ON u.region_id = r.id
        WHERE 1=1
    """
    params = []

    if role:
        query += " AND u.role = ?"
        params.append(role)
    if house_id:
        query += " AND u.house_id = ?"
        params.append(house_id)
    if region_id:
        query += " AND u.region_id = ?"
        params.append(region_id)
    if exclude_id:
        query += " AND u.id != ?"
        params.append(exclude_id)

    query += " ORDER BY u.name ASC"

    conn = get_db_connection()
    c = conn.cursor()
    c.execute(query, params)
    users = [dict_from_row(r) for r in c.fetchall()]
    conn.close()

    return jsonify({"users": users})

@app.route('/api/user/<user_id>', methods=['GET'])
def get_user_profile(user_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT u.id, u.name, u.email, u.role, u.roll_number, u.avatar_url,
               u.house_id, h.name as house_name, h.motto as house_motto, h.color as house_color,
               u.region_id, r.name as region_name, r.states as region_states
        FROM users u
        LEFT JOIN houses h ON u.house_id = h.id
        LEFT JOIN regions r ON u.region_id = r.id
        WHERE u.id = ?
    """, (user_id,))
    user = dict_from_row(c.fetchone())
    conn.close()

    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"user": user})

@app.route('/api/meetups', methods=['GET'])
def get_meetups():
    user_id = request.args.get('user_id')
    role = request.args.get('role')
    status_filter = request.args.get('status')
    region_id = request.args.get('region_id')
    house_id = request.args.get('house_id')

    conn = get_db_connection()
    c = conn.cursor()

    query = """
        SELECT m.*,
               u.name as proposer_name, u.email as proposer_email, u.roll_number as proposer_roll, u.avatar_url as proposer_avatar,
               h.name as house_name, h.color as house_color,
               r.name as region_name, r.short_code as region_code,
               rev.name as reviewer_name
        FROM meetup_proposals m
        JOIN users u ON m.proposer_id = u.id
        JOIN houses h ON m.house_id = h.id
        JOIN regions r ON m.region_id = r.id
        LEFT JOIN users rev ON m.reviewed_by = rev.id
        WHERE 1=1
    """
    params = []

    if status_filter and status_filter != 'ALL':
        query += " AND m.status = ?"
        params.append(status_filter)

    if region_id:
        query += " AND m.region_id = ?"
        params.append(region_id)

    if house_id:
        query += " AND m.house_id = ?"
        params.append(house_id)

    # For LHC, they can see:
    # 1. Meetups they proposed
    # 2. Approved meetups in their region or house
    # 3. Meetups where they were invited
    # But if role is MANAGEMENT or UHC, they have broader visibility
    query += " ORDER BY m.created_at DESC"

    c.execute(query, params)
    raw_meetups = c.fetchall()

    meetups = []
    for rm in raw_meetups:
        m = dict_from_row(rm)
        m_id = m['id']

        # Fetch invitations for this meetup
        c.execute("""
            SELECT i.id, i.status, i.response_note, i.responded_at,
                   u.id as invitee_id, u.name as invitee_name, u.roll_number as invitee_roll,
                   u.avatar_url as invitee_avatar, h.name as invitee_house_name, h.color as invitee_house_color
            FROM meetup_invitations i
            JOIN users u ON i.invitee_id = u.id
            JOIN houses h ON u.house_id = h.id
            WHERE i.meetup_id = ?
        """, (m_id,))
        invitations = [dict_from_row(r) for r in c.fetchall()]

        m['invitations'] = invitations
        m['accepted_count'] = sum(1 for i in invitations if i['status'] == 'ACCEPTED')
        m['declined_count'] = sum(1 for i in invitations if i['status'] == 'DECLINED')
        m['invited_count'] = sum(1 for i in invitations if i['status'] == 'INVITED')
        m['total_invites'] = len(invitations)

        # Check if current user is an invitee
        m['user_invitation'] = next((i for i in invitations if i['invitee_id'] == user_id), None)

        meetups.append(m)

    conn.close()
    return jsonify({"meetups": meetups})

@app.route('/api/meetups', methods=['POST'])
def create_meetup():
    data = request.json
    if not data:
        return jsonify({"error": "No JSON payload provided"}), 400

    proposer_id = data.get('proposer_id')
    title = data.get('title')
    description = data.get('description')
    category = data.get('category', 'Study Jam')
    proposed_date = data.get('proposed_date')
    start_time = data.get('start_time', '10:00 AM')
    end_time = data.get('end_time', '02:00 PM')
    mode = data.get('mode', 'IN_PERSON')
    venue = data.get('venue', 'Campus / Online')
    expected_attendees = int(data.get('expected_attendees', 20))
    estimated_budget = data.get('estimated_budget', '₹ 0')
    invitee_ids = data.get('invitee_ids', [])

    if not title or not description or not proposed_date or not proposer_id:
        return jsonify({"error": "Missing required fields (title, description, proposed_date, proposer_id)"}), 400

    conn = get_db_connection()
    c = conn.cursor()

    # Verify proposer exists and get their house & region
    c.execute("SELECT id, name, role, house_id, region_id FROM users WHERE id = ?", (proposer_id,))
    proposer = dict_from_row(c.fetchone())
    if not proposer:
        conn.close()
        return jsonify({"error": "Proposer not found"}), 404

    house_id = proposer['house_id']
    region_id = proposer['region_id']

    if not house_id or not region_id:
        conn.close()
        return jsonify({"error": "Proposer must be an LHC with valid house and region assignment"}), 400

    # Insert meetup proposal
    c.execute("""
        INSERT INTO meetup_proposals
        (title, description, category, proposer_id, house_id, region_id, proposed_date, start_time, end_time, mode, venue, expected_attendees, estimated_budget, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    """, (title, description, category, proposer_id, house_id, region_id, proposed_date, start_time, end_time, mode, venue, expected_attendees, estimated_budget))
    
    meetup_id = c.lastrowid

    # Verify and add invitees (MUST be LHCs from the same region)
    valid_invitees_count = 0
    for inv_id in invitee_ids:
        if inv_id == proposer_id:
            continue
        c.execute("SELECT id, name, role, region_id FROM users WHERE id = ?", (inv_id,))
        inv_user = dict_from_row(c.fetchone())
        if inv_user and inv_user['region_id'] == region_id and inv_user['role'] == 'LHC':
            c.execute("""
                INSERT OR IGNORE INTO meetup_invitations (meetup_id, invitee_id, status)
                VALUES (?, ?, 'INVITED')
            """, (meetup_id, inv_id))
            valid_invitees_count += 1

            # Create notification for invited peer
            c.execute("""
                INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
                VALUES (?, ?, ?, 'INVITATION', ?)
            """, (inv_id, "New Meetup Invitation", f"{proposer['name']} invited you to co-host / attend '{title}' in your region.", meetup_id))

    # Notify proposer that request is submitted
    c.execute("""
        INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
        VALUES (?, ?, ?, 'PROPOSAL_STATUS', ?)
    """, (proposer_id, "Meetup Request Submitted", f"Your meetup request '{title}' was submitted and is pending Management review.", meetup_id))

    # Notify Management
    c.execute("SELECT id FROM users WHERE role = 'MANAGEMENT'")
    for mgmt in c.fetchall():
        c.execute("""
            INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
            VALUES (?, ?, ?, 'PROPOSAL_STATUS', ?)
        """, (mgmt[0], "New Meetup Pending Review", f"LHC {proposer['name']} submitted '{title}' for approval.", meetup_id))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "meetup_id": meetup_id,
        "message": f"Meetup '{title}' successfully created and sent to Management with {valid_invitees_count} regional peer invitations."
    }), 201

@app.route('/api/meetups/<int:meetup_id>/review', methods=['POST'])
def review_meetup(meetup_id):
    data = request.json or {}
    reviewer_id = data.get('reviewer_id')
    action = data.get('action') # 'APPROVE' or 'REJECT'
    remarks = data.get('remarks', '').strip()

    if action not in ['APPROVE', 'REJECT']:
        return jsonify({"error": "Action must be either APPROVE or REJECT"}), 400

    conn = get_db_connection()
    c = conn.cursor()

    # Verify reviewer has MANAGEMENT role
    c.execute("SELECT id, name, role FROM users WHERE id = ?", (reviewer_id,))
    reviewer = dict_from_row(c.fetchone())
    if not reviewer or reviewer['role'] != 'MANAGEMENT':
        conn.close()
        return jsonify({"error": "Only Management users have authority to approve or reject meetups."}), 403

    # Check meetup exists
    c.execute("SELECT * FROM meetup_proposals WHERE id = ?", (meetup_id,))
    meetup = dict_from_row(c.fetchone())
    if not meetup:
        conn.close()
        return jsonify({"error": "Meetup proposal not found"}), 404

    new_status = 'APPROVED' if action == 'APPROVE' else 'REJECTED'
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    c.execute("""
        UPDATE meetup_proposals
        SET status = ?, management_remarks = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
    """, (new_status, remarks, reviewer_id, now_str, meetup_id))

    # Send Notification to the Proposing LHC
    if new_status == 'APPROVED':
        notif_title = "Meetup Request Approved! 🎉"
        notif_msg = f"Your meetup '{meetup['title']}' has been APPROVED by Management ({reviewer['name']})."
        if remarks:
            notif_msg += f" Remarks: {remarks}"
    else:
        notif_title = "Meetup Request Rejected ⚠️"
        notif_msg = f"Your meetup '{meetup['title']}' was rejected by Management. Reason: {remarks or 'Guidelines not met'}"

    c.execute("""
        INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
        VALUES (?, ?, ?, 'PROPOSAL_STATUS', ?)
    """, (meetup['proposer_id'], notif_title, notif_msg, meetup_id))

    # Also notify accepted invitees if approved
    if new_status == 'APPROVED':
        c.execute("SELECT invitee_id FROM meetup_invitations WHERE meetup_id = ? AND status = 'ACCEPTED'", (meetup_id,))
        for inv in c.fetchall():
            c.execute("""
                INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
                VALUES (?, ?, ?, 'PROPOSAL_STATUS', ?)
            """, (inv[0], "Co-hosted Meetup Approved 🎉", f"The meetup '{meetup['title']}' you accepted to co-host has been approved by Management.", meetup_id))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "status": new_status,
        "message": f"Meetup status updated to {new_status}."
    })

@app.route('/api/invitations/<int:invitation_id>/respond', methods=['POST'])
def respond_invitation(invitation_id):
    data = request.json or {}
    user_id = data.get('user_id')
    action = data.get('action') # 'ACCEPT' or 'DECLINE'
    note = data.get('note', '')

    if action not in ['ACCEPT', 'DECLINE']:
        return jsonify({"error": "Action must be ACCEPT or DECLINE"}), 400

    conn = get_db_connection()
    c = conn.cursor()

    c.execute("""
        SELECT i.*, m.title as meetup_title, m.proposer_id, u.name as respondent_name
        FROM meetup_invitations i
        JOIN meetup_proposals m ON i.meetup_id = m.id
        JOIN users u ON i.invitee_id = u.id
        WHERE i.id = ? AND i.invitee_id = ?
    """, (invitation_id, user_id))
    inv = dict_from_row(c.fetchone())

    if not inv:
        conn.close()
        return jsonify({"error": "Invitation not found or unauthorized"}), 404

    new_status = 'ACCEPTED' if action == 'ACCEPT' else 'DECLINE'
    if action == 'ACCEPT':
        new_status = 'ACCEPTED'
    else:
        new_status = 'DECLINED'

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    c.execute("""
        UPDATE meetup_invitations
        SET status = ?, response_note = ?, responded_at = ?
        WHERE id = ?
    """, (new_status, note, now_str, invitation_id))

    # Send Notification to Proposer
    c.execute("""
        INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
        VALUES (?, ?, ?, 'INVITE_RESPONSE', ?)
    """, (inv['proposer_id'], f"Invitation {new_status.title()}", f"{inv['respondent_name']} {new_status.lower()} your invitation for '{inv['meetup_title']}'.", inv['meetup_id']))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "status": new_status,
        "message": f"Invitation {new_status.lower()} successfully."
    })

@app.route('/api/meetups/<int:meetup_id>/complete', methods=['POST'])
def mark_meetup_completed(meetup_id):
    data = request.json or {}
    user_id = data.get('user_id')
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM meetup_proposals WHERE id = ?", (meetup_id,))
    m = dict_from_row(c.fetchone())
    if not m:
        conn.close()
        return jsonify({"error": "Meetup proposal not found"}), 404

    c.execute("UPDATE meetup_proposals SET status = 'COMPLETED' WHERE id = ?", (meetup_id,))
    
    # Notify proposer
    c.execute("""
        INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
        VALUES (?, 'Meetup Marked Completed 🏁', 'Your meetup has concluded! You can now submit your reimbursement claim with attendance and bill receipts.', 'PROPOSAL_STATUS', ?)
    """, (m['proposer_id'], meetup_id))

    conn.commit()
    conn.close()

    return jsonify({"success": True, "status": "COMPLETED", "message": "Meetup marked as Completed."})

@app.route('/api/stats/overall', methods=['GET'])
def get_overall_stats():
    conn = get_db_connection()
    c = conn.cursor()

    # Breakdown by House (all 12 houses)
    c.execute("""
        SELECT h.id, h.name, h.motto, h.color,
               COUNT(m.id) as total_meetups,
               SUM(CASE WHEN m.status = 'PENDING' THEN 1 ELSE 0 END) as pending_meetups,
               SUM(CASE WHEN m.status = 'APPROVED' THEN 1 ELSE 0 END) as approved_meetups,
               SUM(CASE WHEN m.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_meetups,
               SUM(CASE WHEN m.status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_meetups,
               COALESCE(SUM(CASE WHEN m.status IN ('APPROVED', 'COMPLETED') THEN m.expected_attendees ELSE 0 END), 0) as total_attendees
        FROM houses h
        LEFT JOIN meetup_proposals m ON h.id = m.house_id
        GROUP BY h.id, h.name, h.motto, h.color
        ORDER BY h.id ASC
    """)
    by_house = [dict_from_row(r) for r in c.fetchall()]

    # Breakdown by Region (all 10 regions)
    c.execute("""
        SELECT r.id, r.name, r.states, r.short_code,
               COUNT(m.id) as total_meetups,
               SUM(CASE WHEN m.status = 'PENDING' THEN 1 ELSE 0 END) as pending_meetups,
               SUM(CASE WHEN m.status = 'APPROVED' THEN 1 ELSE 0 END) as approved_meetups,
               SUM(CASE WHEN m.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_meetups,
               SUM(CASE WHEN m.status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_meetups,
               COALESCE(SUM(CASE WHEN m.status IN ('APPROVED', 'COMPLETED') THEN m.expected_attendees ELSE 0 END), 0) as total_attendees
        FROM regions r
        LEFT JOIN meetup_proposals m ON r.id = m.region_id
        GROUP BY r.id, r.name, r.states, r.short_code
        ORDER BY r.id ASC
    """)
    by_region = [dict_from_row(r) for r in c.fetchall()]

    # Reimbursement summary
    c.execute("""
        SELECT 
            COUNT(*) as total_claims,
            SUM(CASE WHEN status = 'PENDING_REVIEW' THEN 1 ELSE 0 END) as pending_review,
            SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved_count,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count,
            COALESCE(SUM(amount_claimed), 0) as total_claimed,
            COALESCE(SUM(amount_approved), 0) as total_approved
        FROM reimbursements
    """)
    reimb_summary = dict_from_row(c.fetchone())

    conn.close()
    return jsonify({
        "by_house": by_house,
        "by_region": by_region,
        "reimbursement_summary": reimb_summary
    })

@app.route('/api/reimbursements', methods=['GET'])
def get_reimbursements():
    status = request.args.get('status')
    meetup_id = request.args.get('meetup_id')

    query = """
        SELECT r.*,
               m.title as meetup_title, m.category as meetup_category, m.proposed_date, m.venue, m.mode,
               u.name as claimant_name, u.email as claimant_email, u.roll_number as claimant_roll, u.avatar_url as claimant_avatar,
               h.name as house_name, h.color as house_color,
               reg.name as region_name, reg.short_code as region_code,
               rev.name as reviewer_name
        FROM reimbursements r
        JOIN meetup_proposals m ON r.meetup_id = m.id
        JOIN users u ON r.claimant_id = u.id
        JOIN houses h ON m.house_id = h.id
        JOIN regions reg ON m.region_id = reg.id
        LEFT JOIN users rev ON r.reviewed_by = rev.id
        WHERE 1=1
    """
    params = []
    if status and status != 'ALL':
        query += " AND r.status = ?"
        params.append(status)
    if meetup_id:
        query += " AND r.meetup_id = ?"
        params.append(meetup_id)

    query += " ORDER BY r.created_at DESC"

    conn = get_db_connection()
    c = conn.cursor()
    c.execute(query, params)
    reimbursements = [dict_from_row(row) for row in c.fetchall()]
    conn.close()

    return jsonify({"reimbursements": reimbursements})

@app.route('/api/reimbursements', methods=['POST'])
def create_reimbursement():
    data = request.json or {}
    meetup_id = data.get('meetup_id')
    claimant_id = data.get('claimant_id')
    amount_claimed = float(data.get('amount_claimed', 0))
    actual_attendance = int(data.get('actual_attendance', 0))
    attendance_proof_notes = data.get('attendance_proof_notes', '')
    bills_description = data.get('bills_description', '')
    receipts_file_name = data.get('receipts_file_name', 'Receipts_attached.pdf')
    bank_or_upi_details = data.get('bank_or_upi_details', '')

    if not meetup_id or not claimant_id or amount_claimed <= 0:
        return jsonify({"error": "Invalid claim data (meetup_id, claimant_id, and positive amount_claimed required)"}), 400

    conn = get_db_connection()
    c = conn.cursor()

    c.execute("""
        INSERT INTO reimbursements
        (meetup_id, claimant_id, amount_claimed, actual_attendance, attendance_proof_notes, bills_description, receipts_file_name, bank_or_upi_details, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')
    """, (meetup_id, claimant_id, amount_claimed, actual_attendance, attendance_proof_notes, bills_description, receipts_file_name, bank_or_upi_details))
    claim_id = c.lastrowid

    # Notify Management
    c.execute("SELECT id FROM users WHERE role = 'MANAGEMENT'")
    for mgmt in c.fetchall():
        c.execute("""
            INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
            VALUES (?, 'New Reimbursement Claim', 'A reimbursement claim of ₹ ' || ? || ' was submitted for review.', 'SYSTEM', ?)
        """, (mgmt[0], str(amount_claimed), meetup_id))

    conn.commit()
    conn.close()

    return jsonify({"success": True, "claim_id": claim_id, "message": "Reimbursement claim submitted for Management review."})

@app.route('/api/reimbursements/<int:claim_id>/review', methods=['POST'])
def review_reimbursement(claim_id):
    data = request.json or {}
    reviewer_id = data.get('reviewer_id')
    action = data.get('action') # 'APPROVE', 'IN_PROGRESS', 'REJECT'
    amount_approved = float(data.get('amount_approved', 0)) if data.get('amount_approved') else None
    management_notes = data.get('management_notes', '')

    if action not in ['APPROVE', 'IN_PROGRESS', 'REJECT']:
        return jsonify({"error": "Action must be APPROVE, IN_PROGRESS, or REJECT"}), 400

    conn = get_db_connection()
    c = conn.cursor()

    c.execute("SELECT r.*, u.name as claimant_name, m.title as meetup_title FROM reimbursements r JOIN users u ON r.claimant_id = u.id JOIN meetup_proposals m ON r.meetup_id = m.id WHERE r.id = ?", (claim_id,))
    claim = dict_from_row(c.fetchone())
    if not claim:
        conn.close()
        return jsonify({"error": "Reimbursement claim not found"}), 404

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if action == 'APPROVE':
        new_status = 'APPROVED'
        if amount_approved is None:
            amount_approved = claim['amount_claimed']
        notif_msg = f"Your reimbursement claim of ₹ {amount_approved:,.2f} for '{claim['meetup_title']}' has been APPROVED by Management."
    elif action == 'IN_PROGRESS':
        new_status = 'IN_PROGRESS'
        notif_msg = f"Your reimbursement claim for '{claim['meetup_title']}' is currently IN PROGRESS with the Institute Accounts team."
    else:
        new_status = 'REJECTED'
        notif_msg = f"Your reimbursement claim for '{claim['meetup_title']}' was REJECTED. Notes: {management_notes}"

    c.execute("""
        UPDATE reimbursements
        SET status = ?, amount_approved = ?, management_notes = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
    """, (new_status, amount_approved, management_notes, reviewer_id, now_str, claim_id))

    # Notify Claimant
    c.execute("""
        INSERT INTO notifications (user_id, title, message, type, related_meetup_id)
        VALUES (?, 'Reimbursement Status Update', ?, 'SYSTEM', ?)
    """, (claim['claimant_id'], notif_msg, claim['meetup_id']))

    conn.commit()
    conn.close()

    return jsonify({"success": True, "status": new_status, "message": f"Reimbursement updated to {new_status}."})

@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({"notifications": []})

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM notifications 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT 30
    """, (user_id,))
    notifs = [dict_from_row(r) for r in c.fetchall()]
    conn.close()

    return jsonify({"notifications": notifs})

@app.route('/api/notifications/mark-read', methods=['POST'])
def mark_notifications_read():
    user_id = request.json.get('user_id')
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

    return jsonify({"success": True})

@app.route('/api/reset-demo', methods=['POST'])
def reset_demo_database():
    init_db(force_reseed=True)
    return jsonify({"success": True, "message": "Database has been reset to original seed state with all 120 LHCs, 36 UHCs, 12 Houses, and 10 Regions."})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    app.run(host='0.0.0.0', port=port, debug=True)
