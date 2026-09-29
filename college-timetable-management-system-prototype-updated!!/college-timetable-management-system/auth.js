// ============================================================================
// auth.js  —  College Timetable Management System
// Authentication & account storage for the three roles: Student, Faculty, Admin.
//
// IMPORTANT (read this before relying on this file for production use):
// This project has no server/backend — it is a static HTML/CSS/JS prototype.
// Everything here (accounts, password hashes, sessions) lives in the
// visitor's own browser (localStorage / sessionStorage). That is enough to
// simulate real role separation and to stop *casual* misuse (students can't
// see faculty data, faculty can't see each other's data, nobody can see
// Admin data without the Admin password) but it cannot stop someone who
// opens the browser DevTools console on their own machine from inspecting
// or overwriting local values. Genuine, tamper-proof security (the kind a
// real deployment needs) requires a real backend that issues session
// tokens and re-checks the user's role on every request, so nothing about
// access control ever depends on code running in the browser. Treat this
// as the strongest possible approximation of that for a front-end-only
// class prototype, not as production-grade security.
// ============================================================================

(function () {
  "use strict";

  const AUTH_KEYS = {
    students: "ctms_students_v1",
    faculty: "ctms_faculty_accounts_v1",
    admin: "ctms_admin_account_v1",
  };

  const COLLEGE_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@joyuniversity\.edu\.in$/i;

  // ---------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function getStudents() { return readJSON(AUTH_KEYS.students, {}); }
  function saveStudents(obj) { writeJSON(AUTH_KEYS.students, obj); }
  function getFacultyAccounts() { return readJSON(AUTH_KEYS.faculty, {}); }
  function saveFacultyAccounts(obj) { writeJSON(AUTH_KEYS.faculty, obj); }
  function getAdminAccount() { return readJSON(AUTH_KEYS.admin, null); }
  function saveAdminAccount(obj) { writeJSON(AUTH_KEYS.admin, obj); }

  // ---------------------------------------------------------------------
  // Crypto helpers — salted SHA-256. Falls back to a non-cryptographic
  // hash only if Web Crypto is unavailable (e.g. some file:// contexts),
  // purely so the prototype keeps working; note this in the README too.
  // ---------------------------------------------------------------------
  function randomToken(len) {
    len = len || 16;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(len);
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    } else {
      for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function generatePassword(length) {
    length = length || 10;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    let out = "";
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(length);
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
    } else {
      for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function simpleFallbackHash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }

  async function sha256Hex(text) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const enc = new TextEncoder().encode(text);
        const buf = await window.crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
      } catch (e) { /* fall through to fallback */ }
    }
    return simpleFallbackHash(text);
  }

  async function hashPassword(password, salt) { return sha256Hex(salt + ":" + password); }
  async function verifyPassword(password, salt, hash) { return (await hashPassword(password, salt)) === hash; }

  // ---------------------------------------------------------------------
  // Seed the Admin account the first time the app ever runs in this
  // browser. Credentials are generated by the "system" (not chosen by a
  // student/faculty, and never exposed anywhere in the Student/Faculty
  // UI). The Admin is prompted to change this password on first login.
  // ---------------------------------------------------------------------
  const DEFAULT_ADMIN_USERNAME = "admin";
  const DEFAULT_ADMIN_PASSWORD = "JoyAdmin@2026";

  async function ensureAdminSeeded() {
    let acc = getAdminAccount();
    if (!acc) {
      const salt = randomToken(12);
      const hash = await hashPassword(DEFAULT_ADMIN_PASSWORD, salt);
      acc = { username: DEFAULT_ADMIN_USERNAME, salt, hash, mustChangePassword: true, createdAt: Date.now() };
      saveAdminAccount(acc);
    }
    return acc;
  }
  const adminReady = ensureAdminSeeded();

  // ---------------------------------------------------------------------
  // Public AUTH API
  // ---------------------------------------------------------------------
  const AUTH = {
    isCollegeEmail(email) {
      return COLLEGE_EMAIL_RE.test(String(email || "").trim());
    },
    isStrongPassword(pw) {
      return typeof pw === "string" && pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
    },

    // ---- Student: self-service signup using ONLY the college email ----
    async signupStudent(email, name, password, confirmPassword) {
      email = String(email || "").trim().toLowerCase();
      name = String(name || "").trim();
      if (!this.isCollegeEmail(email)) {
        return { ok: false, error: "Only official college emails ending with @joyuniversity.edu.in are allowed." };
      }
      if (!name) return { ok: false, error: "Please enter your full name." };
      if (password !== confirmPassword) return { ok: false, error: "Passwords do not match." };
      if (!this.isStrongPassword(password)) {
        return { ok: false, error: "Password must be at least 8 characters and include a letter and a number." };
      }
      const students = getStudents();
      if (students[email]) {
        return { ok: false, error: "An account already exists for this email. Please log in instead." };
      }
      const salt = randomToken(12);
      const hash = await hashPassword(password, salt);
      students[email] = { email, name, salt, hash, createdAt: Date.now() };
      saveStudents(students);
      return { ok: true };
    },

    async loginStudent(email, password) {
      email = String(email || "").trim().toLowerCase();
      if (!this.isCollegeEmail(email)) {
        return { ok: false, error: "Only official college emails ending with @joyuniversity.edu.in are allowed." };
      }
      const rec = getStudents()[email];
      if (!rec) return { ok: false, error: "No account found for this email. Please create a password first." };
      const match = await verifyPassword(password, rec.salt, rec.hash);
      if (!match) return { ok: false, error: "Incorrect email or password." };
      return { ok: true, user: { role: "Student", email: rec.email, displayName: rec.name || rec.email } };
    },

    // ---- Faculty: accounts are created ONLY by Admin, never self-service ----
    async loginFaculty(username, password) {
      username = String(username || "").trim().toLowerCase();
      const rec = getFacultyAccounts()[username];
      if (!rec) return { ok: false, error: "Incorrect username or password." };
      const match = await verifyPassword(password, rec.salt, rec.hash);
      if (!match) return { ok: false, error: "Incorrect username or password." };
      return { ok: true, user: { role: "Faculty", username: rec.username, facultyName: rec.facultyName, displayName: rec.facultyName } };
    },

    // ---- Admin: single system-created account, credentials never shown to Student/Faculty UI ----
    async loginAdmin(username, password) {
      await adminReady;
      const acc = getAdminAccount();
      username = String(username || "").trim().toLowerCase();
      if (!acc || username !== acc.username.toLowerCase()) return { ok: false, error: "Incorrect username or password." };
      const match = await verifyPassword(password, acc.salt, acc.hash);
      if (!match) return { ok: false, error: "Incorrect username or password." };
      return { ok: true, user: { role: "Admin", username: acc.username, displayName: "Administrator", mustChangePassword: !!acc.mustChangePassword } };
    },

    async changeAdminPassword(currentPassword, newPassword, confirmPassword) {
      await adminReady;
      const acc = getAdminAccount();
      const match = await verifyPassword(currentPassword, acc.salt, acc.hash);
      if (!match) return { ok: false, error: "Current password is incorrect." };
      if (newPassword !== confirmPassword) return { ok: false, error: "New passwords do not match." };
      if (!this.isStrongPassword(newPassword)) {
        return { ok: false, error: "New password must be at least 8 characters and include a letter and a number." };
      }
      acc.salt = randomToken(12);
      acc.hash = await hashPassword(newPassword, acc.salt);
      acc.mustChangePassword = false;
      saveAdminAccount(acc);
      return { ok: true };
    },

    // ---- Admin-only faculty account management ----
    // Callers are responsible for checking the current session's role is
    // "Admin" before invoking these (script.js only wires these buttons
    // into Admin-only views/handlers).
    listFacultyAccounts() {
      return Object.values(getFacultyAccounts()).sort((a, b) => a.facultyName.localeCompare(b.facultyName));
    },
    facultyNamesWithoutAccount(allNames) {
      const taken = new Set(Object.values(getFacultyAccounts()).map(a => a.facultyName));
      return allNames.filter(n => !taken.has(n));
    },
    async createFacultyAccount(facultyName) {
      facultyName = String(facultyName || "").trim();
      if (!facultyName) return { ok: false, error: "Select a faculty member." };
      const accounts = getFacultyAccounts();
      if (Object.values(accounts).some(a => a.facultyName === facultyName)) {
        return { ok: false, error: "This faculty member already has an account." };
      }
      let base = facultyName.toLowerCase().replace(/^dr\.?|^mr\.?|^ms\.?|^mrs\.?/i, "").replace(/[^a-z]/g, "");
      if (!base) base = "faculty";
      let username = base, i = 1;
      while (accounts[username]) { username = base + (i++); }
      const password = generatePassword(10);
      const salt = randomToken(12);
      const hash = await hashPassword(password, salt);
      accounts[username] = { username, facultyName, salt, hash, createdAt: Date.now() };
      saveFacultyAccounts(accounts);
      return { ok: true, username, password, facultyName };
    },
    async resetFacultyPassword(username) {
      const accounts = getFacultyAccounts();
      const rec = accounts[username];
      if (!rec) return { ok: false, error: "Account not found." };
      const password = generatePassword(10);
      rec.salt = randomToken(12);
      rec.hash = await hashPassword(password, rec.salt);
      saveFacultyAccounts(accounts);
      return { ok: true, username, password };
    },
    removeFacultyAccount(username) {
      const accounts = getFacultyAccounts();
      if (!accounts[username]) return { ok: false, error: "Account not found." };
      delete accounts[username];
      saveFacultyAccounts(accounts);
      return { ok: true };
    },
  };

  window.AUTH = AUTH;
})();
