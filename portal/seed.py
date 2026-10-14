"""Demo roster and meetups.

Roster: 12 houses × (3 UHC + 10 LHC) = 36 UHC + 120 LHC, plus Administration.
LHC member n of every house sits in region n, so each region has exactly
12 LHCs — one from each house.

Meetup dates are generated relative to today so the demo always has
upcoming, in-flight and past events.
"""
import random
from datetime import date, datetime, time, timedelta, timezone

HOUSES = [
    # id, slug, name, motto, color (sampled from the crest artwork)
    (1, 'bandipur', 'Bandipur', 'Guardians of the Wild', '#3E7CB1'),
    (2, 'corbett', 'Corbett', 'Roar of the Brave', '#C9A227'),
    (3, 'gir', 'Gir', 'Pride of the Realm', '#2F8F5B'),
    (4, 'kanha', 'Kanha', 'Grace in Strength', '#B5652B'),
    (5, 'kaziranga', 'Kaziranga', 'Beyond Limits', '#1F7A5A'),
    (6, 'nallamala', 'Nallamala', 'Valour and Honour', '#A8842F'),
    (7, 'namdapha', 'Namdapha', 'Soaring to Heights', '#7A8597'),
    (8, 'nilgiri', 'Nilgiri', 'Blue Mountain Spirit', '#7B5CC4'),
    (9, 'pichavaram', 'Pichavaram', 'Rooted in Resilience', '#2A9D8F'),
    (10, 'saranda', 'Saranda', 'Wings of Victory', '#D08C1F'),
    (11, 'sundarbans', 'Sundarbans', 'Majesty of the Delta', '#D2691E'),
    (12, 'wayanad', 'Wayanad', 'Heritage & Wisdom', '#3D8BD9'),
]

REGIONS = [
    (1, 'DEL', 'Delhi NCR', 'Delhi, Noida, Gurugram, Ghaziabad, Faridabad'),
    (2, 'MAA', 'Chennai', 'Tamil Nadu, Puducherry'),
    (3, 'BLR', 'Bengaluru', 'Karnataka, Kerala'),
    (4, 'HYD', 'Hyderabad', 'Telangana, Andhra Pradesh'),
    (5, 'BOM', 'Mumbai', 'Maharashtra, Gujarat, Goa'),
    (6, 'CCU', 'Kolkata', 'West Bengal, Odisha, North-East'),
    (7, 'PAT', 'Patna', 'Bihar, Jharkhand'),
    (8, 'IXC', 'Chandigarh', 'Punjab, Haryana, Himachal Pradesh, J&K, Ladakh'),
    (9, 'LKO', 'Lucknow', 'Uttar Pradesh, Madhya Pradesh, Uttarakhand, Chhattisgarh'),
    (10, 'INT', 'International', 'Students outside India'),
]

FIRST = [
    'Aarav', 'Aditi', 'Akash', 'Ananya', 'Arjun', 'Bhavya', 'Chetan', 'Deepika', 'Dev', 'Diya',
    'Farhan', 'Gauri', 'Harsh', 'Isha', 'Ishaan', 'Jahnavi', 'Kabir', 'Kavya', 'Karthik', 'Lavanya',
    'Manav', 'Meghna', 'Nikhil', 'Nisha', 'Om', 'Pallavi', 'Pranav', 'Priya', 'Rachit', 'Ritika',
    'Rohan', 'Saanvi', 'Sahil', 'Sanjana', 'Shreya', 'Siddharth', 'Simran', 'Tanmay', 'Tanya', 'Uday',
    'Varun', 'Vedika', 'Vihaan', 'Yash', 'Zoya', 'Abhinav', 'Aishwarya', 'Gokul', 'Hrithik', 'Keerthana',
]
LAST = [
    'Agarwal', 'Bhat', 'Chatterjee', 'Das', 'Desai', 'Fernandes', 'Ghosh', 'Gupta', 'Iyer', 'Jain',
    'Kapoor', 'Khan', 'Kulkarni', 'Menon', 'Mishra', 'Nair', 'Pandey', 'Patel', 'Pillai', 'Rao',
    'Reddy', 'Saxena', 'Sharma', 'Singh', 'Srinivasan', 'Thakur', 'Tiwari', 'Varma', 'Yadav', 'Zaidi',
]

UHC_TITLES = ['Secretary', 'Deputy Secretary', 'Web Admin']

# Fixed names for the accounts the walkthrough in WORKFLOW.md refers to.
NAMED = {
    'lhc-11-5': 'Rahul Verma',
    'lhc-2-5': 'Sneha Roy',
    'lhc-3-5': 'Amit Kulkarni',
    'lhc-1-5': 'Priyanka Nair',
    'lhc-8-5': 'Vikrant Joshi',
    'uhc-11-1': 'Vikram Rao',
}

DEMO_ACCOUNTS = ['admin-1', 'uhc-11-1', 'lhc-11-5', 'lhc-2-5']

BUDGET_PER_HEAD = 200  # standard allowance in ₹ per expected attendee; keep in sync with portal/api/common.py


def _ts(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def seed(conn):
    rng = random.Random(2026)
    today = date.today()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    c = conn.cursor()

    c.executemany('INSERT INTO houses (id, slug, name, motto, color) VALUES (?,?,?,?,?)', HOUSES)
    c.executemany('INSERT INTO regions (id, code, name, states) VALUES (?,?,?,?)', REGIONS)

    # ── People ──────────────────────────────────────────────────────────────
    c.executemany(
        'INSERT INTO users (id, name, email, role, title) VALUES (?,?,?,?,?)',
        [
            ('admin-1', 'Dr. Meera Krishnan', 'activities.faculty@study.iitm.ac.in', 'ADMINISTRATION',
             'Faculty-in-charge, Student Activities'),
            ('admin-2', 'Arvind Subramanian', 'activities.office@study.iitm.ac.in', 'ADMINISTRATION',
             'Student Activities Office'),
        ],
    )

    used_names = set(NAMED.values())
    used_names.update(['Dr. Meera Krishnan', 'Arvind Subramanian'])

    def fresh_name():
        while True:
            name = f'{rng.choice(FIRST)} {rng.choice(LAST)}'
            if name not in used_names:
                used_names.add(name)
                return name

    serial = [1000]

    def roll(year):
        serial[0] += rng.randint(7, 97)
        return f'{year}f{serial[0]:07d}'

    users = []
    for h_id, *_ in HOUSES:
        for n in range(1, 4):
            uid = f'uhc-{h_id}-{n}'
            r = roll(rng.choice([21, 22]))
            # UHC seats have fixed position emails that pass to each newly elected member.
            seat_email = f"{HOUSES[h_id - 1][1]}.{UHC_TITLES[n - 1].lower().replace(' ', '')}@study.iitm.ac.in"
            users.append((uid, NAMED.get(uid) or fresh_name(), seat_email, 'UHC',
                          UHC_TITLES[n - 1], h_id, None, r))
        for n in range(1, 11):
            uid = f'lhc-{h_id}-{n}'
            r = roll(rng.choice([22, 23, 24]))
            users.append((uid, NAMED.get(uid) or fresh_name(), f'{r}@ds.study.iitm.ac.in', 'LHC',
                          None, h_id, n, r))
    c.executemany(
        'INSERT INTO users (id, name, email, role, title, house_id, region_id, roll_number) '
        'VALUES (?,?,?,?,?,?,?,?)', users)

    user_house = {u[0]: u[5] for u in users}
    user_name = {u[0]: u[1] for u in users}

    def demo_bank(uid):
        """Obviously fake bank details for sample data (bank 'Demo Bank', IFSC DEMO0…)."""
        return (user_name.get(uid, 'Sample Student'), 'Demo Bank', f'{rng.randrange(10**11, 10**12)}',
                f'DEMO0{rng.randrange(100000, 999999)}', None)

    def demo_attendees(n):
        out = []
        for _ in range(n):
            out.append((f'{rng.choice(FIRST)} {rng.choice(LAST)}', f'{rng.choice([22, 23, 24])}f{rng.randrange(1000000, 3999999):07d}@ds.study.iitm.ac.in'))
        return out
    user_region = {u[0]: u[6] for u in users}

    # ── Meetups ─────────────────────────────────────────────────────────────
    def day(offset):
        return (today + timedelta(days=offset)).isoformat()

    def at(days_ago, hour=10):
        return now - timedelta(days=days_ago, hours=rng.randint(0, 6)) + timedelta(hours=hour - 10)

    def activity(mid, actor, action, when, note=None):
        c.execute('INSERT INTO meetup_activity (meetup_id, actor_id, action, note, created_at) '
                  'VALUES (?,?,?,?,?)', (mid, actor, action, note, _ts(when)))

    def meetup(proposer, title, description, category, offset, start, end, venue,
               attendees, extra, extra_note, status, invites=(), review=None, created_days_ago=10,
               claim=None, backup=None, region=None, collab=None):
        budget = BUDGET_PER_HEAD * attendees + extra
        collab = collab or {}
        created = at(created_days_ago)
        submitted = None if status == 'DRAFT' else created + timedelta(minutes=12)
        reviewed_at = reviewed_by = None
        if review:
            reviewed_by = review[0]
            reviewed_at = submitted + timedelta(days=review[2], hours=3)
        completed_at = _ts(now - timedelta(days=max(-offset - 1, 0))) if status == 'COMPLETED' else None
        c.execute(
            '''INSERT INTO meetups (title, description, category, proposer_id, house_id, region_id,
                   event_date, backup_date, start_time, end_time, venue, expected_attendees,
                   budget_per_head, extra_budget, extra_budget_note, budget_requested,
                   status, review_comments, reviewed_by, reviewed_at,
                   submitted_at, completed_at, created_at, updated_at,
                   collab_type, collab_name, collab_about, collab_agenda, collab_contact, collab_sponsored,
                   collab_sponsorship)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (title, description, category, proposer, user_house[proposer], region or user_region[proposer],
             day(offset), day(backup) if backup is not None else None, start, end, venue, attendees,
             BUDGET_PER_HEAD, extra, extra_note, budget, status,
             review[1] if review else None, reviewed_by, _ts(reviewed_at) if reviewed_at else None,
             _ts(submitted) if submitted else None, completed_at, _ts(created), _ts(reviewed_at or created),
             collab.get('type', 'NONE'), collab.get('name'), collab.get('about'), collab.get('agenda'),
             collab.get('contact'), collab.get('sponsored'), collab.get('sponsorship')))
        mid = c.lastrowid
        activity(mid, proposer, 'CREATED', created)
        if submitted:
            activity(mid, proposer, 'SUBMITTED', submitted)

        for i, (invitee, inv_status, note) in enumerate(invites):
            responded = submitted + timedelta(hours=5 + 7 * i) if inv_status != 'INVITED' else None
            c.execute('INSERT INTO meetup_invitations (meetup_id, invitee_id, status, response_note, responded_at, created_at) '
                      'VALUES (?,?,?,?,?,?)',
                      (mid, invitee, inv_status, note, _ts(responded) if responded else None, _ts(created)))
            if responded:
                activity(mid, invitee, 'INVITE_ACCEPTED' if inv_status == 'ACCEPTED' else 'INVITE_DECLINED',
                         responded, note)

        if review:
            activity(mid, review[0], 'APPROVED' if status in ('APPROVED', 'COMPLETED') else 'REJECTED',
                     reviewed_at, review[1])
        if status == 'COMPLETED':
            activity(mid, 'admin-2', 'COMPLETED', now - timedelta(days=max(-offset - 1, 0)))

        if claim:
            amount, approved, attendance, _att_notes, exp_notes, _payout, c_status, c_notes, files = claim
            filed = now - timedelta(days=max(-offset - 3, 0))
            bank = demo_bank(proposer)
            c.execute(
                '''INSERT INTO claims (meetup_id, claimant_id, amount_claimed, amount_approved, actual_attendance,
                       expense_notes, post_link, payout_mode, payee_user_id, payee_name, bank_name, account_number,
                       ifsc, upi_id, status, review_notes, reviewed_by, reviewed_at, created_at)
                   VALUES (?,?,?,?,?,?,?,'SELF',?,?,?,?,?,?,?,?,?,?,?)''',
                (mid, proposer, amount, approved, attendance, exp_notes,
                 f'https://www.instagram.com/p/demo{mid:04d}/', proposer, *bank, c_status, c_notes,
                 'admin-1' if c_status != 'PENDING_REVIEW' else None,
                 _ts(filed + timedelta(days=1)) if c_status != 'PENDING_REVIEW' else None, _ts(filed)))
            claim_id = c.lastrowid
            c.executemany('INSERT OR IGNORE INTO claim_attendees (claim_id, name, email) VALUES (?,?,?)',
                          [(claim_id, n, e) for n, e in demo_attendees(attendance)])
            c.execute('UPDATE claims SET actual_attendance = (SELECT COUNT(*) FROM claim_attendees WHERE claim_id = ?) '
                      'WHERE id = ?', (claim_id, claim_id))
            for fname in files:
                # Seeded claims reference receipts that were never uploaded; stored_name marks them as samples.
                c.execute('INSERT INTO claim_files (claim_id, original_name, stored_name, size_bytes, created_at) '
                          'VALUES (?,?,?,?,?)', (claim_id, fname, f'sample-{claim_id}-{fname}', 0, _ts(filed)))
            activity(mid, proposer, 'CLAIM_FILED', filed, f'₹{amount:,} for {attendance} attendees')
            if c_status != 'PENDING_REVIEW':
                activity(mid, 'admin-1', f'CLAIM_{c_status}', filed + timedelta(days=1), c_notes)
        return mid

    # Mumbai — the walkthrough region
    m_rahul = meetup(
        'lhc-11-5', 'PDSA study jam and mock OPPE',
        'A half-day session for Mumbai-region students preparing for the PDSA OPPE. We will run a timed '
        'mock exam on the portal format, then pair up to go through solutions. Laptops required; '
        'we will share the problem set in the regional group two days before.',
        'STUDY_JAM', 18, '10:00', '15:30',
        '91springboard, Bandra Kurla Complex, Mumbai', 35, 0, None,
        'PEER_REVIEW', backup=25,
        invites=[('lhc-3-5', 'ACCEPTED', 'Happy to co-host — I can set the graph problems.'),
                 ('lhc-8-5', 'DECLINED', 'Family function that weekend, sorry.'),
                 ('lhc-2-5', 'INVITED', None),
                 ('lhc-1-5', 'INVITED', None)],
        created_days_ago=2)

    meetup(
        'lhc-2-5', 'Alumni connect: data careers in fintech',
        'An evening round-table with four BS alumni now working in data and ML roles at Mumbai fintechs. '
        'Short talks followed by open Q&A and informal networking.',
        'ALUMNI_TALK', 11, '17:00', '20:00',
        'WeWork Enam Sambhav, BKC, Mumbai', 50, 0, None,
        'APPROVED',
        invites=[('lhc-11-5', 'ACCEPTED', 'In. I will handle registrations at the door.')],
        review=('admin-1', 'Approved. Please keep an attendance sheet at the entrance.', 2),
        created_days_ago=9,
        collab={'type': 'EXTERNAL', 'name': 'Mumbai Data Circle',
                'about': 'A volunteer-run community of data professionals in Mumbai that hosts monthly talks.',
                'agenda': 'They bring the four alumni speakers and moderate the Q&A; we handle registrations and the venue.',
                'contact': 'Neha Kapoor, community lead · neha@mumbaidatacircle.example',
                'sponsored': 1, 'sponsorship': 'Covering refreshments (about ₹4,000). They ask for a logo mention on the event poster.'})

    meetup(
        'lhc-11-5', 'Kaggle weekend: tabular playground',
        'Two-day team competition on a Kaggle playground dataset. Teams of three, mixed foundation and diploma level.',
        'HACKATHON', 40, '09:30', '18:00',
        'Somaiya Vidyavihar Innovation Centre, Mumbai', 40, 6000, 'Two-day booking of the innovation centre hall (₹3,000 per day).', 'DRAFT',
        created_days_ago=1)

    meetup(
        'lhc-11-5', 'Mumbai foundation-level meet and greet',
        'Informal get-together for students who joined this term. Introductions, course planning tips and a short campus Q&A.',
        'NETWORKING', -14, '16:00', '19:00',
        'Carter Road Amphitheatre, Bandra, Mumbai', 30, 0, None,
        'COMPLETED',
        invites=[('lhc-2-5', 'ACCEPTED', 'Will bring the welcome kit.')],
        review=('admin-1', 'Approved.', 1), created_days_ago=30)

    # Other regions
    meetup(
        'lhc-1-1', 'Delhi NCR project review circle',
        'Bring your MAD-1 and MAD-2 projects for structured peer review. Each team gets 15 minutes of feedback.',
        'PROJECT', 25, '11:00', '15:00',
        'Innov8, Connaught Place, New Delhi', 25, 1200, 'Meeting room at Innov8 for four hours.',
        'PENDING', backup=32,
        collab={'type': 'SOCIETY', 'name': 'Coding and Development Society',
                'agenda': 'Society mentors will run the MAD-2 review track and share their project rubric.',
                'contact': 'Ishaan Gupta, society coordinator · 22f1000456@ds.study.iitm.ac.in'},
        invites=[('lhc-6-1', 'ACCEPTED', 'I will moderate the MAD-2 track.'),
                 ('lhc-9-1', 'DECLINED', 'Have quiz prep that weekend.')],
        created_days_ago=3)

    meetup(
        'lhc-9-2', 'Campus lawn evening and cultural meet',
        'Informal evening on the IIT Madras campus with music and a short quiz.',
        'CULTURAL', 6, '16:00', '19:30',
        'IIT Madras campus, near Gajendra Circle', 40, 0, None,
        'REJECTED',
        review=('admin-1', 'Campus venues need clearance from the Dean of Students office at least 14 days in advance. '
                          'Please resubmit with the clearance letter or pick an off-campus venue.', 1),
        created_days_ago=5)

    meetup(
        'lhc-12-3', 'Python and DSA offline bootcamp',
        'Full-day coding bootcamp covering trees, graphs and hash maps, with alumni mentors at each table.',
        'STUDY_JAM', -10, '09:30', '16:30',
        'Koramangala Community Centre, Bengaluru', 30, 0, None,
        'COMPLETED',
        invites=[('lhc-4-3', 'ACCEPTED', 'I will run the graphs table.')],
        review=('admin-1', 'Approved.', 2), created_days_ago=28,
        claim=(2450, None, 28, '28 students signed in; QR sign-in sheet and group photo attached.',
               'Refreshments for 28 (₹1,750), markers and pads (₹350), HDMI adapter (₹350).',
               'UPI: karthik.blr@okaxis', 'PENDING_REVIEW', None,
               ['refreshments-invoice.pdf', 'stationery-bill.jpg']))

    meetup(
        'lhc-6-4', 'ML paper reading circle',
        'Reading "Attention Is All You Need" together, then a code-along building a tiny transformer.',
        'STUDY_JAM', -22, '11:00', '15:00',
        'T-Hub Phase 2, Knowledge City, Hyderabad', 25, 0, None,
        'COMPLETED', review=('admin-1', 'Approved.', 1), created_days_ago=40,
        claim=(1800, 1800, 24, 'Paper sign-in sheet, 24 names.', 'T-Hub cafe snack boxes (₹1,800).',
               'HDFC A/C ending 1029', 'APPROVED', 'Bills match GST invoice. Approved for transfer.',
               ['thub-cafe-receipt.pdf']))

    meetup(
        'lhc-10-9', 'Lucknow statistics problem-solving circle',
        'Previous-year Stats 2 problems worked through in small groups.',
        'STUDY_JAM', -35, '10:00', '13:00',
        'Lucknow Startup Hub, Gomti Nagar', 18, 0, None,
        'COMPLETED', review=('admin-2', 'Approved.', 3), created_days_ago=50,
        claim=(900, None, 16, 'Sign-in sheet attached.', 'Tea and snacks (₹900).', 'UPI: lko.lhc@ybl',
               'IN_PROGRESS', 'Forwarded to Institute Accounts.', ['tea-stall-bill.jpg']))

    meetup(
        'lhc-5-6', 'Open-source contribution sprint',
        'Pick a good-first-issue in a Python project and get a PR open by the end of the day.',
        'HACKATHON', 16, '13:00', '18:00',
        'Webel IT Park, Salt Lake, Kolkata', 30, 0, None,
        'APPROVED', review=('admin-1', 'Approved. Keep an attendance sheet.', 2), created_days_ago=8)

    meetup(
        'lhc-4-7', 'Maths 2 proofs practice',
        'Small-group practice on proof techniques and previous-year Maths 2 questions.',
        'STUDY_JAM', 19, '11:00', '15:00',
        'Bihar Startup Hub, Fraser Road, Patna', 20, 0, None,
        'APPROVED', review=('admin-2', 'Approved.', 1), created_days_ago=6)

    meetup(
        'lhc-7-8', 'Chandigarh SQL and DBMS revision evening',
        'Evening revision session for DBMS end-terms with a shared problem set and small tables by topic.',
        'STUDY_JAM', 9, '19:00', '21:00',
        'Startup Hub, Sector 17, Chandigarh', 35, 800, 'Seminar room booking at the startup hub.', 'PENDING', created_days_ago=1, backup=12)

    meetup(
        'lhc-3-10', 'Dubai cohort meetup: BDM case discussion',
        'In-person meetup for BS students in the UAE. Group discussion of a BDM case, then dinner together.',
        'NETWORKING', 5, '18:30', '20:00',
        'Dubai Knowledge Park, Block 2, Dubai', 24, 1500, 'Private area booking at the café.',
        'APPROVED', review=('admin-1', 'Approved.', 1), created_days_ago=7)

    meetup(
        'lhc-11-2', 'Chennai Sundarbans house meetup at Besant Nagar',
        'Sundarbans and friends: beach walk, snacks and a quiz on house history.',
        'CULTURAL', 21, '16:30', '19:00',
        "Elliot's Beach, Besant Nagar, Chennai", 30, 0, None,
        'PENDING', backup=28,
        invites=[('lhc-2-2', 'ACCEPTED', None), ('lhc-7-2', 'ACCEPTED', 'Will bring a speaker.')],
        created_days_ago=2)

    meetup(
        'lhc-11-3', 'Bengaluru weekend cricket and meet',
        'Box cricket followed by lunch. Teams mixed across houses.',
        'SPORTS', -3, '07:30', '11:30',
        'Turf Park, HSR Layout, Bengaluru', 24, 2400, 'Turf booking for four hours.',
        'APPROVED', review=('admin-1', 'Approved. Ensure everyone signs the participation waiver.', 2),
        created_days_ago=20)

    # A UHC-led meetup: UHC members can propose in any region and co-host with UHC members of other houses.
    meetup(
        'uhc-11-1', 'Inter-house council meet: Chennai',
        'An evening for house councils in Chennai to share what worked this term: event formats, turnout, '
        'and how co-hosting across houses went. Open to all students; council members lead short sessions.',
        'NETWORKING', 23, '17:00', '20:00', 'IITM Research Park, Taramani, Chennai', 60, 3000,
        'Auditorium booking at the Research Park (₹3,000).',
        'PEER_REVIEW', backup=30, region=2, created_days_ago=1,
        invites=[('uhc-2-1', 'ACCEPTED', 'Happy to run the event-formats session.'),
                 ('uhc-5-1', 'INVITED', None)])

    # Historical background volume for analytics.
    topics = [
        ('Weekend study jam', 'STUDY_JAM'), ('Project show-and-tell', 'PROJECT'),
        ('Alumni AMA', 'ALUMNI_TALK'), ('New-term meet and greet', 'NETWORKING'),
        ('Mini hackathon', 'HACKATHON'), ('Quiz night', 'CULTURAL'), ('Football morning', 'SPORTS'),
    ]
    region_name = {r[0]: r[2] for r in REGIONS}
    for _ in range(34):
        h = rng.randint(1, 12)
        rg = rng.choices(range(1, 11), weights=[9, 8, 9, 7, 9, 5, 3, 4, 5, 3])[0]
        proposer = f'lhc-{h}-{rg}'
        if proposer in NAMED:  # keep the walkthrough accounts' histories hand-written
            continue
        topic, cat = rng.choice(topics)
        offset = -rng.randint(20, 120)
        status = rng.choices(['COMPLETED', 'REJECTED', 'CANCELLED'], weights=[8, 2, 1])[0]
        attendees = rng.randint(12, 55)
        extra = rng.choice([0, 0, 0, rng.randrange(1000, 4000, 500)])
        budget = BUDGET_PER_HEAD * attendees + extra
        review = None
        if status == 'REJECTED':
            review = ('admin-1', rng.choice([
                'Clashes with the end-term exam window. Please pick a date after exams.',
                'Venue details are incomplete. Add the full address and booking confirmation.',
                'Budget is above the per-meetup limit for this attendance. Please revise.']), 2)
        elif status in ('COMPLETED', 'CANCELLED'):
            review = ('admin-1', 'Approved.', 1)
        claim = None
        if status == 'COMPLETED' and budget and rng.random() < 0.8:
            spent = budget - rng.randrange(200, 1500, 50)
            att = max(5, attendees - rng.randint(0, 10))
            claim = (spent, spent, att, 'Sign-in sheet attached.', 'Refreshments and logistics.',
                     'UPI on file', 'APPROVED', 'Verified.', ['bills.pdf'])
        mid = meetup(proposer, f'{region_name[rg]} {topic.lower()}', f'{topic} for {region_name[rg]} students.',
                     cat, offset, '10:00', '13:00', f'Community venue, {region_name[rg]}',
                     attendees, extra, 'Venue booking.' if extra else None, 'APPROVED' if status == 'CANCELLED' else status,
                     review=review, created_days_ago=-offset + rng.randint(10, 25), claim=claim)
        if status == 'CANCELLED':
            c.execute("UPDATE meetups SET status = 'CANCELLED' WHERE id = ?", (mid,))
            activity(mid, proposer, 'CANCELLED', at(-offset + 2), 'Venue fell through.')

    # Saved payout details: Sneha (a co-host of Rahul's completed meetup) has them, so Rahul can pick her
    # as the payee; Rahul has none yet, so his own details get saved from the claim form.
    c.execute('INSERT INTO payout_details (user_id, account_holder, bank_name, account_number, ifsc, upi_id) '
              'VALUES (?,?,?,?,?,?)', ('lhc-2-5', 'Sneha Roy', 'Demo Bank', '501234567890', 'DEMO0123456', 'sneha.demo@upi'))

    # ── Notifications ───────────────────────────────────────────────────────
    notes = [
        ('lhc-2-5', 'Co-host invitation', 'Rahul Verma invited you to co-host "PDSA study jam and mock OPPE".', m_rahul, 1),
        ('lhc-11-5', 'Invitation accepted', 'Amit Kulkarni accepted your co-host invitation for "PDSA study jam and mock OPPE".', m_rahul, 1),
        ('lhc-11-5', 'Invitation declined', 'Vikrant Joshi declined your co-host invitation for "PDSA study jam and mock OPPE".', m_rahul, 1),
        ('admin-1', 'New proposal to review', 'Delhi NCR project review circle was submitted by an LHC in Delhi NCR.', None, 3),
        ('admin-1', 'Claim filed', 'A ₹2,450 claim was filed for "Python and DSA offline bootcamp".', None, 7),
        ('uhc-11-1', 'New Sundarbans proposal', 'A Sundarbans LHC in Chennai proposed "Chennai Sundarbans house meetup at Besant Nagar".', None, 2),
    ]
    for uid, title, body, mid, days_ago in notes:
        c.execute('INSERT INTO notifications (user_id, title, body, meetup_id, created_at) VALUES (?,?,?,?,?)',
                  (uid, title, body, mid, _ts(now - timedelta(days=days_ago, hours=1))))
