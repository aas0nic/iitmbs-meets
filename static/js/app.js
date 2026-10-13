// IITM BS Student Activities — Meetup Approval & Governance JavaScript Engine

class AppState {
  constructor() {
    this.currentUser = null;
    this.houses = [];
    this.regions = [];
    this.demoUsers = [];
    this.meetups = [];
    this.reimbursements = [];
    this.notifications = [];
    this.statsData = null;
    this.activeView = 'dashboard';
    this.statusFilter = 'ALL';
    this.reimbFilter = 'ALL';
    this.regionFilter = '';
    this.houseFilter = '';
  }

  async init() {
    this.bindEvents();
    await this.loadBootstrap();
    await this.restoreSession();
    await this.loadMeetups();
    await this.loadReimbursements();
    await this.loadOverallStats();
    await this.loadNotifications();
    this.renderActiveView();
  }

  async loadBootstrap() {
    try {
      const res = await fetch('/api/bootstrap');
      const data = await res.json();
      this.houses = data.houses || [];
      this.regions = data.regions || [];
      this.demoUsers = data.demo_users || [];
      
      this.populateFilterDropdowns();
      this.renderQuickAuthList();
    } catch (err) {
      this.showToast('Failed to load system bootstrap data', 'error');
      console.error(err);
    }
  }

  async restoreSession() {
    // Default to Management Dr. Andrew for reviewing the management experience!
    const savedUserId = localStorage.getItem('iitm_active_user_id') || 'mgmt-1';
    await this.switchUser(savedUserId, false);
  }

  async switchUser(userId, reloadData = true) {
    try {
      const res = await fetch(`/api/user/${userId}`);
      if (!res.ok) throw new Error('User not found');
      const data = await res.json();
      this.currentUser = data.user;
      localStorage.setItem('iitm_active_user_id', userId);

      this.updateUserUI();
      if (reloadData) {
        await this.loadMeetups();
        await this.loadReimbursements();
        await this.loadOverallStats();
        await this.loadNotifications();
      }
      this.renderActiveView();
      this.showToast(`Switched active profile: ${this.currentUser.name} (${this.currentUser.role})`, 'info');
    } catch (err) {
      console.error(err);
      this.showToast('Could not switch user', 'error');
    }
  }

  updateUserUI() {
    if (!this.currentUser) return;
    const user = this.currentUser;

    // Update avatar and name in topbar
    const avatarImg = document.getElementById('userAvatarImg');
    if (avatarImg) avatarImg.src = user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=user';
    
    const mobileAvatarImg = document.getElementById('mobileUserAvatarImg');
    if (mobileAvatarImg) mobileAvatarImg.src = user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=user';

    const nameLabel = document.getElementById('userNameLabel');
    if (nameLabel) nameLabel.textContent = user.name;
    
    // Update role badge in header
    const badgeEl = document.getElementById('userRoleBadge');
    if (badgeEl) {
      if (user.role === 'MANAGEMENT') {
        badgeEl.textContent = 'Management Central';
        badgeEl.className = 'user-chip-role role-mgmt';
      } else if (user.role === 'UHC') {
        badgeEl.textContent = `UHC • ${user.house_name}`;
        badgeEl.className = 'user-chip-role role-uhc';
      } else {
        badgeEl.textContent = `LHC • ${user.house_name} • ${user.region_name.split(' - ')[0]}`;
        badgeEl.className = 'user-chip-role role-lhc';
      }
    }

    // Update quick picker buttons in desktop topbar
    document.querySelectorAll('.role-quick-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.userId === user.id);
    });

    // Update quick picker active state in mobile bottom sheet
    document.querySelectorAll('.quick-role-select-card').forEach(card => {
      const onclickAttr = card.getAttribute('onclick') || '';
      card.classList.toggle('active', onclickAttr.includes(`'${user.id}'`));
    });

    // Update Role Alert Banner on Dashboard
    this.renderRoleAlertBanner();
  }

  renderRoleAlertBanner() {
    const banner = document.getElementById('roleAlertBanner');
    if (!banner || !this.currentUser) return;

    const u = this.currentUser;
    if (u.role === 'MANAGEMENT') {
      banner.innerHTML = `
        <div class="role-callout-content">
          <span class="role-badge-pill role-mgmt-badge">👑 Management Authority</span>
          <div>
            <strong>Executive Governance & Approvals Console</strong>
            <p class="text-muted">Review proposals, approve regional meetups, inspect cross-house stats, and verify post-meetup reimbursement claims.</p>
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="window.app.switchView('meetups'); window.app.setMeetupFilter('PENDING');">
            Review Pending Meets
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.app.switchView('reimbursements')">
            Reimbursements
          </button>
        </div>
      `;
    } else if (u.role === 'UHC') {
      banner.innerHTML = `
        <div class="role-callout-content">
          <span class="role-badge-pill role-uhc-badge">🏛️ Upper House Council</span>
          <div>
            <strong>${u.house_name} House Lead (${u.name})</strong>
            <p class="text-muted">Oversight across 10 lower house council representatives and cross-regional student activities.</p>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.app.switchView('stats')">
          View House Stats
        </button>
      `;
    } else {
      banner.innerHTML = `
        <div class="role-callout-content">
          <span class="role-badge-pill role-lhc-badge">✍️ Lower House Council</span>
          <div>
            <strong>${u.name} • ${u.house_name} House • ${u.region_name}</strong>
            <p class="text-muted">Propose local student meetups, invite fellow LHCs in ${u.region_name}, and claim verified reimbursements.</p>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window.app.openProposeModal()">
          + Propose Regional Meetup
        </button>
      `;
    }
  }

  // --- MEETUPS & HUB ---

  async loadMeetups() {
    try {
      let url = `/api/meetups?user_id=${this.currentUser ? this.currentUser.id : ''}`;
      if (this.statusFilter !== 'ALL') url += `&status=${this.statusFilter}`;
      if (this.regionFilter) url += `&region_id=${this.regionFilter}`;
      if (this.houseFilter) url += `&house_id=${this.houseFilter}`;

      const res = await fetch(url);
      const data = await res.json();
      this.meetups = data.meetups || [];

      this.updateCounts();
      this.renderMeetupLists();
      this.renderInvitations();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to load meetups', 'error');
    }
  }

  updateCounts() {
    const pending = this.meetups.filter(m => m.status === 'PENDING').length;
    const approved = this.meetups.filter(m => m.status === 'APPROVED').length;
    const completed = this.meetups.filter(m => m.status === 'COMPLETED').length;

    // Badges in sidebar
    const badgeMeetupPending = document.getElementById('badgeMeetupPending');
    if (badgeMeetupPending) {
      badgeMeetupPending.textContent = pending;
      badgeMeetupPending.style.display = pending > 0 ? 'inline-block' : 'none';
    }

    const badgeReimb = document.getElementById('badgeReimbCount');
    const mobileBadgeReimb = document.getElementById('mobileBadgeReimb');
    if (this.reimbursements) {
      const pendingClaims = this.reimbursements.filter(r => r.status === 'PENDING_REVIEW').length;
      if (badgeReimb) {
        badgeReimb.textContent = pendingClaims;
        badgeReimb.style.display = pendingClaims > 0 ? 'inline-block' : 'none';
      }
      if (mobileBadgeReimb) {
        mobileBadgeReimb.textContent = pendingClaims;
        if (pendingClaims > 0) {
          mobileBadgeReimb.classList.remove('hidden');
        } else {
          mobileBadgeReimb.classList.add('hidden');
        }
      }
    }

    // Invitations count for LHC
    let userInvitesCount = 0;
    if (this.currentUser) {
      userInvitesCount = this.meetups.filter(m => 
        m.invitations && m.invitations.some(i => i.invitee_id === this.currentUser.id && i.status === 'INVITED')
      ).length;
    }
    const badgeInv = document.getElementById('badgeInvitesCount');
    if (badgeInv) {
      badgeInv.textContent = userInvitesCount;
      badgeInv.style.display = userInvitesCount > 0 ? 'inline-block' : 'none';
    }

    // Dashboard banner stat chips
    const statPending = document.getElementById('statPendingCount');
    if (statPending) statPending.textContent = pending;

    const statApproved = document.getElementById('statApprovedCount');
    if (statApproved) statApproved.textContent = approved;

    const statCompleted = document.getElementById('statCompletedCount');
    if (statCompleted) statCompleted.textContent = completed;

    const statReimb = document.getElementById('statReimbCount');
    if (statReimb && this.reimbursements) {
      statReimb.textContent = this.reimbursements.filter(r => r.status === 'PENDING_REVIEW').length;
    }
  }

  renderMeetupLists() {
    // 1. Dashboard Grid (Top 4 recent)
    const dashGrid = document.getElementById('dashboardMeetupsGrid');
    if (dashGrid) {
      const recent = this.meetups.slice(0, 4);
      if (recent.length === 0) {
        dashGrid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; padding: 20px;">No meetup proposals found.</p>`;
      } else {
        dashGrid.innerHTML = recent.map(m => this.createMeetupCardHTML(m)).join('');
      }
    }

    // 2. Full Meetups Grid (Meetup Hub)
    const fullGrid = document.getElementById('meetupsListGrid');
    if (fullGrid) {
      if (this.meetups.length === 0) {
        fullGrid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; padding: 40px; text-align: center;">No meetups found matching this filter.</p>`;
      } else {
        fullGrid.innerHTML = this.meetups.map(m => this.createMeetupCardHTML(m)).join('');
      }
    }
  }

  createMeetupCardHTML(m) {
    const isOwner = this.currentUser && this.currentUser.id === m.proposer_id;
    const isMgmt = this.currentUser && this.currentUser.role === 'MANAGEMENT';
    const userInv = m.user_invitation;

    // Status label formatting
    let statusText = '⏳ Pending Review';
    if (m.status === 'APPROVED') statusText = '✅ Approved';
    else if (m.status === 'COMPLETED') statusText = '🏁 Completed';
    else if (m.status === 'REJECTED') statusText = '❌ Rejected';

    return `
      <div class="meetup-card">
        <div class="card-top-row">
          <span class="meetup-category-tag">${this.escapeHtml(m.category)}</span>
          <span class="status-badge ${m.status}">
            ${statusText}
          </span>
        </div>

        <div>
          <h4 class="card-meetup-title">${this.escapeHtml(m.title)}</h4>
          <p class="card-meetup-desc">${this.escapeHtml(m.description)}</p>
        </div>

        <div class="meetup-meta-list">
          <div class="meta-item">
            <span class="meta-icon">📅</span>
            <span><strong>Date:</strong> ${this.escapeHtml(m.proposed_date)} (${m.start_time} - ${m.end_time})</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">📍</span>
            <span><strong>Venue:</strong> ${this.escapeHtml(m.venue)} [${m.mode}]</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">👥</span>
            <span><strong>Turnout / Peers:</strong> ${m.expected_attendees} students | ${m.accepted_count} peer(s) accepted</span>
          </div>
        </div>

        ${m.management_remarks ? `
          <div style="background: rgba(224, 93, 45, 0.08); border-left: 3px solid var(--accent-primary); padding: 8px 12px; border-radius: 6px; font-size: 11px;">
            <strong>Management Remarks:</strong> ${this.escapeHtml(m.management_remarks)}
          </div>
        ` : ''}

        <div class="card-organizer-row">
          <div class="organizer-info">
            <img src="${m.proposer_avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Proposer'}" class="avatar-sm" style="width: 24px; height: 24px;">
            <span>${this.escapeHtml(m.proposer_name)}</span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span class="house-tag" style="background: ${m.house_color || '#800000'};">${this.escapeHtml(m.house_name)}</span>
            <span class="house-tag" style="background: #362F43;">${m.region_code || 'REG'}</span>
          </div>
        </div>

        <div class="card-action-bar">
          <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="window.app.openMeetupDetails(${m.id})">
            Details
          </button>

          ${isMgmt && m.status === 'PENDING' ? `
            <button class="btn btn-primary btn-sm" style="flex:1;" onclick="window.app.openManagementReview(${m.id})">
              Review Proposal
            </button>
          ` : ''}

          ${isMgmt && m.status === 'APPROVED' ? `
            <button class="btn btn-success btn-sm" style="flex:1;" onclick="window.app.markMeetupCompleted(${m.id})">
              Mark Completed 🏁
            </button>
          ` : ''}

          ${m.status === 'COMPLETED' ? `
            ${isMgmt ? `
              <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="window.app.switchView('reimbursements')">
                Reimbursements
              </button>
            ` : (isOwner ? `
              <button class="btn btn-primary btn-sm" style="flex:1;" onclick="window.app.openClaimReimbursementModal(${m.id}, '${this.escapeHtml(m.title)}')">
                Claim Reimbursement
              </button>
            ` : '')}
          ` : ''}

          ${userInv && userInv.status === 'INVITED' ? `
            <button class="btn btn-success btn-sm" onclick="window.app.respondInvite(${userInv.id}, 'ACCEPT')">Accept</button>
            <button class="btn btn-danger btn-sm" onclick="window.app.respondInvite(${userInv.id}, 'DECLINE')">Decline</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  setMeetupFilter(status) {
    this.statusFilter = status;
    document.querySelectorAll('#statusFilterPills .segmented-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === status);
    });
    this.loadMeetups();
  }

  async markMeetupCompleted(meetupId) {
    if (!confirm('Mark this approved meetup as Completed? This will enable the host to submit their attendance proof & reimbursement claim.')) return;
    try {
      const res = await fetch(`/api/meetups/${meetupId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: this.currentUser.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete meetup');

      this.showToast('Meetup marked as Completed 🏁', 'success');
      await this.loadMeetups();
      await this.loadOverallStats();
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  // --- OVERALL STATS SECTION ---

  async loadOverallStats() {
    try {
      const res = await fetch('/api/stats/overall');
      const data = await res.json();
      this.statsData = data;
      this.renderOverallStats();
    } catch (err) {
      console.error(err);
    }
  }

  renderOverallStats() {
    if (!this.statsData) return;
    const { by_house, by_region, reimbursement_summary } = this.statsData;

    // 1. KPI Top Cards
    const totalMeetups = by_house.reduce((acc, h) => acc + (h.total_meetups || 0), 0);
    const approvedMeetups = by_house.reduce((acc, h) => acc + (h.approved_meetups || 0), 0);
    const completedMeetups = by_house.reduce((acc, h) => acc + (h.completed_meetups || 0), 0);
    const totalAttendance = by_house.reduce((acc, h) => acc + (h.total_attendees || 0), 0);

    const kpiTotal = document.getElementById('statKpiTotal');
    if (kpiTotal) kpiTotal.textContent = totalMeetups;

    const kpiApproved = document.getElementById('statKpiApproved');
    if (kpiApproved) kpiApproved.textContent = approvedMeetups;

    const kpiCompleted = document.getElementById('statKpiCompleted');
    if (kpiCompleted) kpiCompleted.textContent = completedMeetups;

    const kpiAttendance = document.getElementById('statKpiAttendance');
    if (kpiAttendance) kpiAttendance.textContent = totalAttendance;

    const kpiReimb = document.getElementById('statKpiReimbTotal');
    if (kpiReimb && reimbursement_summary) {
      kpiReimb.textContent = `₹ ${reimbursement_summary.total_approved.toLocaleString('en-IN')}`;
    }

    // 2. Showcase: Official 12 Houses Grid (Matching Official Portal Screenshot with authentic circular emblems)
    const portalHousesGrid = document.getElementById('portalHousesGrid');
    if (portalHousesGrid) {
      portalHousesGrid.innerHTML = by_house.map(h => {
        const slug = h.name.toLowerCase().trim();
        return `
          <div class="portal-house-card" onclick="window.app.filterMeetupsByHouse(${h.id})" title="Click to view ${this.escapeHtml(h.name)} house meetups">
            <div class="portal-house-emblem-wrap">
              <img src="/static/img/houses/${slug}.png" alt="${this.escapeHtml(h.name)}" class="portal-house-img" onerror="this.onerror=null; this.src='/static/img/iitm_logo.png';">
            </div>
            <div class="portal-house-name">${this.escapeHtml(h.name)}</div>
          </div>
        `;
      }).join('');
    }

    // 3. Showcase: Official 10 Regions Grid (Matching Official Portal Screenshot)
    const portalRegionsGrid = document.getElementById('portalRegionsGrid');
    if (portalRegionsGrid) {
      portalRegionsGrid.innerHTML = by_region.map(r => {
        return `
          <div class="portal-region-card" onclick="window.app.filterMeetupsByRegion(${r.id})" title="Click to filter by ${this.escapeHtml(r.name)}">
            <span class="portal-region-pretitle">REGION</span>
            <div class="portal-region-title">${this.escapeHtml(r.name)}</div>
          </div>
        `;
      }).join('');
    }

    // 4. House Breakdown Table
    const houseBody = document.getElementById('statsHouseTableBody');
    if (houseBody) {
      const maxMeets = Math.max(...by_house.map(h => h.total_meetups), 1);
      houseBody.innerHTML = by_house.map(h => {
        const pct = Math.round((h.total_meetups / maxMeets) * 100);
        return `
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="directory-badge" style="background:${h.color};"></span>
                <strong>${this.escapeHtml(h.name)}</strong>
                <span class="text-muted" style="font-size:11px;">(House ${h.id})</span>
              </div>
            </td>
            <td><strong>${h.total_meetups}</strong></td>
            <td><span class="status-badge PENDING" style="font-size:10px;">${h.pending_meetups}</span></td>
            <td><span class="status-badge APPROVED" style="font-size:10px;">${h.approved_meetups}</span></td>
            <td><span class="status-badge COMPLETED" style="font-size:10px;">${h.completed_meetups}</span></td>
            <td>${h.total_attendees} students</td>
            <td>
              <div class="activity-bar-wrapper">
                <div class="activity-bar">
                  <div class="activity-bar-fill" style="width: ${pct}%; background:${h.color};"></div>
                </div>
                <span class="text-muted" style="font-size:11px; width:30px;">${pct}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // 5. Region Breakdown Table
    const regionBody = document.getElementById('statsRegionTableBody');
    if (regionBody) {
      regionBody.innerHTML = by_region.map(r => `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="house-tag" style="background:#362F43;">${r.short_code}</span>
              <strong>${this.escapeHtml(r.name)}</strong>
            </div>
          </td>
          <td class="text-muted" style="max-width:240px; font-size:11px;">${this.escapeHtml(r.states)}</td>
          <td><strong>${r.total_meetups}</strong></td>
          <td><span class="status-badge APPROVED" style="font-size:10px;">${r.approved_meetups}</span></td>
          <td><span class="status-badge COMPLETED" style="font-size:10px;">${r.completed_meetups}</span></td>
          <td>${r.total_attendees} students</td>
          <td>
            <span class="status-badge ${r.total_meetups > 0 ? 'APPROVED' : 'PENDING'}" style="font-size:10px;">
              ${r.total_meetups > 0 ? 'Active Cohort' : 'Awaiting Meets'}
            </span>
          </td>
        </tr>
      `).join('');
    }
  }

  getHouseEmblemSvg(name, color) {
    const cleanName = (name || '').toLowerCase();
    switch (cleanName) {
      case 'bandipur':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#14213d" stroke="${color}" stroke-width="3"/>
          <path d="M50 20 C65 20 78 32 78 48 C78 68 50 82 50 82 C50 82 22 68 22 48 C22 32 35 20 50 20 Z" fill="#2B6CB0" opacity="0.8"/>
          <circle cx="50" cy="45" r="14" fill="#68D391"/>
          <path d="M44 48 C44 40 56 40 56 48 C56 56 44 56 44 48 Z" fill="#FFFFFF"/>
        </svg>`;
      case 'corbett':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#1A1813" stroke="#D69E2E" stroke-width="3"/>
          <path d="M50 22 L58 36 L74 38 L62 49 L66 65 L50 56 L34 65 L38 49 L26 38 L42 36 Z" fill="#ECC94B"/>
          <circle cx="50" cy="50" r="12" fill="#744210"/>
          <path d="M46 48 L50 44 L54 48 L50 54 Z" fill="#F6E05E"/>
        </svg>`;
      case 'gir':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#0F2419" stroke="#38A169" stroke-width="3"/>
          <circle cx="50" cy="50" r="32" stroke="#48BB78" stroke-dasharray="4 3" stroke-width="2"/>
          <path d="M50 28 C60 28 68 36 68 46 C68 58 50 72 50 72 C50 72 32 58 32 46 C32 36 40 28 50 28 Z" fill="#2E8540"/>
          <circle cx="50" cy="46" r="8" fill="#F6E05E"/>
        </svg>`;
      case 'kanha':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#F7FAFC" stroke="#C05621" stroke-width="3"/>
          <circle cx="50" cy="50" r="36" stroke="#DD6B20" stroke-width="2"/>
          <path d="M38 42 C38 35 62 35 62 42 C62 58 50 68 50 68 C50 68 38 58 38 42 Z" fill="#C05621"/>
          <circle cx="50" cy="44" r="6" fill="#FFFAF0"/>
        </svg>`;
      case 'kaziranga':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#1C4532" stroke="#48BB78" stroke-width="3"/>
          <circle cx="50" cy="50" r="34" fill="#E53E3E"/>
          <path d="M42 32 L58 50 L42 68 L50 50 Z" fill="#FFFFFF"/>
          <circle cx="50" cy="50" r="8" fill="#F6E05E"/>
        </svg>`;
      case 'nallamala':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#1A1813" stroke="#B7791F" stroke-width="3"/>
          <path d="M34 30 L66 30 L60 62 L50 74 L40 62 Z" fill="#D69E2E" stroke="#744210" stroke-width="2"/>
          <line x1="50" y1="36" x2="50" y2="64" stroke="#1A1813" stroke-width="3"/>
          <line x1="42" y1="44" x2="58" y2="44" stroke="#1A1813" stroke-width="3"/>
        </svg>`;
      case 'namdapha':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#171923" stroke="#718096" stroke-width="3"/>
          <path d="M26 54 C34 40 46 36 50 48 C54 36 66 40 74 54 C66 50 58 58 50 66 C42 58 34 50 26 54 Z" fill="#FFFFFF"/>
        </svg>`;
      case 'nilgiri':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#2D1A4A" stroke="#9F7AEA" stroke-width="3"/>
          <circle cx="50" cy="50" r="36" stroke="#D6BCFA" stroke-dasharray="3 3" stroke-width="2"/>
          <path d="M32 60 L50 32 L68 60 Z" fill="#805AD5"/>
          <path d="M44 60 L50 48 L56 60 Z" fill="#F6E05E"/>
        </svg>`;
      case 'pichavaram':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#132826" stroke="#319795" stroke-width="3"/>
          <circle cx="50" cy="40" r="16" fill="#38B2AC"/>
          <path d="M47 54 L47 72 M53 54 L53 72 M42 72 Q50 64 58 72" stroke="#ED8936" stroke-width="4" stroke-linecap="round"/>
        </svg>`;
      case 'saranda':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#1F1914" stroke="#DD6B20" stroke-width="3"/>
          <path d="M50 24 L56 38 L72 34 L62 48 L76 58 L58 58 L50 74 L42 58 L24 58 L38 48 L28 34 L44 38 Z" fill="#ECC94B"/>
          <circle cx="50" cy="46" r="6" fill="#DD6B20"/>
        </svg>`;
      case 'sundarbans':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#20150F" stroke="#EA580C" stroke-width="3"/>
          <circle cx="50" cy="50" r="36" stroke="#FBD38D" stroke-dasharray="2 2" stroke-width="1.5"/>
          <path d="M50 26 C62 26 70 36 70 48 C70 62 50 74 50 74 C50 74 30 62 30 48 C30 36 38 26 50 26 Z" fill="#DD6B20"/>
          <path d="M42 42 L58 42 M46 48 L54 48 M44 54 L56 54" stroke="#1A1813" stroke-width="2.5" stroke-linecap="round"/>
        </svg>`;
      case 'wayanad':
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="#132738" stroke="#3182CE" stroke-width="3"/>
          <path d="M36 34 Q50 24 64 34 Q58 50 50 68 Q42 50 36 34 Z" fill="#00B4D8"/>
          <circle cx="50" cy="42" r="8" fill="#F6E05E"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" fill="${color}" opacity="0.2"/>
          <circle cx="50" cy="50" r="40" stroke="${color}" stroke-width="3"/>
          <text x="50" y="58" text-anchor="middle" fill="#FFFFFF" font-size="24" font-weight="800">${(name || '').substring(0, 2).toUpperCase()}</text>
        </svg>`;
    }
  }

  filterMeetupsByHouse(houseId) {
    this.switchView('meetups');
    const select = document.getElementById('houseFilterSelect');
    if (select) {
      select.value = String(houseId);
      this.houseFilter = String(houseId);
      this.loadMeetups();
    }
  }

  filterMeetupsByRegion(regionId) {
    this.switchView('meetups');
    const select = document.getElementById('regionFilterSelect');
    if (select) {
      select.value = String(regionId);
      this.regionFilter = String(regionId);
      this.loadMeetups();
    }
  }

  // --- REIMBURSEMENTS SECTION ---

  async loadReimbursements() {
    try {
      let url = '/api/reimbursements';
      if (this.reimbFilter !== 'ALL') url += `?status=${this.reimbFilter}`;

      const res = await fetch(url);
      const data = await res.json();
      this.reimbursements = data.reimbursements || [];

      this.updateCounts();
      this.renderReimbursementsList();
    } catch (err) {
      console.error(err);
    }
  }

  renderReimbursementsList() {
    const container = document.getElementById('reimbursementsListContainer');
    if (!container) return;

    if (this.reimbursements.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <h3>No Reimbursement Claims Found</h3>
          <p class="text-muted mt-2">There are currently no reimbursement requests under status: ${this.reimbFilter}.</p>
        </div>
      `;
      return;
    }

    const isMgmt = this.currentUser && this.currentUser.role === 'MANAGEMENT';

    container.innerHTML = this.reimbursements.map(r => {
      let statusClass = 'PENDING_REVIEW';
      let statusLabel = '⏳ Pending Review';
      if (r.status === 'IN_PROGRESS') {
        statusClass = 'IN_PROGRESS';
        statusLabel = '🔄 In Progress (Accounts)';
      } else if (r.status === 'APPROVED') {
        statusClass = 'APPROVED';
        statusLabel = '✅ Approved & Disbursed';
      } else if (r.status === 'REJECTED') {
        statusClass = 'REJECTED';
        statusLabel = '❌ Rejected';
      }

      return `
        <div class="reimbursement-card">
          <div class="reimb-header">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom: 6px;">
                <span class="status-badge ${statusClass}">${statusLabel}</span>
                <span class="house-tag" style="background:${r.house_color};">${r.house_name}</span>
                <span class="house-tag" style="background:#362F43;">${r.region_code}</span>
              </div>
              <h3 style="font-size: 17px; font-weight:700;">${this.escapeHtml(r.meetup_title)}</h3>
              <p class="text-muted" style="margin-top: 2px;">
                Conducted on <strong>${r.proposed_date}</strong> at ${this.escapeHtml(r.venue)}
              </p>
              <p class="text-muted" style="font-size:12px; margin-top:2px;">
                Claimant: <strong>${this.escapeHtml(r.claimant_name)}</strong> (${r.claimant_roll})
              </p>
            </div>

            <div class="reimb-amount-badge">
              <span class="reimb-amount-val">₹ ${r.amount_claimed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              ${r.amount_approved ? `
                <span class="reimb-amount-approved">Approved: ₹ ${r.amount_approved.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              ` : '<span class="reimb-amount-approved text-muted">Claimed Amount</span>'}
            </div>
          </div>

          <div class="reimb-details-box">
            <div class="reimb-proof-block">
              <span class="reimb-proof-title">Verified Attendance</span>
              <span class="reimb-proof-content">
                <strong>${r.actual_attendance} Students Attended</strong>
                <p class="text-muted" style="font-size:11px; margin-top:2px;">${this.escapeHtml(r.attendance_proof_notes || 'Attendance roll sheet attached')}</p>
              </span>
            </div>

            <div class="reimb-proof-block">
              <span class="reimb-proof-title">Itemized Bills Breakdown</span>
              <span class="reimb-proof-content">${this.escapeHtml(r.bills_description || 'Refreshments & Materials')}</span>
            </div>

            <div class="reimb-proof-block">
              <span class="reimb-proof-title">Bill / Voucher Receipts</span>
              <div style="margin-top:4px;">
                <span class="receipt-chip">
                  📄 ${this.escapeHtml(r.receipts_file_name || 'Receipts_attached.pdf')}
                </span>
              </div>
            </div>

            <div class="reimb-proof-block">
              <span class="reimb-proof-title">Disbursement Destination (Bank/UPI)</span>
              <span class="reimb-proof-content font-mono" style="font-size:12px;">${this.escapeHtml(r.bank_or_upi_details || 'Pending Details')}</span>
            </div>
          </div>

          ${r.management_notes ? `
            <div style="background: rgba(224, 93, 45, 0.08); border-left: 3px solid var(--accent-primary); padding: 10px 14px; border-radius: 6px; font-size: 12px;">
              <strong>Management Payout Remarks:</strong> ${this.escapeHtml(r.management_notes)}
              <span class="text-muted" style="font-size:10px; display:block; margin-top:2px;">Reviewed by: ${r.reviewer_name || 'Management'} on ${r.reviewed_at || ''}</span>
            </div>
          ` : ''}

          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
            ${isMgmt && r.status !== 'APPROVED' ? `
              <button class="btn btn-primary btn-sm" onclick="window.app.openReimbursementReview(${r.id})">
                Review & Process Claim
              </button>
            ` : `
              <span class="text-muted" style="font-size:11px; align-self:center;">Audit Record ID #${r.id}</span>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  openReimbursementReview(claimId) {
    const claim = this.reimbursements.find(r => r.id === claimId);
    if (!claim) return;

    const modal = document.getElementById('modalReimbursementReview');
    const body = document.getElementById('reimbReviewBody');

    body.innerHTML = `
      <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: 8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="font-size: 16px; font-weight:700;">${this.escapeHtml(claim.meetup_title)}</h3>
          <span class="status-badge ${claim.status}">${claim.status}</span>
        </div>
        <p class="text-muted mt-1">Host: <strong>${this.escapeHtml(claim.claimant_name)}</strong> (${claim.claimant_roll}) • ${claim.house_name} House • ${claim.region_name}</p>
        <p class="text-muted font-mono" style="font-size:11px;">Bank/UPI: ${this.escapeHtml(claim.bank_or_upi_details)}</p>
      </div>

      <div class="mt-2" style="background:#171321; border:1px solid var(--border-medium); border-radius:8px; padding:14px; font-size:13px;">
        <div><strong>Claimed Amount:</strong> <span style="color:#34D399; font-weight:800; font-size:15px;">₹ ${claim.amount_claimed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
        <div class="mt-1"><strong>Verified Attendance:</strong> ${claim.actual_attendance} students (${this.escapeHtml(claim.attendance_proof_notes)})</div>
        <div class="mt-1"><strong>Bills Itemization:</strong> ${this.escapeHtml(claim.bills_description)}</div>
        <div class="mt-1"><strong>Attached Receipts:</strong> <span class="receipt-chip">📄 ${this.escapeHtml(claim.receipts_file_name)}</span></div>
      </div>

      <div class="form-grid mt-2">
        <div class="form-group">
          <label class="form-label">Approved Disbursement Amount (₹) *</label>
          <input type="number" id="mgmtReimbAmount" class="form-input" value="${claim.amount_claimed}" step="0.01">
        </div>
        <div class="form-group">
          <label class="form-label">Finance / Payout Ref (Optional)</label>
          <input type="text" id="mgmtReimbRef" class="form-input" placeholder="e.g. TXN-9941 / Accounts Batch 4">
        </div>
        <div class="form-group full-width">
          <label class="form-label">Management Audit Notes / Guidelines *</label>
          <textarea id="mgmtReimbNotes" class="form-textarea" rows="2" placeholder="e.g. Bills and attendance verified against institute policy. Approved for bank payout."></textarea>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button class="btn btn-danger btn-sm" onclick="window.app.executeReimbursementReview(${claim.id}, 'REJECT')">
          ✕ Reject Claim
        </button>
        <button class="btn btn-secondary btn-sm" onclick="window.app.executeReimbursementReview(${claim.id}, 'IN_PROGRESS')">
          ⏳ Mark In-Progress
        </button>
        <button class="btn btn-success btn-sm" onclick="window.app.executeReimbursementReview(${claim.id}, 'APPROVE')">
          ✓ Approve & Authorize Payout
        </button>
      </div>
    `;

    modal.classList.remove('hidden');
  }

  async executeReimbursementReview(claimId, action) {
    const amountApproved = parseFloat(document.getElementById('mgmtReimbAmount').value) || 0;
    const notes = document.getElementById('mgmtReimbNotes').value.trim();

    if (action === 'REJECT' && !notes) {
      this.showToast('Please provide rejection remarks to guide the student host.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/reimbursements/${claimId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewer_id: this.currentUser.id,
          action: action,
          amount_approved: amountApproved,
          management_notes: notes
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to review claim');

      this.closeModal('modalReimbursementReview');
      this.showToast(`Reimbursement claim marked as ${action}`, 'success');
      await this.loadReimbursements();
      await this.loadOverallStats();
      await this.loadNotifications();
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  openClaimReimbursementModal(meetupId, meetupTitle) {
    document.getElementById('claimMeetupId').value = meetupId;
    document.getElementById('claimMeetupTitle').value = meetupTitle;
    document.getElementById('modalClaimReimbursement').classList.remove('hidden');
  }

  async submitReimbursementClaim(e) {
    e.preventDefault();
    if (!this.currentUser) return;

    const payload = {
      meetup_id: parseInt(document.getElementById('claimMeetupId').value),
      claimant_id: this.currentUser.id,
      amount_claimed: parseFloat(document.getElementById('claimAmount').value),
      actual_attendance: parseInt(document.getElementById('claimAttendance').value),
      attendance_proof_notes: document.getElementById('claimAttendanceNotes').value.trim(),
      bills_description: document.getElementById('claimBillsDescription').value.trim(),
      receipts_file_name: document.getElementById('claimReceiptsFileName').value.trim(),
      bank_or_upi_details: document.getElementById('claimBankDetails').value.trim()
    };

    try {
      const res = await fetch('/api/reimbursements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit claim');

      this.closeModal('modalClaimReimbursement');
      document.getElementById('formClaimReimbursement').reset();
      this.showToast('Reimbursement claim submitted to Management!', 'success');
      await this.loadReimbursements();
      await this.loadOverallStats();
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  // --- PEER INVITATIONS (FOR LHC ROLE) ---

  renderInvitations() {
    const container = document.getElementById('invitationsContainer');
    if (!container) return;

    if (!this.currentUser || this.currentUser.role !== 'LHC') {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <h3>Regional Peer Invitations</h3>
          <p class="text-muted mt-2">Only LHC members receive regional meetup invitations. Switch to a test LHC peer (e.g., Sneha Roy) to test responding.</p>
          <button class="btn btn-primary btn-sm mt-3" onclick="window.app.switchUser('lhc-2-5')">Switch to Regional Peer (Sneha Roy)</button>
        </div>
      `;
      return;
    }

    const myInvites = [];
    this.meetups.forEach(m => {
      if (m.invitations) {
        const inv = m.invitations.find(i => i.invitee_id === this.currentUser.id);
        if (inv) {
          myInvites.push({ meetup: m, invitation: inv });
        }
      }
    });

    if (myInvites.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <h3>No Pending Invitations</h3>
          <p class="text-muted mt-2">You currently have no invitations from fellow LHC members in ${this.currentUser.region_name}.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = myInvites.map(({ meetup, invitation }) => `
      <div class="invite-card">
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom: 6px;">
            <span class="status-badge ${meetup.status}">${meetup.status}</span>
            <span class="house-tag" style="background:${meetup.house_color};">${meetup.house_name}</span>
            <span class="text-muted" style="font-size:11px;">Proposed by ${this.escapeHtml(meetup.proposer_name)}</span>
          </div>
          <h3 style="font-size: 16px; font-weight:700;">${this.escapeHtml(meetup.title)}</h3>
          <p class="text-muted mt-1">${this.escapeHtml(meetup.venue)} • ${meetup.proposed_date} (${meetup.start_time} - ${meetup.end_time})</p>
          <div class="mt-2" style="font-size:12px;">
            <strong>Your Status:</strong> 
            <span style="color: ${invitation.status === 'ACCEPTED' ? 'var(--status-approved)' : (invitation.status === 'DECLINED' ? 'var(--status-rejected)' : 'var(--status-pending)')}; font-weight:700;">
              ${invitation.status}
            </span>
          </div>
        </div>

        <div class="invite-actions">
          ${invitation.status === 'INVITED' ? `
            <button class="btn btn-success btn-sm" onclick="window.app.respondInvite(${invitation.id}, 'ACCEPT')">
              ✓ Accept Invitation
            </button>
            <button class="btn btn-danger btn-sm" onclick="window.app.respondInvite(${invitation.id}, 'DECLINE')">
              ✕ Decline
            </button>
          ` : `
            <button class="btn btn-secondary btn-sm" onclick="window.app.openMeetupDetails(${meetup.id})">
              View Meetup Details
            </button>
          `}
        </div>
      </div>
    `).join('');
  }

  async respondInvite(invitationId, action) {
    if (!this.currentUser) return;
    try {
      const res = await fetch(`/api/invitations/${invitationId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: this.currentUser.id,
          action: action,
          note: action === 'ACCEPT' ? 'Confirmed participation' : 'Unable to attend'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update response');

      this.showToast(`Invitation marked as ${action}ED`, 'success');
      await this.loadMeetups();
      await this.loadNotifications();
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  // --- PROPOSAL WIZARD ---

  async openProposeModal() {
    if (!this.currentUser) return;
    if (this.currentUser.role !== 'LHC') {
      this.showToast('Switching to LHC Host profile (Rahul Verma) to create proposal...', 'info');
      await this.switchUser('lhc-11-5');
    }

    const modal = document.getElementById('modalProposeMeetup');
    const notice = document.getElementById('peerRegionNotice');
    const peerList = document.getElementById('peerCheckboxList');

    notice.innerHTML = `Showing fellow LHC members from your assigned <strong>${this.currentUser.region_name}</strong>:`;
    peerList.innerHTML = `<p class="text-muted" style="padding:10px;">Loading regional peers...</p>`;

    modal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/users?role=LHC&region_id=${this.currentUser.region_id}&exclude_id=${this.currentUser.id}`);
      const data = await res.json();
      const peers = data.users || [];

      if (peers.length === 0) {
        peerList.innerHTML = `<p class="text-muted" style="padding:10px;">No other LHC members found in your region.</p>`;
      } else {
        peerList.innerHTML = peers.map(p => `
          <label class="peer-checkbox-item">
            <input type="checkbox" name="peer_invitee" value="${p.id}" class="peer-check-input" onchange="window.app.updatePeerSelectionCount()">
            <div class="peer-info">
              <span class="peer-name">${this.escapeHtml(p.name)} (${p.roll_number})</span>
              <span class="peer-house-badge" style="background: ${p.house_color || '#362F43'}; color:#FFF;">${this.escapeHtml(p.house_name)}</span>
            </div>
          </label>
        `).join('');
      }
      this.updatePeerSelectionCount();
    } catch (err) {
      peerList.innerHTML = `<p class="text-muted" style="color:red;">Error loading peers.</p>`;
    }
  }

  updatePeerSelectionCount() {
    const selected = document.querySelectorAll('input[name="peer_invitee"]:checked').length;
    const status = document.getElementById('peerSelectedCount');
    if (status) {
      status.textContent = `${selected} peer LHC(s) selected to invite`;
    }
  }

  selectAllPeers() {
    const checks = document.querySelectorAll('input[name="peer_invitee"]');
    const allChecked = Array.from(checks).every(c => c.checked);
    checks.forEach(c => c.checked = !allChecked);
    this.updatePeerSelectionCount();
  }

  async submitMeetupProposal(e) {
    e.preventDefault();
    if (!this.currentUser) return;

    const selectedInvitees = Array.from(document.querySelectorAll('input[name="peer_invitee"]:checked')).map(c => c.value);

    const payload = {
      proposer_id: this.currentUser.id,
      title: document.getElementById('propTitle').value.trim(),
      category: document.getElementById('propCategory').value,
      mode: document.getElementById('propMode').value,
      proposed_date: document.getElementById('propDate').value,
      start_time: document.getElementById('propStartTime').value.trim(),
      end_time: document.getElementById('propEndTime').value.trim(),
      venue: document.getElementById('propVenue').value.trim(),
      expected_attendees: parseInt(document.getElementById('propAttendees').value) || 20,
      estimated_budget: document.getElementById('propBudget').value.trim() || '₹ 0',
      description: document.getElementById('propDescription').value.trim(),
      invitee_ids: selectedInvitees
    };

    try {
      const btn = document.getElementById('btnSubmitProposal');
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      const res = await fetch('/api/meetups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      btn.disabled = false;
      btn.textContent = 'Submit Proposal to Management';

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit proposal');
      }

      this.closeModal('modalProposeMeetup');
      document.getElementById('formProposeMeetup').reset();
      this.showToast('Meetup proposal submitted to Management!', 'success');
      await this.loadMeetups();
      await this.loadOverallStats();
      await this.loadNotifications();
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  // --- MANAGEMENT MEETUP REVIEW ---

  openManagementReview(meetupId) {
    const meetup = this.meetups.find(m => m.id === meetupId);
    if (!meetup) return;

    if (this.currentUser.role !== 'MANAGEMENT') {
      this.showToast('Switching to Management reviewer mode (Dr. Andrew)...', 'info');
      this.switchUser('mgmt-1', false);
    }

    const modal = document.getElementById('modalManagementReview');
    const body = document.getElementById('mgmtReviewBody');

    body.innerHTML = `
      <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: 8px;">
        <h3 style="font-size: 17px; font-weight:700;">${this.escapeHtml(meetup.title)}</h3>
        <p class="text-muted mt-1">${this.escapeHtml(meetup.category)} • Proposed by ${this.escapeHtml(meetup.proposer_name)} (${meetup.proposer_roll})</p>
        <p class="text-muted"><strong>House:</strong> ${meetup.house_name} | <strong>Region:</strong> ${meetup.region_name}</p>
      </div>

      <div class="mt-2">
        <label class="form-label">Meetup Description & Objectives:</label>
        <p style="font-size: 13px; color: var(--text-secondary); line-height:1.5;">${this.escapeHtml(meetup.description)}</p>
      </div>

      <div class="meetup-meta-list mt-2">
        <div><strong>Date & Time:</strong> ${meetup.proposed_date} (${meetup.start_time} - ${meetup.end_time})</div>
        <div><strong>Venue & Mode:</strong> ${this.escapeHtml(meetup.venue)} [${meetup.mode}]</div>
        <div><strong>Budget Claimed:</strong> ${this.escapeHtml(meetup.estimated_budget || 'None')}</div>
        <div><strong>Regional Peer Invites:</strong> ${meetup.accepted_count} Accepted / ${meetup.total_invites} Invited</div>
      </div>

      <div class="form-group full-width mt-3">
        <label class="form-label">Management Decision Remarks / Feedback *</label>
        <textarea id="mgmtRemarksInput" class="form-textarea" rows="3" placeholder="Enter review remarks (Mandatory on rejection to guide coordinator; optional guidelines on approval)..."></textarea>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 16px; justify-content: flex-end;">
        <button class="btn btn-danger" onclick="window.app.executeReview(${meetup.id}, 'REJECT')">
          ✕ Reject Proposal
        </button>
        <button class="btn btn-success" onclick="window.app.executeReview(${meetup.id}, 'APPROVE')">
          ✓ Approve Proposal
        </button>
      </div>
    `;

    modal.classList.remove('hidden');
  }

  async executeReview(meetupId, action) {
    const remarks = document.getElementById('mgmtRemarksInput').value.trim();
    if (action === 'REJECT' && !remarks) {
      this.showToast('Please provide remarks explaining the rejection reason.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/meetups/${meetupId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewer_id: this.currentUser.id,
          action: action,
          remarks: remarks
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to review');

      this.closeModal('modalManagementReview');
      this.showToast(`Meetup marked as ${action}ED`, 'success');
      await this.loadMeetups();
      await this.loadOverallStats();
      await this.loadNotifications();
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  openMeetupDetails(meetupId) {
    const m = this.meetups.find(m => m.id === meetupId);
    if (!m) return;

    const modal = document.getElementById('modalMeetupDetails');
    const badge = document.getElementById('modalDetailStatusBadge');
    badge.textContent = m.status;
    badge.className = `badge status-badge ${m.status}`;

    document.getElementById('modalDetailTitle').textContent = m.title;

    const body = document.getElementById('modalDetailBody');
    body.innerHTML = `
      <div style="font-size: 13px; line-height: 1.6; color: var(--text-secondary);">
        ${this.escapeHtml(m.description)}
      </div>

      <div class="meetup-meta-list mt-2">
        <div><strong>Proposed By:</strong> ${this.escapeHtml(m.proposer_name)} (${m.proposer_roll})</div>
        <div><strong>House:</strong> ${m.house_name} | <strong>Region:</strong> ${m.region_name}</div>
        <div><strong>Date & Time:</strong> ${m.proposed_date} (${m.start_time} - ${m.end_time})</div>
        <div><strong>Venue:</strong> ${this.escapeHtml(m.venue)} (${m.mode})</div>
        <div><strong>Target Capacity:</strong> ${m.expected_attendees} students</div>
        <div><strong>Estimated Budget:</strong> ${this.escapeHtml(m.estimated_budget || '₹ 0')}</div>
      </div>

      ${m.management_remarks ? `
        <div style="background: rgba(224, 93, 45, 0.1); border-left: 3px solid var(--accent-primary); padding: 12px; border-radius: 6px; font-size: 13px;">
          <strong>Management Review Decision:</strong> ${this.escapeHtml(m.management_remarks)}
          <div style="font-size:11px; color: var(--text-muted); margin-top: 4px;">Reviewed by: ${m.reviewer_name || 'Management'} on ${m.reviewed_at || ''}</div>
        </div>
      ` : ''}

      <div class="mt-3">
        <h4 style="font-size: 14px; font-weight:700; margin-bottom: 8px;">Regional LHC Co-hosts (${m.total_invites})</h4>
        ${m.invitations && m.invitations.length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${m.invitations.map(i => `
              <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-surface-elevated); padding:8px 12px; border-radius:6px; font-size:12px;">
                <span>${this.escapeHtml(i.invitee_name)} (${i.invitee_roll}) • <span class="house-tag" style="background:${i.invitee_house_color};">${i.invitee_house_name}</span></span>
                <span class="status-badge ${i.status}">${i.status}</span>
              </div>
            `).join('')}
          </div>
        ` : `<p class="text-muted">No regional peers were invited for this session.</p>`}
      </div>
    `;

    modal.classList.remove('hidden');
  }

  // --- NOTIFICATIONS ---

  async loadNotifications() {
    if (!this.currentUser) return;
    try {
      const res = await fetch(`/api/notifications?user_id=${this.currentUser.id}`);
      const data = await res.json();
      this.notifications = data.notifications || [];

      const unreadCount = this.notifications.filter(n => !n.is_read).length;
      const notifBadge = document.getElementById('notifUnreadBadge');
      if (notifBadge) {
        notifBadge.textContent = unreadCount;
        notifBadge.style.display = unreadCount > 0 ? 'flex' : 'none';
      }

      const mobileNotifDot = document.getElementById('mobileNotifDot');
      if (mobileNotifDot) {
        mobileNotifDot.textContent = unreadCount;
        if (unreadCount > 0) {
          mobileNotifDot.classList.remove('hidden');
          mobileNotifDot.style.display = 'flex';
        } else {
          mobileNotifDot.classList.add('hidden');
          mobileNotifDot.style.display = 'none';
        }
      }

      this.renderNotificationsList();
    } catch (err) {
      console.error(err);
    }
  }

  renderNotificationsList() {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (this.notifications.length === 0) {
      list.innerHTML = `<p class="text-muted" style="text-align:center; padding: 20px;">No notifications yet.</p>`;
      return;
    }

    list.innerHTML = this.notifications.map(n => `
      <div class="notif-item ${n.is_read ? 'read' : ''}">
        <span class="notif-title">${this.escapeHtml(n.title)}</span>
        <span class="notif-msg">${this.escapeHtml(n.message)}</span>
        <span class="notif-time">${n.created_at ? n.created_at.split(' ')[0] : 'Just now'}</span>
      </div>
    `).join('');
  }

  async markNotificationsRead() {
    if (!this.currentUser) return;
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: this.currentUser.id })
      });
      await this.loadNotifications();
      this.showToast('Notifications marked as read', 'info');
    } catch (err) {
      console.error(err);
    }
  }

  // --- SEED RESET ---

  async resetSeedData() {
    if (!confirm('Reset database to clean default seed state? All 120 LHCs, 36 UHCs, 12 Houses, 10 Regions, and sample meetups will be refreshed.')) return;
    try {
      const res = await fetch('/api/reset-demo', { method: 'POST' });
      const data = await res.json();
      this.showToast(data.message, 'success');
      await this.loadBootstrap();
      await this.loadMeetups();
      await this.loadReimbursements();
      await this.loadOverallStats();
      await this.loadNotifications();
    } catch (err) {
      this.showToast('Failed to reset database', 'error');
    }
  }

  // --- UI & NAVIGATION HELPERS ---

  populateFilterDropdowns() {
    const regionSelect = document.getElementById('regionFilterSelect');
    if (regionSelect) {
      regionSelect.innerHTML = `<option value="">All 10 Regions</option>` + 
        this.regions.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    }

    const houseSelect = document.getElementById('houseFilterSelect');
    if (houseSelect) {
      houseSelect.innerHTML = `<option value="">All 12 Houses</option>` + 
        this.houses.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    }
  }

  renderQuickAuthList() {
    const list = document.getElementById('quickUserSwitchList');
    if (!list) return;

    list.innerHTML = this.demoUsers.map(u => `
      <button class="user-switch-btn" onclick="window.app.switchUser('${u.id}'); window.app.closeModal('modalAuth');">
        <img src="${u.avatar_url}" class="avatar-sm">
        <div>
          <div style="font-weight: 700; font-size: 13px;">${this.escapeHtml(u.name)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${u.role} • ${u.house_name || 'Central'} ${u.region_name ? '• ' + u.region_name.split(' - ')[0] : ''}</div>
        </div>
      </button>
    `).join('');
  }

  switchView(viewName) {
    this.activeView = viewName;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    
    const targetSection = document.getElementById(`view${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`);
    if (targetSection) targetSection.classList.add('active');

    // Update active nav link (desktop)
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.view === viewName);
    });

    // Update active nav item (mobile bottom nav)
    document.querySelectorAll('.mobile-nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Auto-close mobile sidebar drawer & backdrop if open
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.add('hidden');

    // Update breadcrumb
    const crumb = document.getElementById('currentViewCrumb');
    if (crumb) {
      let displayName = viewName.charAt(0).toUpperCase() + viewName.slice(1);
      if (viewName === 'stats') displayName = 'Overall Stats';
      if (viewName === 'reimbursements') displayName = 'Reimbursements';
      crumb.textContent = displayName;
    }

    if (viewName === 'stats') this.loadOverallStats();
    if (viewName === 'reimbursements') this.loadReimbursements();
  }

  renderActiveView() {
    this.switchView(this.activeView);
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return m;
      }
    });
  }

  bindEvents() {
    // Mobile Drawer Open / Close
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const sidebar = document.getElementById('sidebar');

    if (mobileMenuBtn && sidebar && sidebarBackdrop) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        sidebarBackdrop.classList.remove('hidden');
      });
    }

    if (sidebarCloseBtn && sidebar && sidebarBackdrop) {
      sidebarCloseBtn.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        sidebarBackdrop.classList.add('hidden');
      });
    }

    if (sidebarBackdrop && sidebar) {
      sidebarBackdrop.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        sidebarBackdrop.classList.add('hidden');
      });
    }

    // Mobile Topbar Propose Button
    const mobileProposeBtn = document.getElementById('mobileProposeBtn');
    if (mobileProposeBtn) {
      mobileProposeBtn.addEventListener('click', () => this.openProposeModal());
    }

    // Mobile Role Switcher triggers
    const mobileRoleModalBtn = document.getElementById('mobileRoleModalBtn');
    if (mobileRoleModalBtn) {
      mobileRoleModalBtn.addEventListener('click', () => this.openModal('modalRoleSwitch'));
    }

    const mobileBottomRoleBtn = document.getElementById('mobileBottomRoleBtn');
    if (mobileBottomRoleBtn) {
      mobileBottomRoleBtn.addEventListener('click', () => this.openModal('modalRoleSwitch'));
    }

    // Mobile Bottom Nav items
    document.querySelectorAll('.mobile-nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchView(btn.dataset.view);
      });
    });

    // Navigation items
    document.querySelectorAll('.nav-link').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view) this.switchView(btn.dataset.view);
      });
    });

    // Sidebar collapse toggle
    const sidebarToggle = document.getElementById('sidebarToggleBtn');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
      });
    }

    // Role switcher shortcut buttons in topbar
    document.querySelectorAll('.role-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchUser(btn.dataset.userId);
      });
    });

    // Propose Meetup button
    const btnPropose = document.getElementById('btnOpenProposeModal');
    if (btnPropose) {
      btnPropose.addEventListener('click', () => this.openProposeModal());
    }

    // Propose Form Submit
    const formPropose = document.getElementById('formProposeMeetup');
    if (formPropose) {
      formPropose.addEventListener('submit', (e) => this.submitMeetupProposal(e));
    }

    // Peer Select All button
    const btnSelectAll = document.getElementById('btnSelectAllPeers');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => this.selectAllPeers());
    }

    // Meetup status filter segmented buttons
    document.querySelectorAll('#statusFilterPills .segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#statusFilterPills .segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.statusFilter = btn.dataset.filter;
        this.loadMeetups();
      });
    });

    // Reimbursement status filter segmented buttons
    document.querySelectorAll('#reimbFilterPills .segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#reimbFilterPills .segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.reimbFilter = btn.dataset.filter;
        this.loadReimbursements();
      });
    });

    // Stats View Mode filter segmented buttons (ALL, CARDS, TABLES)
    document.querySelectorAll('#statsViewFilterPills .segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#statsViewFilterPills .segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.statsMode;
        const secHousesCards = document.getElementById('sectionHousesShowcase');
        const secRegionsCards = document.getElementById('sectionRegionsShowcase');
        const secHousesTable = document.getElementById('sectionHousesTable');
        const secRegionsTable = document.getElementById('sectionRegionsTable');

        if (mode === 'CARDS') {
          if (secHousesCards) secHousesCards.style.display = 'block';
          if (secRegionsCards) secRegionsCards.style.display = 'block';
          if (secHousesTable) secHousesTable.style.display = 'none';
          if (secRegionsTable) secRegionsTable.style.display = 'none';
        } else if (mode === 'TABLES') {
          if (secHousesCards) secHousesCards.style.display = 'none';
          if (secRegionsCards) secRegionsCards.style.display = 'none';
          if (secHousesTable) secHousesTable.style.display = 'block';
          if (secRegionsTable) secRegionsTable.style.display = 'block';
        } else {
          if (secHousesCards) secHousesCards.style.display = 'block';
          if (secRegionsCards) secRegionsCards.style.display = 'block';
          if (secHousesTable) secHousesTable.style.display = 'block';
          if (secRegionsTable) secRegionsTable.style.display = 'block';
        }
      });
    });

    // Claim Reimbursement Form Submit
    const formClaim = document.getElementById('formClaimReimbursement');
    if (formClaim) {
      formClaim.addEventListener('submit', (e) => this.submitReimbursementClaim(e));
    }

    // Region & House filter selects
    const regionSelect = document.getElementById('regionFilterSelect');
    if (regionSelect) {
      regionSelect.addEventListener('change', (e) => {
        this.regionFilter = e.target.value;
        this.loadMeetups();
      });
    }

    const houseSelect = document.getElementById('houseFilterSelect');
    if (houseSelect) {
      houseSelect.addEventListener('change', (e) => {
        this.houseFilter = e.target.value;
        this.loadMeetups();
      });
    }

    // Notification tray toggle & mark read
    const bellBtn = document.getElementById('notifBellBtn');
    const notifPanel = document.getElementById('notifPanel');
    if (bellBtn && notifPanel) {
      bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifPanel.classList.toggle('hidden');
      });
      document.addEventListener('click', () => notifPanel.classList.add('hidden'));
      notifPanel.addEventListener('click', (e) => e.stopPropagation());
    }

    const btnMarkRead = document.getElementById('btnMarkNotifsRead');
    if (btnMarkRead) {
      btnMarkRead.addEventListener('click', () => this.markNotificationsRead());
    }

    // Auth modal trigger
    const authBtn = document.getElementById('openLoginModalBtn');
    const authChip = document.getElementById('userProfileChip');
    if (authBtn) authBtn.addEventListener('click', () => document.getElementById('modalAuth').classList.remove('hidden'));
    if (authChip) authChip.addEventListener('click', () => document.getElementById('modalAuth').classList.remove('hidden'));

    // Google Auth simulation
    const btnGoogle = document.getElementById('btnGoogleAuth');
    if (btnGoogle) {
      btnGoogle.addEventListener('click', () => {
        this.showToast('Redirecting to Google OAuth (smail.iitm.ac.in)... Authenticated!', 'success');
        this.closeModal('modalAuth');
      });
    }

    // Reset database button
    const btnResetDb = document.getElementById('btnResetDatabase');
    if (btnResetDb) {
      btnResetDb.addEventListener('click', () => this.resetSeedData());
    }

    // Preset theme picker in preferences
    document.querySelectorAll('.preset-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.preset-item').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        this.applyThemePreset(item.dataset.preset);
      });
    });
  }

  applyThemePreset(preset) {
    const root = document.documentElement;
    switch (preset) {
      case 'dracula':
        root.style.setProperty('--accent-primary', '#BD93F9');
        root.style.setProperty('--accent-primary-hover', '#FF79C6');
        break;
      case 'catppuccin':
        root.style.setProperty('--accent-primary', '#CBA6F7');
        root.style.setProperty('--accent-primary-hover', '#F5C2E7');
        break;
      case 'nord':
        root.style.setProperty('--accent-primary', '#88C0D0');
        root.style.setProperty('--accent-primary-hover', '#81A1C1');
        break;
      case 'gruvbox':
        root.style.setProperty('--accent-primary', '#FE8019');
        root.style.setProperty('--accent-primary-hover', '#FABD2F');
        break;
      case 'tokyo-night':
        root.style.setProperty('--accent-primary', '#7AA2F7');
        root.style.setProperty('--accent-primary-hover', '#BB9AF7');
        break;
      default: // IITM BS default
        root.style.setProperty('--accent-primary', '#E05D2D');
        root.style.setProperty('--accent-primary-hover', '#EC6C3D');
        break;
    }
    this.showToast(`Applied preset theme: ${preset}`, 'info');
  }
}

// Global bootstrap instance
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppState();
  window.app.init();
});
