// ============================================================================
// script.js  —  College Timetable Management System
// All application logic: auth simulation, routing, rendering, localStorage,
// conflict detection, search, filters, CRUD, reports, printing.
// ============================================================================

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const STORAGE_KEYS = {
  entries: "ctms_timetable_entries",
  sections: "ctms_section_meta",
  session: "ctms_session",
};

let appState = {
  // Student -> { role:"Student", email, displayName }
  // Faculty -> { role:"Faculty", username, facultyName, displayName }
  // Admin   -> { role:"Admin", username, displayName, mustChangePassword }
  currentUser: null,
  currentView: "dashboard",
  studentSelection: { department: "", year: "", semester: "", section: "" },
  facultySelection: { name: "" },   // locked to the logged-in faculty member's own name — never user-editable
  roomSelection: { room: "", kind: "classroom" },
};

// ---------------------------------------------------------------------------
// DATA LAYER (localStorage backed, seeded from data.js)
// ---------------------------------------------------------------------------
function loadEntries() {
  const raw = localStorage.getItem(STORAGE_KEYS.entries);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(ORIGINAL_TIMETABLE_DATA));
}
function loadSections() {
  const raw = localStorage.getItem(STORAGE_KEYS.sections);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(ORIGINAL_SECTION_META));
}
function saveEntries(entries) { localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries)); }
function saveSections(sections) { localStorage.setItem(STORAGE_KEYS.sections, JSON.stringify(sections)); }

let ENTRIES = loadEntries();
let SECTIONS = loadSections();

function resetData() {
  ENTRIES = JSON.parse(JSON.stringify(ORIGINAL_TIMETABLE_DATA));
  SECTIONS = JSON.parse(JSON.stringify(ORIGINAL_SECTION_META));
  saveEntries(ENTRIES);
  saveSections(SECTIONS);
  showToast("All data has been reset to the original PDF-based timetable.", "success");
  renderCurrentView();
}

function nextEntryId() {
  return ENTRIES.reduce((max, e) => Math.max(max, e.id), 0) + 1;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function periodInfo(key) { return PERIODS.find(p => p.key === key); }
function timeToMinutes(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function rangesOverlap(s1, e1, s2, e2) {
  return timeToMinutes(s1) < timeToMinutes(e2) && timeToMinutes(s2) < timeToMinutes(e1);
}
function uniqueSorted(arr) { return Array.from(new Set(arr)).sort(); }
function allSectionNames() { return uniqueSorted(SECTIONS.map(s => s.section)); }
function allFacultyNames() { return uniqueSorted(ENTRIES.map(e => e.faculty).filter(f => f && f !== "Needs Verification")); }
function allDepartments() { return uniqueSorted(SECTIONS.map(s => s.programme)); }
function allRooms() { return uniqueSorted(ENTRIES.filter(e => e.type === "Theory").map(e => e.room)); }
function allLabs() { return uniqueSorted(ENTRIES.filter(e => e.type === "Lab").map(e => e.room)); }
function allSubjects() { return uniqueSorted(ENTRIES.map(e => e.subject).filter(s => s && s !== "Needs Verification")); }
function sectionMeta(sectionName) { return SECTIONS.find(s => s.section === sectionName); }
function todayDayKey() {
  const map = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return map[new Date().getDay()];
}
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtSubject(entry) {
  return entry.subject === "Needs Verification" ? '<span class="badge badge-verify">Needs Verification</span>' : escapeHtml(entry.subject);
}

// ---------------------------------------------------------------------------
// TOASTS
// ---------------------------------------------------------------------------
function showToast(message, kind = "info") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------------------------------------------------------------------------
// CONFIRM DIALOG
// ---------------------------------------------------------------------------
function confirmDialog(message, onConfirm) {
  const modal = document.getElementById("confirmModal");
  document.getElementById("confirmMessage").textContent = message;
  modal.classList.remove("hidden");
  const okBtn = document.getElementById("confirmOkBtn");
  const cancelBtn = document.getElementById("confirmCancelBtn");
  const cleanup = () => {
    modal.classList.add("hidden");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
  };
  okBtn.onclick = () => { cleanup(); onConfirm(); };
  cancelBtn.onclick = cleanup;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
// Role is fixed by which landing-page card the person clicked — it is never
// a field the person can pick or edit in the login form itself, which is
// what stops a Student from ever seeing a Faculty/Admin login option.
let currentLoginRole = "Student";

function initLandingAndLogin() {
  document.querySelectorAll(".role-enter").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const role = e.target.closest(".role-card").dataset.role;
      openLoginModal(role);
    });
  });
  document.getElementById("closeLoginModal").addEventListener("click", closeLoginModal);

  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => setStudentAuthTab(tab.dataset.tab));
  });

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifier = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!identifier || !password) return;
    setLoginError("");
    const submitBtn = document.getElementById("loginSubmitBtn");
    submitBtn.disabled = true;
    try {
      let result;
      if (currentLoginRole === "Student") result = await AUTH.loginStudent(identifier, password);
      else if (currentLoginRole === "Faculty") result = await AUTH.loginFaculty(identifier, password);
      else result = await AUTH.loginAdmin(identifier, password);

      if (!result.ok) { setLoginError(result.error); return; }
      completeLogin(result.user);
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById("studentSignupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("signupEmail").value.trim();
    const name = document.getElementById("signupName").value.trim();
    const pw = document.getElementById("signupPassword").value;
    const pw2 = document.getElementById("signupPasswordConfirm").value;
    setSignupError("");
    const res = await AUTH.signupStudent(email, name, pw, pw2);
    if (!res.ok) { setSignupError(res.error); return; }
    showToast("Password created — you can now log in with your college email.", "success");
    document.getElementById("studentSignupForm").reset();
    setStudentAuthTab("login");
    document.getElementById("loginUsername").value = email.toLowerCase();
  });

  const savedSession = sessionStorage.getItem(STORAGE_KEYS.session);
  if (savedSession) {
    try {
      appState.currentUser = JSON.parse(savedSession);
      enterApp();
    } catch (e) { /* ignore */ }
  }
}

function openLoginModal(role) {
  currentLoginRole = role;
  document.getElementById("loginRoleLabel").textContent = role;
  document.getElementById("loginModalTitle").textContent = role + " Sign In";
  document.getElementById("loginError").classList.add("hidden");
  document.getElementById("signupError").classList.add("hidden");
  document.getElementById("loginForm").reset();
  document.getElementById("studentSignupForm").reset();

  const isStudent = role === "Student";
  document.getElementById("studentAuthTabs").classList.toggle("hidden", !isStudent);
  setStudentAuthTab("login");

  const idLabelText = document.getElementById("loginIdentifierLabelText");
  const idInput = document.getElementById("loginUsername");
  const hint = document.getElementById("loginHint");
  if (role === "Student") {
    idLabelText.textContent = "College Email";
    idInput.placeholder = "student@joyuniversity.edu.in";
    idInput.type = "email";
    hint.textContent = "Students: use your official @joyuniversity.edu.in email. New here? Use \u201cCreate Password\u201d above.";
  } else if (role === "Faculty") {
    idLabelText.textContent = "Username";
    idInput.placeholder = "Username provided by Admin";
    idInput.type = "text";
    hint.textContent = "Faculty accounts are created by the Admin. Contact Admin if you don\u2019t have your login details.";
  } else {
    idLabelText.textContent = "Admin Username";
    idInput.placeholder = "Admin username";
    idInput.type = "text";
    hint.textContent = "Admin access only.";
  }
  document.getElementById("loginModal").classList.remove("hidden");
}
function closeLoginModal() { document.getElementById("loginModal").classList.add("hidden"); }

function setStudentAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  const isSignup = tab === "signup" && currentLoginRole === "Student";
  document.getElementById("loginForm").classList.toggle("hidden", isSignup);
  document.getElementById("studentSignupForm").classList.toggle("hidden", !isSignup);
}
function setLoginError(msg) {
  const el = document.getElementById("loginError");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}
function setSignupError(msg) {
  const el = document.getElementById("signupError");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

function completeLogin(user) {
  appState.currentUser = user;
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(user));
  closeLoginModal();
  enterApp();
  showToast(`Welcome, ${user.displayName} (${user.role})`, "success");
}

function logout() {
  appState.currentUser = null;
  appState.currentView = "dashboard";
  appState.studentSelection = { department: "", year: "", semester: "", section: "" };
  appState.facultySelection = { name: "" };
  sessionStorage.removeItem(STORAGE_KEYS.session);
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("landingPage").classList.remove("hidden");
  document.getElementById("loginForm").reset();
  document.getElementById("studentSignupForm").reset();
}

function enterApp() {
  document.getElementById("landingPage").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  const user = appState.currentUser;
  const role = user.role;

  // A Faculty account is permanently bound to exactly one faculty member's
  // name (set by Admin when the account was created) — there is no picker,
  // so a faculty member can never browse into another faculty member's data.
  if (role === "Faculty") appState.facultySelection = { name: user.facultyName };

  document.getElementById("userName").textContent = user.displayName;
  document.getElementById("userRole").textContent = role;
  document.getElementById("userAvatar").textContent = user.displayName.charAt(0).toUpperCase();
  buildSidebarNav(role);
  appState.currentView = "dashboard";
  renderCurrentView();

  if (role === "Admin" && user.mustChangePassword) {
    showToast("Security reminder: please change the default Admin password in Settings.", "info");
  }
}

// ---------------------------------------------------------------------------
// SIDEBAR / NAVIGATION
// ---------------------------------------------------------------------------
const NAV_ITEMS = {
  Admin: [
    { key: "dashboard", label: "Dashboard", icon: "&#128202;" },
    { key: "timetable", label: "Timetable", icon: "&#128197;" },
    { key: "sections", label: "Sections", icon: "&#127970;" },
    { key: "subjects", label: "Subjects", icon: "&#128218;" },
    { key: "faculty", label: "Faculty", icon: "&#128100;" },
    { key: "classrooms", label: "Classrooms", icon: "&#128220;" },
    { key: "labs", label: "Laboratories", icon: "&#129514;" },
    { key: "conflicts", label: "Conflict Detection", icon: "&#9888;&#65039;" },
    { key: "reports", label: "Reports", icon: "&#128203;" },
    { key: "settings", label: "Settings", icon: "&#9881;&#65039;" },
  ],
  Student: [
    { key: "dashboard", label: "Dashboard", icon: "&#128202;" },
    { key: "student-section", label: "Section Selection", icon: "&#127970;" },
    { key: "student-timetable", label: "Timetable", icon: "&#128197;" },
    { key: "student-today", label: "Today's Classes", icon: "&#9200;" },
    { key: "student-subjects", label: "Subjects", icon: "&#128218;" },
    { key: "student-faculty", label: "Faculty", icon: "&#128100;" },
  ],
  Faculty: [
    { key: "dashboard", label: "Dashboard", icon: "&#128202;" },
    { key: "faculty-mytimetable", label: "My Timetable", icon: "&#128197;" },
    { key: "faculty-today", label: "Today's Classes", icon: "&#9200;" },
    { key: "faculty-sections", label: "Assigned Sections", icon: "&#127970;" },
    { key: "faculty-subjects", label: "Subjects", icon: "&#128218;" },
    { key: "faculty-rooms", label: "Rooms / Labs", icon: "&#128220;" },
  ],
};

function buildSidebarNav(role) {
  const nav = document.getElementById("sidebarNav");
  nav.innerHTML = "";
  NAV_ITEMS[role].forEach(item => {
    const div = document.createElement("div");
    div.className = "nav-item" + (item.key === appState.currentView ? " active" : "");
    div.dataset.view = item.key;
    div.innerHTML = `<span class="nav-icon">${item.icon}</span><span>${item.label}</span>`;
    div.addEventListener("click", () => {
      appState.currentView = item.key;
      document.getElementById("sidebar").classList.remove("open");
      renderCurrentView();
    });
    nav.appendChild(div);
  });
}
function refreshActiveNav() {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.view === appState.currentView);
  });
}

// ---------------------------------------------------------------------------
// RENDER ROUTER
// ---------------------------------------------------------------------------
function renderCurrentView() {
  refreshActiveNav();
  const role = appState.currentUser.role;
  const view = appState.currentView;
  const content = document.getElementById("pageContent");
  let html = "";

  if (view === "dashboard") {
    html = role === "Admin" ? renderAdminDashboard() : role === "Faculty" ? renderFacultyDashboard() : renderStudentDashboard();
  } else if (role === "Admin") {
    switch (view) {
      case "timetable": html = renderAdminTimetablePage(); break;
      case "sections": html = renderSectionsPage(); break;
      case "subjects": html = renderSubjectsPage(); break;
      case "faculty": html = renderFacultyListPage(); break;
      case "classrooms": html = renderRoomListPage("classroom"); break;
      case "labs": html = renderRoomListPage("lab"); break;
      case "conflicts": html = renderConflictsPage(); break;
      case "reports": html = renderReportsPage(); break;
      case "settings": html = renderSettingsPage(); break;
      default: html = renderAdminDashboard();
    }
  } else if (role === "Student") {
    switch (view) {
      case "student-section": html = renderStudentSectionSelect(); break;
      case "student-timetable": html = renderStudentTimetable(); break;
      case "student-today": html = renderStudentToday(); break;
      case "student-subjects": html = renderStudentSubjects(); break;
      case "student-faculty": html = renderStudentFaculty(); break;
      default: html = renderStudentDashboard();
    }
  } else if (role === "Faculty") {
    switch (view) {
      case "faculty-mytimetable": html = renderFacultyMyTimetable(); break;
      case "faculty-today": html = renderFacultyToday(); break;
      case "faculty-sections": html = renderFacultyAssignedSections(); break;
      case "faculty-subjects": html = renderFacultySubjects(); break;
      case "faculty-rooms": html = renderFacultyRooms(); break;
      default: html = renderFacultyDashboard();
    }
  }
  content.innerHTML = html;
  attachViewHandlers(view, role);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// ADMIN: DASHBOARD
// ---------------------------------------------------------------------------
function renderAdminDashboard() {
  const totalSections = SECTIONS.length;
  const totalClasses = ENTRIES.length;
  const totalSubjects = uniqueSorted(ENTRIES.map(e => e.courseCode)).length;
  const totalFaculty = allFacultyNames().length;
  const totalClassrooms = allRooms().length;
  const totalLabs = allLabs().length;
  const conflicts = detectConflicts();

  return `
    <h1 class="page-title">Admin Dashboard</h1>
    <p class="page-subtitle">Overview of the College Timetable Management System</p>
    <div class="cards-grid">
      ${statCard(totalSections, "Total Sections")}
      ${statCard(totalClasses, "Total Timetable Entries")}
      ${statCard(totalSubjects, "Total Subjects")}
      ${statCard(totalFaculty, "Total Faculty")}
      ${statCard(totalClassrooms, "Total Classrooms")}
      ${statCard(totalLabs, "Total Laboratories")}
      ${statCard(conflicts.length, "Detected Conflicts")}
    </div>
    <div class="section-block">
      <h3>Sections Overview (A&ndash;L)</h3>
      <div class="item-grid">
        ${SECTIONS.map(s => `
          <div class="item-tile" data-goto-section="${escapeHtml(s.section)}">
            <div class="tile-letter">${escapeHtml(s.section)}</div>
            <div class="tile-label">${escapeHtml(s.programme)}</div>
          </div>`).join("")}
      </div>
    </div>
    <div class="section-block">
      <h3>Quick Actions</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="qaAddEntry">+ Add Timetable Entry</button>
        <button class="btn btn-outline" id="qaViewConflicts">View Conflicts</button>
        <button class="btn btn-outline" id="qaReports">Open Reports</button>
      </div>
    </div>
  `;
}
function statCard(value, label) {
  return `<div class="stat-card"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

// ---------------------------------------------------------------------------
// ADMIN: TIMETABLE MANAGEMENT (per-section grid + add/edit/delete)
// ---------------------------------------------------------------------------
function renderAdminTimetablePage() {
  const sections = allSectionNames();
  const depts = allDepartments();
  const selSection = appState.adminTTSection || sections[0];
  return `
    <h1 class="page-title">Timetable Management</h1>
    <p class="page-subtitle">Add, edit or delete timetable entries. Conflicts are checked automatically before saving.</p>
    <div class="filters-bar">
      <div class="filter-group">Department
        <select id="ttDeptFilter"><option value="">All</option>${depts.map(d => `<option>${escapeHtml(d)}</option>`).join("")}</select>
      </div>
      <div class="filter-group">Section
        <select id="ttSectionFilter">${sections.map(s => `<option ${s === selSection ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}</select>
      </div>
      <button class="btn btn-primary" id="addEntryBtn">+ Add Timetable Entry</button>
      <button class="btn btn-outline" id="printTimetableBtn">&#128424; Print Timetable</button>
    </div>
    <div id="adminTimetableGridWrap"></div>
  `;
}
function renderAdminTimetableGrid(section) {
  const meta = sectionMeta(section);
  const rows = buildGridRows(section);
  return `
    <div class="section-block" id="printableTimetable">
      <h3>Section ${escapeHtml(section)} &mdash; ${meta ? escapeHtml(meta.programme) + " (" + escapeHtml(meta.year) + "/" + escapeHtml(meta.semester) + ")" : ""}</h3>
      <p class="page-subtitle">Room: ${meta ? escapeHtml(meta.room) : "-"} &middot; In-charge: ${meta ? escapeHtml(meta.incharge) : "-"}</p>
      ${gridTableHtml(rows, true, section)}
    </div>
  `;
}
function buildGridRows(section) {
  const sectionEntries = ENTRIES.filter(e => e.section === section);
  const rows = {};
  DAYS.forEach(d => rows[d] = {});
  sectionEntries.forEach(e => {
    if (!rows[e.day]) rows[e.day] = {};
    // Store double-period entries under their first period so they render in
    // the grid (e.g. P1P2 is displayed across P1 and P2).
    const firstPeriod = e.period && e.period.length === 4 ? e.period.substring(0, 2) : e.period;
    rows[e.day][firstPeriod] = e;
  });
  return rows;
}
function gridTableHtml(rows, editable, section) {
  const gridPeriods = PERIODS;
  let head = `<tr><th>Day</th>`;
  gridPeriods.forEach(p => {
    if (p.key === "BREAK" || p.key === "LUNCH") head += `<th>${p.label}<br><small>${p.start}-${p.end}</small></th>`;
    else head += `<th>${p.key}<br><small>${p.start}-${p.end}</small></th>`;
  });
  head += `</tr>`;

  let body = "";
  DAYS.forEach(day => {
    body += `<tr><td class="day-cell">${DAY_LABELS[day]}</td>`;
    let skip = 0;
    for (let i = 0; i < gridPeriods.length; i++) {
      const p = gridPeriods[i];
      if (skip > 0) { skip--; continue; }
      if (p.key === "BREAK") { body += `<td class="tt-break">${p.label}</td>`; continue; }
      if (p.key === "LUNCH") { body += `<td class="tt-break">${p.label}</td>`; continue; }
      const entry = (rows[day] || {})[p.key];
      if (entry) {
        // determine if this entry spans a double period (e.g. P1P2)
        let span = 1;
        if (entry.period.length === 4) { // e.g. "P1P2" or "P3P4" or "P5P6"
          span = 2;
          skip = 1;
        }
        const colspan = entry.period && entry.period.length === 4 ? 2 : 1;
        body += `<td class="tt-cell"${colspan > 1 ? ` colspan="${colspan}"` : ""}>${entrySlotHtml(entry, editable)}</td>`;
      } else {
        body += `<td class="tt-cell"><span class="empty-cell">&ndash;</span></td>`;
      }
    }
    body += `</tr>`;
  });

  return `<div class="timetable-grid-wrap"><table class="timetable-grid">${head}${body}</table></div>`;
}
function entrySlotHtml(entry, editable) {
  const cls = entry.type === "Lab" ? "tt-slot lab" : "tt-slot";
  const verify = entry.verification ? `<div class="meta">&#9888; ${escapeHtml(entry.verification)}</div>` : "";
  const actions = editable ? `
    <div class="meta" style="margin-top:4px;display:flex;gap:6px;">
      <a href="#" class="edit-entry-link" data-id="${entry.id}">Edit</a>
      <a href="#" class="delete-entry-link" data-id="${entry.id}">Delete</a>
    </div>` : "";
  return `
    <div class="${cls}">
      <div class="code">${escapeHtml(entry.courseCode)}</div>
      <div class="subj">${fmtSubject(entry)}</div>
      <div class="meta">${escapeHtml(entry.faculty)}</div>
      <div class="meta">${escapeHtml(entry.room)} &middot; ${escapeHtml(entry.type)}</div>
      ${verify}
      ${actions}
    </div>`;
}

// ---------------------------------------------------------------------------
// ADMIN: SECTIONS PAGE
// ---------------------------------------------------------------------------
function renderSectionsPage() {
  return `
    <h1 class="page-title">Section Management</h1>
    <p class="page-subtitle">${SECTIONS.length} sections (A&ndash;L). Click a section to view its timetable.</p>
    <div style="margin-bottom:16px;"><button class="btn btn-primary" id="addSectionBtn">+ Add Section</button></div>
    <div class="item-grid">
      ${SECTIONS.map(s => `
        <div class="item-tile">
          <div class="tile-letter" data-goto-section="${escapeHtml(s.section)}" style="cursor:pointer;">${escapeHtml(s.section)}</div>
          <div class="tile-label">${escapeHtml(s.programme)}<br>${escapeHtml(s.year)}/${escapeHtml(s.semester)}</div>
          <div class="tile-actions">
            <button class="btn btn-sm btn-outline" data-goto-section="${escapeHtml(s.section)}">View</button>
            <button class="btn btn-sm btn-outline" data-edit-section="${escapeHtml(s.section)}">Edit</button>
            <button class="btn btn-sm btn-danger" data-delete-section="${escapeHtml(s.section)}">Delete</button>
          </div>
        </div>`).join("")}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// ADMIN: SUBJECTS PAGE
// ---------------------------------------------------------------------------
function renderSubjectsPage() {
  const map = {};
  ENTRIES.forEach(e => {
    const key = e.courseCode + "|" + e.section;
    if (!map[key]) map[key] = e;
  });
  const rows = Object.values(map).sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  return `
    <h1 class="page-title">Subjects</h1>
    <p class="page-subtitle">All subjects extracted from the timetable, grouped by course code and section.</p>
    <div class="table-wrap"><table>
      <tr><th>Course Code</th><th>Subject</th><th>Section</th><th>Faculty</th><th>Type</th></tr>
      ${rows.map(e => `<tr>
        <td>${escapeHtml(e.courseCode)}</td><td>${fmtSubject(e)}</td><td>${escapeHtml(e.section)}</td>
        <td>${escapeHtml(e.faculty)}</td><td><span class="badge ${e.type === "Lab" ? "badge-lab" : "badge-theory"}">${escapeHtml(e.type)}</span></td>
      </tr>`).join("")}
    </table></div>
  `;
}

// ---------------------------------------------------------------------------
// ADMIN: FACULTY LIST + SCHEDULE
// ---------------------------------------------------------------------------
function renderFacultyListPage() {
  const faculty = allFacultyNames();
  const selected = appState.selectedFaculty || "";
  return `
    <h1 class="page-title">Faculty</h1>
    <p class="page-subtitle">Search or select a faculty member to view their complete schedule.</p>
    <div class="filters-bar">
      <div class="filter-group">Faculty
        <select id="facultySelect">
          <option value="">-- Select Faculty --</option>
          ${faculty.map(f => `<option ${f === selected ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">Search
        <input type="text" id="facultySearchInput" placeholder="Type faculty name..." />
      </div>
    </div>
    <div id="facultyScheduleResult">${selected ? facultyScheduleHtml(selected) : emptyState("Select a faculty member to see their schedule.")}</div>
    ${renderFacultyAccountsPanel(faculty)}
  `;
}
function renderFacultyAccountsPanel(faculty) {
  const accounts = AUTH.listFacultyAccounts();
  const noAccountYet = AUTH.facultyNamesWithoutAccount(faculty);
  return `
    <div class="section-block">
      <h3>Faculty Login Accounts</h3>
      <p style="color:var(--text-muted);font-size:13.5px;">
        Create a login account for a faculty member. Faculty cannot create their own accounts — a unique
        username and a one-time password are generated here for you to send by email. Each faculty member's
        account only ever shows that faculty member's own schedule.
      </p>
      <div class="filters-bar">
        <div class="filter-group">Faculty member (no account yet)
          <select id="newFacultyAccountSelect">
            <option value="">-- Select Faculty --</option>
            ${noAccountYet.map(f => `<option>${escapeHtml(f)}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-primary" id="createFacultyAccountBtn" ${noAccountYet.length ? "" : "disabled"}>Create Account</button>
      </div>
      <div class="table-wrap"><table>
        <tr><th>Username</th><th>Faculty Member</th><th>Created</th><th>Actions</th></tr>
        ${accounts.length ? accounts.map(a => `<tr>
          <td>${escapeHtml(a.username)}</td>
          <td>${escapeHtml(a.facultyName)}</td>
          <td>${new Date(a.createdAt).toLocaleDateString()}</td>
          <td>
            <a href="#" class="reset-fac-pass-link" data-username="${escapeHtml(a.username)}">Reset Password</a>
            &middot;
            <a href="#" class="remove-fac-acc-link" data-username="${escapeHtml(a.username)}">Remove</a>
          </td>
        </tr>`).join("") : `<tr><td colspan="4" style="color:var(--text-muted);">No faculty login accounts created yet.</td></tr>`}
      </table></div>
    </div>
  `;
}
function facultyScheduleHtml(name) {
  const entries = ENTRIES.filter(e => e.faculty === name).sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime));
  if (entries.length === 0) return emptyState("No classes found for this faculty member.");
  return `
    <div class="section-block">
      <h3>Schedule for ${escapeHtml(name)}</h3>
      <div class="table-wrap"><table>
        <tr><th>Day</th><th>Time</th><th>Subject</th><th>Section</th><th>Room/Lab</th></tr>
        ${entries.map(e => `<tr>
          <td>${DAY_LABELS[e.day]}</td><td>${e.startTime}-${e.endTime}</td><td>${fmtSubject(e)}</td>
          <td>${escapeHtml(e.section)}</td><td>${escapeHtml(e.room)}</td>
        </tr>`).join("")}
      </table></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// ADMIN: ROOM / LAB SCHEDULE
// ---------------------------------------------------------------------------
function renderRoomListPage(kind) {
  const rooms = kind === "lab" ? allLabs() : allRooms();
  const selected = appState.selectedRoom || "";
  return `
    <h1 class="page-title">${kind === "lab" ? "Laboratory" : "Classroom"} Schedule</h1>
    <p class="page-subtitle">Select a ${kind === "lab" ? "laboratory" : "classroom"} to view occupancy and availability.</p>
    <div class="filters-bar">
      <div class="filter-group">${kind === "lab" ? "Laboratory" : "Classroom"}
        <select id="roomSelect" data-kind="${kind}">
          <option value="">-- Select --</option>
          ${rooms.map(r => `<option ${r === selected ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="roomScheduleResult">${selected ? roomScheduleHtml(selected, kind) : emptyState("Select a room or lab to view its schedule.")}</div>
  `;
}
function roomScheduleHtml(room, kind) {
  const entries = ENTRIES.filter(e => e.room === room).sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime));
  const occupiedSlots = new Set(entries.map(e => e.day + e.period));
  let availabilityRows = "";
  DAYS.forEach(day => {
    PERIODS.filter(p => p.key !== "BREAK" && p.key !== "LUNCH").forEach(p => {
      const occ = entries.find(e => e.day === day && (e.period === p.key || (e.period.length === 4 && e.period.includes(p.key))));
      availabilityRows += `<tr>
        <td>${DAY_LABELS[day]}</td><td>${p.start}-${p.end}</td>
        <td>${occ ? `<span class="badge badge-occupied">Occupied</span>` : `<span class="badge badge-available">Available</span>`}</td>
        <td>${occ ? escapeHtml(occ.section) : "-"}</td>
        <td>${occ ? fmtSubject(occ) : "-"}</td>
        <td>${occ ? escapeHtml(occ.faculty) : "-"}</td>
      </tr>`;
    });
  });
  return `
    <div class="section-block">
      <h3>${kind === "lab" ? "Laboratory" : "Classroom"}: ${escapeHtml(room)}</h3>
      <div class="table-wrap"><table>
        <tr><th>Day</th><th>Time</th><th>Status</th><th>Section</th><th>Subject</th><th>Faculty</th></tr>
        ${availabilityRows}
      </table></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// CONFLICT DETECTION
// ---------------------------------------------------------------------------
function detectConflicts() {
  const conflicts = [];
  DAYS.forEach(day => {
    const dayEntries = ENTRIES.filter(e => e.day === day);
    for (let i = 0; i < dayEntries.length; i++) {
      for (let j = i + 1; j < dayEntries.length; j++) {
        const a = dayEntries[i], b = dayEntries[j];
        if (a.id === b.id) continue;
        // Lab hours are intentionally excluded from conflict detection.
        if (a.type === "Lab" || b.type === "Lab") continue;
        if (!rangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;

        // 1. Faculty conflict: same faculty, different sections, overlapping time
        if (a.faculty === b.faculty && a.faculty !== "Needs Verification" && a.section !== b.section) {
          conflicts.push({ type: "Faculty Conflict", day, a, b, detail: `Faculty ${a.faculty} is assigned to Section ${a.section} and Section ${b.section} at overlapping times.` });
        }
        // 2. Room/Lab conflict: same room, different section, overlapping time
        if (a.room === b.room && a.room !== "Needs Verification" && a.section !== b.section) {
          conflicts.push({ type: a.type === "Lab" || b.type === "Lab" ? "Laboratory Conflict" : "Classroom Conflict", day, a, b, detail: `Room/Lab ${a.room} is assigned to Section ${a.section} and Section ${b.section} at overlapping times.` });
        }
        // 3. Section conflict: same section, two different subjects at overlapping time
        if (a.section === b.section && a.courseCode !== b.courseCode) {
          conflicts.push({ type: "Section Conflict", day, a, b, detail: `Section ${a.section} has both ${a.courseCode} and ${b.courseCode} scheduled at overlapping times.` });
        }
      }
    }
  });
  return conflicts;
}
function renderConflictsPage() {
  const conflicts = detectConflicts();
  return `
    <h1 class="page-title">Conflict Detection</h1>
    <p class="page-subtitle">${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} detected in the current dataset.</p>
    ${conflicts.length === 0 ? emptyState("No conflicts detected. The timetable is clash-free.") :
      conflicts.map(c => `
        <div class="conflict-card">
          <div class="ctype">TIMETABLE CONFLICT &mdash; ${escapeHtml(c.type)}</div>
          <div class="crow"><b>Day:</b> ${DAY_LABELS[c.day]}</div>
          <div class="crow"><b>Time:</b> ${c.a.startTime}-${c.a.endTime} / ${c.b.startTime}-${c.b.endTime}</div>
          <div class="crow"><b>Sections:</b> ${escapeHtml(c.a.section)} and ${escapeHtml(c.b.section)}</div>
          <div class="crow">${escapeHtml(c.detail)}</div>
        </div>`).join("")}
  `;
}

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------
function renderReportsPage() {
  return `
    <h1 class="page-title">Reports</h1>
    <p class="page-subtitle">Generate section-wise, faculty-wise, room-wise or subject-wise timetable reports.</p>
    <div class="filters-bar">
      <div class="filter-group">Report Type
        <select id="reportType">
          <option value="section">Section-wise Timetable</option>
          <option value="faculty">Faculty-wise Timetable</option>
          <option value="room">Room-wise Timetable</option>
          <option value="subject">Subject-wise Timetable</option>
        </select>
      </div>
      <div class="filter-group">Value
        <select id="reportValue"></select>
      </div>
      <button class="btn btn-outline" id="printReportBtn">&#128424; Print</button>
    </div>
    <div id="reportResult"></div>
  `;
}
function populateReportValues() {
  const type = document.getElementById("reportType").value;
  const valueSelect = document.getElementById("reportValue");
  let options = [];
  if (type === "section") options = allSectionNames();
  else if (type === "faculty") options = allFacultyNames();
  else if (type === "room") options = uniqueSorted([...allRooms(), ...allLabs()]);
  else if (type === "subject") options = allSubjects();
  valueSelect.innerHTML = options.map(o => `<option>${escapeHtml(o)}</option>`).join("");
  renderReportResult();
}
function renderReportResult() {
  const type = document.getElementById("reportType").value;
  const value = document.getElementById("reportValue").value;
  let entries = [];
  if (type === "section") entries = ENTRIES.filter(e => e.section === value);
  else if (type === "faculty") entries = ENTRIES.filter(e => e.faculty === value);
  else if (type === "room") entries = ENTRIES.filter(e => e.room === value);
  else if (type === "subject") entries = ENTRIES.filter(e => e.subject === value);
  entries.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime));
  document.getElementById("reportResult").innerHTML = `
    <div class="section-block" id="printableReport">
      <h3>${escapeHtml(type.charAt(0).toUpperCase() + type.slice(1))}-wise Report: ${escapeHtml(value || "")}</h3>
      ${entries.length === 0 ? emptyState("No records found.") : `
      <div class="table-wrap"><table>
        <tr><th>Day</th><th>Time</th><th>Section</th><th>Course Code</th><th>Subject</th><th>Faculty</th><th>Room</th></tr>
        ${entries.map(e => `<tr>
          <td>${DAY_LABELS[e.day]}</td><td>${e.startTime}-${e.endTime}</td><td>${escapeHtml(e.section)}</td>
          <td>${escapeHtml(e.courseCode)}</td><td>${fmtSubject(e)}</td><td>${escapeHtml(e.faculty)}</td><td>${escapeHtml(e.room)}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
function renderSettingsPage() {
  const mustChange = appState.currentUser.mustChangePassword;
  return `
    <h1 class="page-title">Settings</h1>
    <p class="page-subtitle">System data management and Admin account security.</p>
    <div class="section-block">
      <h3>Admin Account &mdash; Change Password ${mustChange ? '<span class="badge badge-warning">Action Needed</span>' : ""}</h3>
      <p style="color:var(--text-muted);font-size:13.5px;">
        ${mustChange
          ? "You are still using the default password the system generated for this Admin account. Please set your own password now."
          : "Update your Admin login password. This account is only ever visible to you as Admin — Students and Faculty have no way to see or reach it."}
      </p>
      <form id="adminChangePasswordForm" class="inline-form">
        <label>Current Password<input type="password" id="adminCurPass" required autocomplete="current-password" /></label>
        <label>New Password<input type="password" id="adminNewPass" required minlength="8" autocomplete="new-password" /></label>
        <label>Confirm New Password<input type="password" id="adminNewPass2" required minlength="8" autocomplete="new-password" /></label>
        <p id="adminPassError" class="form-error hidden"></p>
        <button type="submit" class="btn btn-primary">Update Password</button>
      </form>
    </div>
    <div class="section-block">
      <h3>Reset Data</h3>
      <p style="color:var(--text-muted);font-size:13.5px;">Restore the timetable to the original PDF-based dataset. Any edits, additions or deletions made in Admin &rarr; Timetable Management will be discarded.</p>
      <button class="btn btn-danger" id="resetDataBtn">Reset Data</button>
    </div>
    <div class="section-block">
      <h3>About</h3>
      <p style="color:var(--text-muted);font-size:13.5px;">College Timetable Management System &middot; Joy University &middot; School of Computational Intelligence.<br>
      Frontend prototype built with HTML, CSS and vanilla JavaScript. Data persists locally in your browser via localStorage.</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// STUDENT VIEWS
// ---------------------------------------------------------------------------
function renderStudentDashboard() {
  const sel = appState.studentSelection;
  return `
    <h1 class="page-title">Student Dashboard</h1>
    <p class="page-subtitle">${sel.section ? `Viewing Section ${escapeHtml(sel.section)}` : "Select your section to get started."}</p>
    ${!sel.section ? `<div class="section-block">${studentSectionSelectorHtml()}</div>` : `
      <div class="cards-grid">
        ${statCard(sel.section, "Your Section")}
        ${statCard(ENTRIES.filter(e => e.section === sel.section).length, "Total Classes/Week")}
        ${statCard(todaysEntries(sel.section).length, "Today's Classes")}
      </div>
      ${renderTodayBlock(sel.section)}
      <div class="section-block">
        <h3>Complete Timetable &mdash; Section ${escapeHtml(sel.section)}</h3>
        ${gridTableHtml(buildGridRows(sel.section), false)}
      </div>
    `}
  `;
}
function studentSectionSelectorHtml() {
  const depts = allDepartments();
  return `
    <h3>Select Your Section</h3>
    <div class="filters-bar">
      <div class="filter-group">Department
        <select id="stuDept"><option value="">All</option>${depts.map(d => `<option>${escapeHtml(d)}</option>`).join("")}</select>
      </div>
      <div class="filter-group">Section
        <select id="stuSection"><option value="">Select Section</option>${allSectionNames().map(s => `<option>${escapeHtml(s)}</option>`).join("")}</select>
      </div>
      <button class="btn btn-primary" id="stuConfirmBtn">Confirm</button>
    </div>
  `;
}
function renderStudentSectionSelect() {
  return `
    <h1 class="page-title">Section Selection</h1>
    <p class="page-subtitle">Choose your department, year/semester and section.</p>
    <div class="section-block">${studentSectionSelectorHtml()}</div>
  `;
}
function renderStudentTimetable() {
  const sel = appState.studentSelection;
  if (!sel.section) return emptyState("Please select your section first (Section Selection).");
  return `
    <h1 class="page-title">Timetable &mdash; Section ${escapeHtml(sel.section)}</h1>
    <p class="page-subtitle">View-only. Contact the admin office for any corrections.</p>
    <div class="section-block">${gridTableHtml(buildGridRows(sel.section), false)}</div>
  `;
}
function todaysEntries(section) {
  const day = todayDayKey();
  if (!DAYS.includes(day)) return [];
  return ENTRIES.filter(e => e.section === section && e.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
}
function renderTodayBlock(section) {
  const day = todayDayKey();
  const entries = todaysEntries(section);
  const nm = nowMinutes();
  let current = null, next = null;
  entries.forEach(e => {
    const s = timeToMinutes(e.startTime), en = timeToMinutes(e.endTime);
    if (nm >= s && nm < en) current = e;
    if (nm < s && (!next || s < timeToMinutes(next.startTime))) next = e;
  });
  if (!DAYS.includes(day)) {
    return `<div class="section-block"><h3>Today's Classes</h3>${emptyState("No classes today — it's the weekend!")}</div>`;
  }
  return `
    <div class="section-block">
      <h3>Today's Classes &mdash; ${DAY_LABELS[day]}</h3>
      ${current ? `<p><b>Current Class:</b> ${fmtSubject(current)} (${current.startTime}-${current.endTime}) with ${escapeHtml(current.faculty)} in ${escapeHtml(current.room)}</p>` : `<p><b>Current Class:</b> None right now</p>`}
      ${next ? `<p><b>Next Class:</b> ${fmtSubject(next)} (${next.startTime}-${next.endTime}) with ${escapeHtml(next.faculty)} in ${escapeHtml(next.room)}</p>` : `<p><b>Next Class:</b> No more classes today</p>`}
      ${entries.length === 0 ? emptyState("No classes scheduled for today.") : `
      <div class="table-wrap"><table>
        <tr><th>Time</th><th>Subject</th><th>Faculty</th><th>Room/Lab</th><th>Type</th></tr>
        ${entries.map(e => `<tr><td>${e.startTime}-${e.endTime}</td><td>${fmtSubject(e)}</td><td>${escapeHtml(e.faculty)}</td><td>${escapeHtml(e.room)}</td><td><span class="badge ${e.type === "Lab" ? "badge-lab" : "badge-theory"}">${escapeHtml(e.type)}</span></td></tr>`).join("")}
      </table></div>`}
    </div>
  `;
}
function renderStudentToday() {
  const sel = appState.studentSelection;
  if (!sel.section) return emptyState("Please select your section first (Section Selection).");
  return `<h1 class="page-title">Today's Classes</h1><p class="page-subtitle">Section ${escapeHtml(sel.section)}</p>${renderTodayBlock(sel.section)}`;
}
function renderStudentSubjects() {
  const sel = appState.studentSelection;
  if (!sel.section) return emptyState("Please select your section first (Section Selection).");
  const meta = sectionMeta(sel.section);
  return `
    <h1 class="page-title">Subjects &mdash; Section ${escapeHtml(sel.section)}</h1>
    <div class="table-wrap"><table>
      <tr><th>Course Code</th><th>Subject</th><th>Faculty</th><th>Type</th></tr>
      ${meta.subjects.map(s => `<tr><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.faculty)}</td><td><span class="badge ${s.type === "Lab" ? "badge-lab" : "badge-theory"}">${escapeHtml(s.type)}</span></td></tr>`).join("")}
    </table></div>
  `;
}
function renderStudentFaculty() {
  const sel = appState.studentSelection;
  if (!sel.section) return emptyState("Please select your section first (Section Selection).");
  const meta = sectionMeta(sel.section);
  const facultyList = uniqueSorted(meta.subjects.map(s => s.faculty));
  return `
    <h1 class="page-title">Faculty &mdash; Section ${escapeHtml(sel.section)}</h1>
    <div class="table-wrap"><table>
      <tr><th>Faculty</th><th>Subjects</th></tr>
      ${facultyList.map(f => `<tr><td>${escapeHtml(f)}</td><td>${meta.subjects.filter(s => s.faculty === f).map(s => escapeHtml(s.name)).join(", ")}</td></tr>`).join("")}
    </table></div>
  `;
}

// ---------------------------------------------------------------------------
// FACULTY VIEWS
// ---------------------------------------------------------------------------
function renderFacultyDashboard() {
  const sel = appState.facultySelection;
  if (!sel.name) return emptyState("Your account is not linked to a faculty record. Contact Admin.");
  return `
    <h1 class="page-title">Faculty Dashboard</h1>
    <p class="page-subtitle">Welcome, ${escapeHtml(sel.name)}</p>
    <div class="cards-grid">
      ${statCard(ENTRIES.filter(e => e.faculty === sel.name).length, "Total Classes/Week")}
      ${statCard(uniqueSorted(ENTRIES.filter(e => e.faculty === sel.name).map(e => e.section)).length, "Assigned Sections")}
      ${statCard(facultyTodayEntries(sel.name).length, "Today's Classes")}
    </div>
    ${renderFacultyTodayBlock(sel.name)}
  `;
}
function facultyTodayEntries(name) {
  const day = todayDayKey();
  if (!DAYS.includes(day)) return [];
  return ENTRIES.filter(e => e.faculty === name && e.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
}
function renderFacultyTodayBlock(name) {
  const day = todayDayKey();
  const entries = facultyTodayEntries(name);
  if (!DAYS.includes(day)) return `<div class="section-block"><h3>Today's Classes</h3>${emptyState("No classes today — it's the weekend!")}</div>`;
  const nm = nowMinutes();
  let current = null, next = null;
  entries.forEach(e => {
    const s = timeToMinutes(e.startTime), en = timeToMinutes(e.endTime);
    if (nm >= s && nm < en) current = e;
    if (nm < s && (!next || s < timeToMinutes(next.startTime))) next = e;
  });
  return `
    <div class="section-block">
      <h3>Today's Classes &mdash; ${DAY_LABELS[day]}</h3>
      ${current ? `<p><b>Current Class:</b> ${fmtSubject(current)} &middot; Section ${escapeHtml(current.section)} (${current.startTime}-${current.endTime}) in ${escapeHtml(current.room)}</p>` : `<p><b>Current Class:</b> None right now</p>`}
      ${next ? `<p><b>Next Class:</b> ${fmtSubject(next)} &middot; Section ${escapeHtml(next.section)} (${next.startTime}-${next.endTime}) in ${escapeHtml(next.room)}</p>` : `<p><b>Next Class:</b> No more classes today</p>`}
      ${entries.length === 0 ? emptyState("No classes scheduled for today.") : `
      <div class="table-wrap"><table>
        <tr><th>Time</th><th>Subject</th><th>Section</th><th>Room/Lab</th></tr>
        ${entries.map(e => `<tr><td>${e.startTime}-${e.endTime}</td><td>${fmtSubject(e)}</td><td>${escapeHtml(e.section)}</td><td>${escapeHtml(e.room)}</td></tr>`).join("")}
      </table></div>`}
    </div>
  `;
}
function renderFacultyMyTimetable() {
  const sel = appState.facultySelection;
  if (!sel.name) return emptyState("Your account is not linked to a faculty record. Contact Admin.");
  return `<h1 class="page-title">My Timetable</h1><p class="page-subtitle">${escapeHtml(sel.name)}</p>${facultyScheduleHtml(sel.name)}`;
}
function renderFacultyToday() {
  const sel = appState.facultySelection;
  if (!sel.name) return emptyState("Your account is not linked to a faculty record. Contact Admin.");
  return `<h1 class="page-title">Today's Classes</h1>${renderFacultyTodayBlock(sel.name)}`;
}
function renderFacultyAssignedSections() {
  const sel = appState.facultySelection;
  if (!sel.name) return emptyState("Your account is not linked to a faculty record. Contact Admin.");
  const sections = uniqueSorted(ENTRIES.filter(e => e.faculty === sel.name).map(e => e.section));
  return `
    <h1 class="page-title">Assigned Sections</h1>
    <div class="item-grid">
      ${sections.map(s => `<div class="item-tile"><div class="tile-letter">${escapeHtml(s)}</div><div class="tile-label">${escapeHtml(sectionMeta(s) ? sectionMeta(s).programme : "")}</div></div>`).join("")}
    </div>
  `;
}
function renderFacultySubjects() {
  const sel = appState.facultySelection;
  if (!sel.name) return emptyState("Your account is not linked to a faculty record. Contact Admin.");
  const subs = {};
  ENTRIES.filter(e => e.faculty === sel.name).forEach(e => { subs[e.courseCode] = e; });
  return `
    <h1 class="page-title">Subjects Taught</h1>
    <div class="table-wrap"><table>
      <tr><th>Course Code</th><th>Subject</th><th>Type</th><th>Sections</th></tr>
      ${Object.values(subs).map(e => `<tr><td>${escapeHtml(e.courseCode)}</td><td>${fmtSubject(e)}</td><td><span class="badge ${e.type === "Lab" ? "badge-lab" : "badge-theory"}">${escapeHtml(e.type)}</span></td>
        <td>${uniqueSorted(ENTRIES.filter(x => x.faculty === sel.name && x.courseCode === e.courseCode).map(x => x.section)).join(", ")}</td></tr>`).join("")}
    </table></div>
  `;
}
function renderFacultyRooms() {
  const sel = appState.facultySelection;
  if (!sel.name) return emptyState("Your account is not linked to a faculty record. Contact Admin.");
  const rooms = uniqueSorted(ENTRIES.filter(e => e.faculty === sel.name).map(e => e.room));
  return `
    <h1 class="page-title">Rooms / Labs Used</h1>
    <div class="table-wrap"><table>
      <tr><th>Room/Lab</th><th>Classes Held</th></tr>
      ${rooms.map(r => `<tr><td>${escapeHtml(r)}</td><td>${ENTRIES.filter(e => e.faculty === sel.name && e.room === r).length}</td></tr>`).join("")}
    </table></div>
  `;
}

// ---------------------------------------------------------------------------
// EMPTY STATE
// ---------------------------------------------------------------------------
function emptyState(msg) {
  return `<div class="empty-state"><div class="icon">&#128203;</div><p>${escapeHtml(msg)}</p></div>`;
}

// ---------------------------------------------------------------------------
// GLOBAL SEARCH
// ---------------------------------------------------------------------------
function globalSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ENTRIES.filter(e =>
    e.section.toLowerCase().includes(q) ||
    e.subject.toLowerCase().includes(q) ||
    e.courseCode.toLowerCase().includes(q) ||
    e.faculty.toLowerCase().includes(q) ||
    e.room.toLowerCase().includes(q) ||
    e.day.toLowerCase().includes(q) ||
    DAY_LABELS[e.day].toLowerCase().includes(q) ||
    e.startTime.includes(q)
  ).slice(0, 30);
}
function initGlobalSearch() {
  const input = document.getElementById("globalSearchInput");
  const results = document.getElementById("globalSearchResults");
  input.addEventListener("input", () => {
    const matches = globalSearch(input.value);
    if (!input.value.trim()) { results.classList.add("hidden"); results.innerHTML = ""; return; }
    if (matches.length === 0) {
      results.innerHTML = `<div class="search-result-item">No results found.</div>`;
    } else {
      results.innerHTML = matches.map(e => `
        <div class="search-result-item">
          <b>${escapeHtml(e.section)}</b> &middot; ${escapeHtml(e.courseCode)} &mdash; ${fmtSubject(e)}<br>
          ${DAY_LABELS[e.day]}, ${e.startTime}-${e.endTime} &middot; ${escapeHtml(e.faculty)} &middot; ${escapeHtml(e.room)}
        </div>`).join("");
    }
    results.classList.remove("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".topbar-search")) results.classList.add("hidden");
  });
}

// ---------------------------------------------------------------------------
// ENTRY MODAL (ADD / EDIT)
// ---------------------------------------------------------------------------
function openEntryModal(entryId) {
  const sectionSelect = document.getElementById("entrySection");
  sectionSelect.innerHTML = allSectionNames().map(s => `<option>${escapeHtml(s)}</option>`).join("");
  const periodSelect = document.getElementById("entryPeriod");
  periodSelect.innerHTML = PERIODS.filter(p => p.key !== "BREAK" && p.key !== "LUNCH")
    .map(p => `<option value="${p.key}">${p.key} (${p.start}-${p.end})</option>`).join("");

  document.getElementById("conflictWarning").classList.add("hidden");
  document.getElementById("entryForm").reset();

  if (entryId) {
    const e = ENTRIES.find(x => x.id === entryId);
    document.getElementById("entryModalTitle").textContent = "Edit Timetable Entry";
    document.getElementById("entryId").value = e.id;
    document.getElementById("entrySection").value = e.section;
    document.getElementById("entryDay").value = e.day;
    document.getElementById("entryPeriod").value = e.period.length === 4 ? e.period.substring(0, 2) : e.period;
    document.getElementById("entryType").value = e.type;
    document.getElementById("entryCourseCode").value = e.courseCode;
    document.getElementById("entrySubject").value = e.subject;
    document.getElementById("entryFaculty").value = e.faculty;
    document.getElementById("entryRoom").value = e.room;
  } else {
    document.getElementById("entryModalTitle").textContent = "Add Timetable Entry";
    document.getElementById("entryId").value = "";
    document.getElementById("entrySection").value = appState.adminTTSection || allSectionNames()[0];
  }
  document.getElementById("entryModal").classList.remove("hidden");
}
function closeEntryModal() { document.getElementById("entryModal").classList.add("hidden"); }

function saveEntryFromForm() {
  const id = document.getElementById("entryId").value;
  const section = document.getElementById("entrySection").value;
  const day = document.getElementById("entryDay").value;
  const period = document.getElementById("entryPeriod").value;
  const type = document.getElementById("entryType").value;
  const courseCode = document.getElementById("entryCourseCode").value.trim();
  const subject = document.getElementById("entrySubject").value.trim();
  const faculty = document.getElementById("entryFaculty").value.trim();
  const room = document.getElementById("entryRoom").value.trim();
  const p = periodInfo(period);
  const meta = sectionMeta(section);

  const candidate = {
    id: id ? Number(id) : nextEntryId(),
    section, department: meta ? meta.department : "", programme: meta ? meta.programme : "",
    year: meta ? meta.year : "", semester: meta ? meta.semester : "",
    day, period, startTime: p.start, endTime: p.end,
    courseCode, subject, faculty, room, type,
  };

  const conflicts = checkConflictForCandidate(candidate);
  if (conflicts.length > 0) {
    const warningBox = document.getElementById("conflictWarning");
    warningBox.classList.remove("hidden");
    warningBox.textContent = "Conflict detected:\n" + conflicts.map(c => `- ${c.type}: ${c.detail}`).join("\n") + "\n\nClick Save Entry again to continue anyway, or Cancel to fix it.";
    if (!candidate._confirmedOverride) {
      candidate._confirmedOverride = true;
      pendingCandidate = candidate;
      return;
    }
  }
  commitEntry(candidate, !!id);
}
let pendingCandidate = null;
function checkConflictForCandidate(candidate) {
  // Lab hours are intentionally excluded from conflict detection.
  if (candidate.type === "Lab") return [];
  const others = ENTRIES.filter(e => e.id !== candidate.id && e.type !== "Lab" && e.day === candidate.day && rangesOverlap(e.startTime, e.endTime, candidate.startTime, candidate.endTime));
  const conflicts = [];
  others.forEach(e => {
    if (e.faculty === candidate.faculty && e.section !== candidate.section) {
      conflicts.push({ type: "Faculty Conflict", detail: `${candidate.faculty} already teaches Section ${e.section} at this time.` });
    }
    if (e.room === candidate.room && e.section !== candidate.section) {
      conflicts.push({ type: "Room/Lab Conflict", detail: `${candidate.room} is already booked for Section ${e.section} at this time.` });
    }
    if (e.section === candidate.section && e.courseCode !== candidate.courseCode) {
      conflicts.push({ type: "Section Conflict", detail: `Section ${candidate.section} already has ${e.courseCode} at this time.` });
    }
  });
  return conflicts;
}
function commitEntry(candidate, isEdit) {
  delete candidate._confirmedOverride;
  if (isEdit) {
    const idx = ENTRIES.findIndex(e => e.id === candidate.id);
    if (idx >= 0) ENTRIES[idx] = candidate;
  } else {
    ENTRIES.push(candidate);
  }
  saveEntries(ENTRIES);
  closeEntryModal();
  showToast(isEdit ? "Timetable entry updated." : "Timetable entry added.", "success");
  pendingCandidate = null;
  renderCurrentView();
}
function deleteEntry(id) {
  confirmDialog("Delete this timetable entry? This cannot be undone.", () => {
    ENTRIES = ENTRIES.filter(e => e.id !== id);
    saveEntries(ENTRIES);
    showToast("Timetable entry deleted.", "success");
    renderCurrentView();
  });
}

// ---------------------------------------------------------------------------
// PRINT
// ---------------------------------------------------------------------------
function printCurrentSection() { window.print(); }

// ---------------------------------------------------------------------------
// VIEW-SPECIFIC EVENT WIRING
// ---------------------------------------------------------------------------
function attachViewHandlers(view, role) {
  // Generic: navigate to section from tiles
  document.querySelectorAll("[data-goto-section]").forEach(el => {
    el.addEventListener("click", () => {
      const section = el.dataset.gotoSection;
      if (role === "Admin") {
        appState.currentView = "timetable";
        appState.adminTTSection = section;
        renderCurrentView();
      }
    });
  });

  if (role === "Admin" && view === "dashboard") {
    const addBtn = document.getElementById("qaAddEntry");
    if (addBtn) addBtn.addEventListener("click", () => openEntryModal(null));
    const confBtn = document.getElementById("qaViewConflicts");
    if (confBtn) confBtn.addEventListener("click", () => { appState.currentView = "conflicts"; renderCurrentView(); });
    const repBtn = document.getElementById("qaReports");
    if (repBtn) repBtn.addEventListener("click", () => { appState.currentView = "reports"; renderCurrentView(); });
  }

  if (role === "Admin" && view === "timetable") {
    const sectionFilter = document.getElementById("ttSectionFilter");
    const deptFilter = document.getElementById("ttDeptFilter");
    const gridWrap = document.getElementById("adminTimetableGridWrap");
    const renderGrid = () => {
      let section = sectionFilter.value;
      appState.adminTTSection = section;
      gridWrap.innerHTML = renderAdminTimetableGrid(section);
      wireGridEditDelete();
    };
    sectionFilter.addEventListener("change", renderGrid);
    deptFilter.addEventListener("change", () => {
      const dept = deptFilter.value;
      const opts = dept ? SECTIONS.filter(s => s.programme === dept).map(s => s.section) : allSectionNames();
      sectionFilter.innerHTML = opts.map(s => `<option>${escapeHtml(s)}</option>`).join("");
      renderGrid();
    });
    document.getElementById("addEntryBtn").addEventListener("click", () => openEntryModal(null));
    document.getElementById("printTimetableBtn").addEventListener("click", printCurrentSection);
    renderGrid();
  }

  if (role === "Admin" && view === "sections") {
    document.querySelectorAll("[data-delete-section]").forEach(btn => {
      btn.addEventListener("click", () => {
        const sec = btn.dataset.deleteSection;
        confirmDialog(`Delete Section ${sec}? Its timetable entries will also be removed.`, () => {
          SECTIONS = SECTIONS.filter(s => s.section !== sec);
          ENTRIES = ENTRIES.filter(e => e.section !== sec);
          saveSections(SECTIONS); saveEntries(ENTRIES);
          showToast(`Section ${sec} deleted.`, "success");
          renderCurrentView();
        });
      });
    });
    document.querySelectorAll("[data-edit-section]").forEach(btn => {
      btn.addEventListener("click", () => {
        const sec = btn.dataset.editSection;
        const meta = sectionMeta(sec);
        const newIncharge = prompt("Edit class in-charge for Section " + sec, meta.incharge);
        if (newIncharge !== null && newIncharge.trim()) {
          meta.incharge = newIncharge.trim();
          saveSections(SECTIONS);
          showToast("Section updated.", "success");
          renderCurrentView();
        }
      });
    });
    const addSectionBtn = document.getElementById("addSectionBtn");
    if (addSectionBtn) addSectionBtn.addEventListener("click", () => {
      const letter = prompt("New section letter (e.g. M):");
      if (!letter) return;
      const sec = letter.trim().toUpperCase();
      if (!sec) return;
      if (SECTIONS.find(s => s.section === sec)) { showToast("Section already exists.", "error"); return; }
      SECTIONS.push({ section: sec, department: "School of Computational Intelligence", programme: "B.Tech CSE", year: "III", semester: "V", room: "Needs Verification", incharge: "Needs Verification", subjects: [] });
      saveSections(SECTIONS);
      showToast(`Section ${sec} added.`, "success");
      renderCurrentView();
    });
  }

  if (role === "Admin" && view === "faculty") {
    const select = document.getElementById("facultySelect");
    const searchInput = document.getElementById("facultySearchInput");
    select.addEventListener("change", () => {
      appState.selectedFaculty = select.value;
      document.getElementById("facultyScheduleResult").innerHTML = select.value ? facultyScheduleHtml(select.value) : emptyState("Select a faculty member to see their schedule.");
    });
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      const matches = allFacultyNames().filter(f => f.toLowerCase().includes(q));
      select.innerHTML = `<option value="">-- Select Faculty --</option>` + matches.map(f => `<option>${escapeHtml(f)}</option>`).join("");
    });

    const createBtn = document.getElementById("createFacultyAccountBtn");
    if (createBtn) {
      createBtn.addEventListener("click", async () => {
        const name = document.getElementById("newFacultyAccountSelect").value;
        if (!name) { showToast("Select a faculty member first.", "error"); return; }
        const res = await AUTH.createFacultyAccount(name);
        if (!res.ok) { showToast(res.error, "error"); return; }
        alert(
          `Faculty account created for ${res.facultyName}.\n\n` +
          `Username: ${res.username}\nPassword: ${res.password}\n\n` +
          `Copy these now and send them to the faculty member by email — the password will not be shown again.`
        );
        showToast("Faculty account created.", "success");
        renderCurrentView();
      });
    }
    document.querySelectorAll(".reset-fac-pass-link").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const username = link.dataset.username;
        confirmDialog(`Reset the password for "${username}"? A new password will be generated.`, async () => {
          const res = await AUTH.resetFacultyPassword(username);
          if (!res.ok) { showToast(res.error, "error"); return; }
          alert(`New password for ${username}:\n\n${res.password}\n\nCopy this now and send it to the faculty member — it will not be shown again.`);
          showToast("Password reset.", "success");
        });
      });
    });
    document.querySelectorAll(".remove-fac-acc-link").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const username = link.dataset.username;
        confirmDialog(`Remove the login account "${username}"? That faculty member will no longer be able to log in.`, () => {
          AUTH.removeFacultyAccount(username);
          showToast("Faculty account removed.", "success");
          renderCurrentView();
        });
      });
    });
  }

  if (role === "Admin" && (view === "classrooms" || view === "labs")) {
    const select = document.getElementById("roomSelect");
    select.addEventListener("change", () => {
      appState.selectedRoom = select.value;
      document.getElementById("roomScheduleResult").innerHTML = select.value ? roomScheduleHtml(select.value, select.dataset.kind) : emptyState("Select a room or lab to view its schedule.");
    });
  }

  if (role === "Admin" && view === "reports") {
    document.getElementById("reportType").addEventListener("change", populateReportValues);
    document.getElementById("reportValue").addEventListener("change", renderReportResult);
    document.getElementById("printReportBtn").addEventListener("click", printCurrentSection);
    populateReportValues();
  }

  if (role === "Admin" && view === "settings") {
    document.getElementById("resetDataBtn").addEventListener("click", () => {
      confirmDialog("Reset all timetable data to the original PDF-based dataset? Any manual changes will be lost.", resetData);
    });
    document.getElementById("adminChangePasswordForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = document.getElementById("adminCurPass").value;
      const next = document.getElementById("adminNewPass").value;
      const next2 = document.getElementById("adminNewPass2").value;
      const errEl = document.getElementById("adminPassError");
      const res = await AUTH.changeAdminPassword(cur, next, next2);
      if (!res.ok) { errEl.textContent = res.error; errEl.classList.remove("hidden"); return; }
      errEl.classList.add("hidden");
      appState.currentUser.mustChangePassword = false;
      sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(appState.currentUser));
      showToast("Admin password updated.", "success");
      renderCurrentView();
    });
  }

  if (role === "Student" && (view === "dashboard" || view === "student-section")) {
    const confirmBtn = document.getElementById("stuConfirmBtn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        const section = document.getElementById("stuSection").value;
        if (!section) { showToast("Please select a section.", "error"); return; }
        const meta = sectionMeta(section);
        appState.studentSelection = { department: meta.programme, year: meta.year, semester: meta.semester, section };
        showToast(`Section ${section} selected.`, "success");
        appState.currentView = "dashboard";
        renderCurrentView();
      });
    }
  }

  wireGridEditDelete();
}
function wireGridEditDelete() {
  document.querySelectorAll(".edit-entry-link").forEach(link => {
    link.addEventListener("click", (e) => { e.preventDefault(); openEntryModal(Number(link.dataset.id)); });
  });
  document.querySelectorAll(".delete-entry-link").forEach(link => {
    link.addEventListener("click", (e) => { e.preventDefault(); deleteEntry(Number(link.dataset.id)); });
  });
}

// ---------------------------------------------------------------------------
// GLOBAL EVENT WIRING (modal open/close, sidebar toggle, clock, logout)
// ---------------------------------------------------------------------------
function initGlobalUI() {
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("closeEntryModal").addEventListener("click", closeEntryModal);
  document.getElementById("cancelEntryBtn").addEventListener("click", closeEntryModal);
  document.getElementById("entryForm").addEventListener("submit", (e) => { e.preventDefault(); saveEntryFromForm(); });

  document.getElementById("mobileSidebarToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  setInterval(updateClock, 1000 * 30);
  updateClock();
}
function updateClock() {
  const el = document.getElementById("topbarClock");
  if (el) el.textContent = new Date().toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initLandingAndLogin();
  initGlobalUI();
  initGlobalSearch();
});
