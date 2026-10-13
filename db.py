import sqlite3
import os
import json
from datetime import datetime

DB_DIR = os.path.join(os.path.dirname(__file__), 'data')
DB_PATH = os.path.join(DB_DIR, 'iitmbs_meets.db')

def get_db_connection():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db(force_reseed=False):
    os.makedirs(DB_DIR, exist_ok=True)
    conn = get_db_connection()
    cursor = conn.cursor()

    if force_reseed:
        cursor.executescript('''
            DROP TABLE IF EXISTS notifications;
            DROP TABLE IF EXISTS reimbursements;
            DROP TABLE IF EXISTS meetup_invitations;
            DROP TABLE IF EXISTS meetup_proposals;
            DROP TABLE IF EXISTS users;
            DROP TABLE IF EXISTS houses;
            DROP TABLE IF EXISTS regions;
        ''')

    cursor.executescript('''
    CREATE TABLE IF NOT EXISTS houses (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        motto TEXT,
        color TEXT
    );

    CREATE TABLE IF NOT EXISTS regions (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        states TEXT,
        short_code TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('MANAGEMENT', 'UHC', 'LHC')),
        house_id INTEGER REFERENCES houses(id),
        region_id INTEGER REFERENCES regions(id),
        roll_number TEXT,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meetup_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        proposer_id TEXT NOT NULL REFERENCES users(id),
        house_id INTEGER NOT NULL REFERENCES houses(id),
        region_id INTEGER NOT NULL REFERENCES regions(id),
        proposed_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('IN_PERSON', 'VIRTUAL', 'HYBRID')),
        venue TEXT NOT NULL,
        expected_attendees INTEGER DEFAULT 20,
        estimated_budget TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
        management_remarks TEXT,
        reviewed_by TEXT REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meetup_invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meetup_id INTEGER NOT NULL REFERENCES meetup_proposals(id) ON DELETE CASCADE,
        invitee_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'INVITED' CHECK(status IN ('INVITED', 'ACCEPTED', 'DECLINED')),
        response_note TEXT,
        responded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(meetup_id, invitee_id)
    );

    CREATE TABLE IF NOT EXISTS reimbursements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meetup_id INTEGER NOT NULL REFERENCES meetup_proposals(id) ON DELETE CASCADE,
        claimant_id TEXT NOT NULL REFERENCES users(id),
        amount_claimed REAL NOT NULL,
        amount_approved REAL,
        actual_attendance INTEGER NOT NULL,
        attendance_proof_notes TEXT,
        bills_description TEXT,
        receipts_file_name TEXT,
        bank_or_upi_details TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW', 'IN_PROGRESS', 'APPROVED', 'REJECTED')),
        management_notes TEXT,
        reviewed_by TEXT REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        related_meetup_id INTEGER REFERENCES meetup_proposals(id),
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ''')

    cursor.execute("SELECT COUNT(*) FROM houses")
    has_data = cursor.fetchone()[0] > 0

    if not has_data or force_reseed:
        if force_reseed:
            cursor.execute("DELETE FROM notifications")
            cursor.execute("DELETE FROM reimbursements")
            cursor.execute("DELETE FROM meetup_invitations")
            cursor.execute("DELETE FROM meetup_proposals")
            cursor.execute("DELETE FROM users")
            cursor.execute("DELETE FROM houses")
            cursor.execute("DELETE FROM regions")

        seed_data(cursor)

    conn.commit()
    conn.close()

def seed_data(cursor):
    # 12 Official Houses of IIT Madras BS Degree (named after India's National Parks & Reserves)
    houses = [
        (1, "Bandipur", "Guardians of the Wild", "#2B6CB0"),
        (2, "Corbett", "Roar of the Brave", "#D69E2E"),
        (3, "Gir", "Pride of the Realm", "#2E8540"),
        (4, "Kanha", "Grace in Strength", "#C05621"),
        (5, "Kaziranga", "Beyond Limits", "#22543D"),
        (6, "Nallamala", "Valour and Honour", "#B7791F"),
        (7, "Namdapha", "Soaring to Heights", "#4A5568"),
        (8, "Nilgiri", "Blue Mountain Spirit", "#805AD5"),
        (9, "Pichavaram", "Rooted in Resilience", "#319795"),
        (10, "Saranda", "Wings of Victory", "#D69E2E"),
        (11, "Sundarbans", "Majesty of the Delta", "#DD6B20"),
        (12, "Wayanad", "Heritage & Wisdom", "#3182CE")
    ]
    cursor.executemany("INSERT INTO houses (id, name, motto, color) VALUES (?, ?, ?, ?)", houses)

    # 10 Official Geographic Regions
    regions = [
        (1, "Delhi (NCR)", "Delhi, Noida, Gurgaon, Ghaziabad, Faridabad", "DEL"),
        (2, "Chennai", "Tamil Nadu, Puducherry", "MAA"),
        (3, "Bengaluru", "Karnataka, Kerala", "BLR"),
        (4, "Hyderabad", "Telangana, Andhra Pradesh", "HYD"),
        (5, "Mumbai", "Maharashtra, Gujarat, Goa", "BOM"),
        (6, "Kolkata", "West Bengal, Odisha, North-East States", "CCU"),
        (7, "Patna", "Bihar, Jharkhand", "PAT"),
        (8, "Chandigarh", "Punjab, Haryana, Himachal Pradesh, J&K, Ladakh", "IXC"),
        (9, "Lucknow", "Uttar Pradesh, Madhya Pradesh, Uttarakhand, Chhattisgarh", "LKO"),
        (10, "International", "Overseas, Middle East, Europe, Americas, APAC", "INT")
    ]
    cursor.executemany("INSERT INTO regions (id, name, states, short_code) VALUES (?, ?, ?, ?)", regions)

    # 1. Management Members
    management_users = [
        ("mgmt-1", "Dr. Andrew Dean", "management.dean@study.iitm.ac.in", "MANAGEMENT", None, None, "IITM-MGMT-001", "https://api.dicebear.com/7.x/bottts/svg?seed=AndrewDean"),
        ("mgmt-2", "Student Activities Cell", "activities.council@study.iitm.ac.in", "MANAGEMENT", None, None, "IITM-MGMT-002", "https://api.dicebear.com/7.x/bottts/svg?seed=SACell")
    ]
    cursor.executemany("INSERT INTO users (id, name, email, role, house_id, region_id, roll_number, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", management_users)

    # 2. 36 UHC Members: Exactly 3 UHC per House across 12 Houses
    uhc_users = []
    first_names_uhc = [
        "Aarav", "Vikram", "Ananya", "Rohan", "Sneha", "Karan", "Pooja", "Arjun",
        "Ishita", "Siddharth", "Neha", "Varun", "Rhea", "Kabir", "Divya", "Aditya",
        "Meera", "Karthik", "Tanvi", "Nikhil", "Shreya", "Pranav", "Bhavna", "Harsh",
        "Kavya", "Sameer", "Swati", "Abhishek", "Aparna", "Gaurav", "Nandini", "Tushar",
        "Simran", "Yash", "Ritu", "Alok"
    ]
    uhc_idx = 0
    for h_id in range(1, 13):
        for rep in range(1, 4):
            fname = first_names_uhc[uhc_idx % len(first_names_uhc)]
            uhc_id = f"uhc-{h_id}-{rep}"
            name = f"{fname} (UHC Lead - {houses[h_id-1][1]})" if rep == 1 else f"{fname} (UHC-{rep})"
            email = f"uhc.h{h_id}.rep{rep}@study.iitm.ac.in"
            roll = f"22DS{1000 + uhc_idx:04d}"
            avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed=UHC_{h_id}_{rep}"
            uhc_users.append((uhc_id, name, email, "UHC", h_id, None, roll, avatar))
            uhc_idx += 1
    cursor.executemany("INSERT INTO users (id, name, email, role, house_id, region_id, roll_number, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", uhc_users)

    # 3. 120 LHC Members: Exactly 10 LHC per House across 12 Houses (12 * 10 = 120)
    # Balanced across 10 regions: member_num 1..10 maps directly to region_id 1..10
    lhc_users = []
    first_names_lhc = [
        "Rahul", "Sneha", "Amit", "Priyanka", "Vikrant", "Anjali", "Suresh", "Kritika", "Deepak", "Manish",
        "Arun", "Pallavi", "Gautam", "Tarun", "Divyesh", "Sunita", "Harish", "Roshni", "Mayank", "Preeti",
        "Sanjay", "Vidya", "Nitin", "Aarti", "Pawan", "Shalini", "Jatin", "Monica", "Ritesh", "Payal",
        "Hemant", "Kiran", "Lokesh", "Archana", "Vivek", "Meenakshi", "Chirag", "Jyoti", "Dheeraj", "Radha",
        "Ashish", "Chaya", "Bhupesh", "Anita", "Raman", "Shweta", "Rajesh", "Kajal", "Devendra", "Poonam",
        "Sachin", "Madhavi", "Vinay", "Richa", "Chetan", "Bela", "Brijesh", "Alka", "Mahesh", "Sangeeta"
    ]

    lhc_idx = 0
    for h_id in range(1, 13):
        for member_num in range(1, 11):
            region_id = member_num  # 1: Delhi, 2: Chennai, 3: Bengaluru, 4: Hyderabad, 5: Mumbai, 6: Kolkata, 7: Patna, 8: Chandigarh, 9: Lucknow, 10: International
            fname = first_names_lhc[lhc_idx % len(first_names_lhc)]
            lhc_id = f"lhc-{h_id}-{member_num}"
            name = f"{fname} Patel" if (lhc_idx % 3 == 0) else (f"{fname} Sharma" if lhc_idx % 3 == 1 else f"{fname} Sen")
            
            # Key demo accounts in Region 5 (Mumbai):
            if h_id == 11 and member_num == 5:
                name = "Rahul Verma (LHC Proposer)"
            elif h_id == 2 and member_num == 5:
                name = "Sneha Roy (Regional Peer)"
            elif h_id == 3 and member_num == 5:
                name = "Amit Kulkarni (Regional Peer)"
            elif h_id == 1 and member_num == 5:
                name = "Priyanka Patel (Regional Peer)"
            elif h_id == 8 and member_num == 5:
                name = "Vikrant Joshi (Regional Peer)"

            email = f"lhc.h{h_id}.m{member_num}@study.iitm.ac.in"
            roll = f"23BS{2000 + lhc_idx:04d}"
            avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed=LHC_{h_id}_{member_num}"
            lhc_users.append((lhc_id, name, email, "LHC", h_id, region_id, roll, avatar))
            lhc_idx += 1

    cursor.executemany("INSERT INTO users (id, name, email, role, house_id, region_id, roll_number, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", lhc_users)

    # 4. Seed Initial Realistic Meetup Proposals
    m1_sql = '''
    INSERT INTO meetup_proposals 
    (title, description, category, proposer_id, house_id, region_id, proposed_date, start_time, end_time, mode, venue, expected_attendees, estimated_budget, status, management_remarks, reviewed_by, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    '''

    # Meetup 1: In Region 5 (Mumbai), proposed by Rahul Verma (lhc-11-5, Sundarbans House)
    cursor.execute(m1_sql, (
        "Mumbai Metro BS Python Study Jam & Hackathon",
        "A focused weekend study jam covering PDSA and Machine Learning Foundations, followed by a 2-hour mini problem-solving session and networking lunch for Mumbai region students.",
        "Study Jam & Hackathon",
        "lhc-11-5", 11, 5,
        "2026-11-08", "10:00 AM", "04:30 PM",
        "IN_PERSON", "91Springboard Coworking Hub, BKC, Mumbai",
        35, "₹ 2,500 (Snacks & Projector Rental)",
        "PENDING", None, None, None
    ))
    m1_id = cursor.lastrowid

    # Invitations for Meetup 1 (from peers in Region 5: Mumbai)
    cursor.execute("INSERT INTO meetup_invitations (meetup_id, invitee_id, status, response_note) VALUES (?, ?, ?, ?)",
                   (m1_id, "lhc-2-5", "ACCEPTED", "Excited to co-host! I can prepare the PDSA problem set."))
    cursor.execute("INSERT INTO meetup_invitations (meetup_id, invitee_id, status, response_note) VALUES (?, ?, ?, ?)",
                   (m1_id, "lhc-3-5", "ACCEPTED", "Count me in for mentoring on ML Foundations."))
    cursor.execute("INSERT INTO meetup_invitations (meetup_id, invitee_id, status, response_note) VALUES (?, ?, ?, ?)",
                   (m1_id, "lhc-1-5", "INVITED", None))
    cursor.execute("INSERT INTO meetup_invitations (meetup_id, invitee_id, status, response_note) VALUES (?, ?, ?, ?)",
                   (m1_id, "lhc-8-5", "DECLINED", "Clashing with family function, sorry!"))

    # Meetup 2: Approved Meetup in Region 5 (Mumbai), proposed by Sneha Roy (Corbett House)
    cursor.execute(m1_sql, (
        "Mumbai Data Science & AI Alumni Connect",
        "Interactive roundtable with IIT Madras BS Degree alumni working in FinTech and Generative AI spaces in Mumbai.",
        "Alumni Networking",
        "lhc-2-5", 2, 5,
        "2026-10-25", "02:00 PM", "06:00 PM",
        "HYBRID", "WeWork Enam Sambhav, BKC, Mumbai + GMeet Live Stream",
        50, "₹ 1,800",
        "APPROVED", "Approved by Management. Ensure formal code of conduct and attendance tracking.", "mgmt-1", datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ))

    # Meetup 3: In Region 1 (Delhi (NCR)), Pending
    cursor.execute(m1_sql, (
        "Delhi NCR Offline Project Review & Social",
        "In-person project collaboration session for System Commands & Application Development courses.",
        "Project Review",
        "lhc-1-1", 1, 1,
        "2026-11-15", "11:00 AM", "03:00 PM",
        "IN_PERSON", "Innov8 Coworking, Connaught Place, New Delhi",
        25, "₹ 1,200",
        "PENDING", None, None, None
    ))

    # Meetup 4: Rejected Meetup in Region 2 (Chennai)
    cursor.execute(m1_sql, (
        "Chennai Campus Lawn Meetup & Cultural Evening",
        "Informal meetup at IIT Madras campus lawn for local students.",
        "Cultural & Social",
        "lhc-9-2", 9, 2,
        "2026-10-18", "04:00 PM", "07:30 PM",
        "IN_PERSON", "IIT Madras Main Campus (Near Gajendra Circle)",
        40, "₹ 800",
        "REJECTED", "Campus lawn access requires security clearance from Dean of Students office at least 14 days in advance. Please re-submit with auditorium permission.", "mgmt-1", datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ))

    # Meetup 5: COMPLETED Meetup in Region 3 (Bengaluru) with Pending Reimbursement
    cursor.execute(m1_sql, (
        "Bengaluru BS Python & Data Structures Offline Bootcamp",
        "Full day intensive coding bootcamp with problem sets on Trees, Graphs, and HashMaps with alumni mentors.",
        "Study Jam",
        "lhc-12-3", 12, 3,
        "2026-10-04", "09:30 AM", "04:30 PM",
        "IN_PERSON", "Koramangala Community Center, Bengaluru",
        30, "₹ 2,500",
        "COMPLETED", "Approved by Management. Event successfully conducted.", "mgmt-1", "2026-09-28 14:00:00"
    ))
    m5_id = cursor.lastrowid

    # Add reimbursement claim for Meetup 5 (PENDING_REVIEW)
    cursor.execute('''
        INSERT INTO reimbursements 
        (meetup_id, claimant_id, amount_claimed, actual_attendance, attendance_proof_notes, bills_description, receipts_file_name, bank_or_upi_details, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')
    ''', (
        m5_id, "lhc-12-3", 2450.0, 28,
        "28 students attended. Verified via QR attendance sheet & group photo with all participants.",
        "Refreshments & Tea for 28 attendees (₹ 1,750), Whiteboard markers & writing pads (₹ 350), HDMI projector adapter (₹ 350).",
        "CCD_Refreshments_INV882.pdf, Stationery_Bill_331.jpg",
        "arjun.bs@okaxis (State Bank of India A/C: 38291048291)"
    ))

    # Meetup 6: COMPLETED Meetup in Region 4 (Hyderabad) with Approved Reimbursement
    cursor.execute(m1_sql, (
        "Hyderabad Machine Learning & Deep Learning Circle",
        "Offline research paper reading session and neural net code-along for Hyderabad cohort students.",
        "Project Collaboration",
        "lhc-6-4", 6, 4,
        "2026-09-22", "11:00 AM", "03:00 PM",
        "IN_PERSON", "T-Hub Phase 2, Knowledge City, Hyderabad",
        25, "₹ 1,800",
        "COMPLETED", "Approved by Management. Excellent regional turnout.", "mgmt-1", "2026-09-18 10:00:00"
    ))
    m6_id = cursor.lastrowid

    cursor.execute('''
        INSERT INTO reimbursements 
        (meetup_id, claimant_id, amount_claimed, amount_approved, actual_attendance, attendance_proof_notes, bills_description, receipts_file_name, bank_or_upi_details, status, management_notes, reviewed_by, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        m6_id, "lhc-6-4", 1800.0, 1800.0, 24,
        "24 students attended. Verified via physical sign-up sheet.",
        "Meeting room snack packs & beverages from T-Hub cafe (₹ 1,800).",
        "THub_Cafe_Receipt_5419.pdf",
        "kavya.hyd@sbi (HDFC Bank A/C: 501002391029)",
        "APPROVED",
        "Bills matched GST invoice and attendance verified. Approved for direct bank transfer.",
        "mgmt-1",
        "2026-09-25 15:30:00"
    ))

    # Meetup 7: Approved Meetup in Region 6 (Kolkata)
    cursor.execute(m1_sql, (
        "Kolkata Tech Symposium & Networking Meet",
        "Interactive session on open-source contributions and full-stack web development for eastern region learners.",
        "Symposium & Social",
        "lhc-5-6", 5, 6,
        "2026-10-30", "01:00 PM", "05:00 PM",
        "IN_PERSON", "Biswa Bangla Convention Centre, Kolkata",
        30, "₹ 2,200",
        "APPROVED", "Approved by Management. Keep attendance sign-in sheet handy.", "mgmt-1", "2026-10-10 11:30:00"
    ))

    # Meetup 8: Approved Meetup in Region 7 (Patna)
    cursor.execute(m1_sql, (
        "Patna BS Math & Stats Peer Problem Solving Circle",
        "Deep-dive practice session solving previous year questions and proof techniques for Mathematics 2 and Statistics 2.",
        "Study Jam",
        "lhc-4-7", 4, 7,
        "2026-11-02", "11:00 AM", "03:00 PM",
        "IN_PERSON", "Incubation Hub, Fraser Road, Patna",
        20, "₹ 1,000",
        "APPROVED", "Approved by Management.", "mgmt-1", "2026-10-11 16:00:00"
    ))

    # 5. Notifications
    cursor.execute('''
    INSERT INTO notifications (user_id, title, message, type, related_meetup_id, is_read)
    VALUES (?, ?, ?, 'PROPOSAL_STATUS', ?, 0)
    ''', ('lhc-11-5', 'Meetup Proposal Submitted', 'Your proposal "Mumbai Metro BS Python Study Jam & Hackathon" has been forwarded to Management for review.', m1_id))

    cursor.execute('''
    INSERT INTO notifications (user_id, title, message, type, related_meetup_id, is_read)
    VALUES (?, ?, ?, 'PROPOSAL_STATUS', ?, 0)
    ''', ('mgmt-1', 'New Meetup Awaiting Approval', 'LHC Rahul Verma (Sundarbans House) submitted "Mumbai Metro BS Python Study Jam & Hackathon" in Mumbai Region.', m1_id))

if __name__ == '__main__':
    print("Initializing Database...")
    init_db(force_reseed=True)
    print(f"Database successfully created and seeded at: {DB_PATH}")
