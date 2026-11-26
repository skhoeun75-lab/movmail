'use strict';
/* ============================================================================
   MovMail Admin — separate admin panel for MovMail.
   CONFIG: change the proxy base URL below if the admin API moves.
   ============================================================================ */
const API_BASE = 'https://movmail-proxy.onrender.com'; // <-- Admin API base URL (configurable)

/* Admin login name — the admin account is always this name. */
const ADMIN_NAME = 'Sokhoeun';

/* localStorage keys (all on the admin device only — nothing leaves the device
   except the X-Admin-Token header on admin API calls). */
const LS_SETUP   = 'movmail_admin_setup';   // {name, salt, hash, createdAt} — hash only, NEVER plaintext
const LS_TOKEN   = 'movmail_admin_token';   // Admin API token (set by the admin in Settings)
const LS_LANG    = 'movmail_admin_lang';    // 'km' | 'en'
const SS_SESSION = 'movmail_admin_session'; // '1' while logged in (sessionStorage)

/* ============================================================================
   SHA-256 (pure JS, sync — works in every browser and in headless tests).
   Passwords are stored ONLY as salted SHA-256: sha256Hex(salt + ':' + password).
   ============================================================================ */
function sha256Hex(ascii) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  var maxWord = Math.pow(2, 32), result = '';
  var words = [], bitLen = ascii.length * 8;
  var hash = sha256Hex.h = sha256Hex.h || [], k = sha256Hex.k = sha256Hex.k || [];
  var primeCounter = k.length, isComposite = {};
  for (var cand = 2; primeCounter < 64; cand++) {
    if (!isComposite[cand]) {
      for (var i = 0; i < 313; i += cand) isComposite[i] = cand;
      hash[primeCounter] = (Math.pow(cand, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(cand, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (var i = 0; i < ascii.length; i++) {
    var j = ascii.charCodeAt(i);
    if (j >> 8) return ''; // non-ASCII byte — caller must UTF-8 encode first
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (bitLen / maxWord) | 0;
  words[words.length] = bitLen;
  for (var j = 0; j < words.length;) {
    var w = words.slice(j, j += 16), oldHash = hash;
    hash = hash.slice(0, 8);
    for (var i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
      var temp1 = hash[7]
        + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (var i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (var i = 0; i < 8; i++) for (var j = 3; j + 1; j--) {
    var b = (hash[i] >> (j * 8)) & 255;
    result += (b < 16 ? '0' : '') + b.toString(16);
  }
  return result;
}
function hashPassword(password, salt) {
  // UTF-8 encode so any characters (incl. Khmer) hash correctly.
  return sha256Hex(unescape(encodeURIComponent(salt + ':' + password)));
}
function makeSalt() {
  var bytes = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

/* ============================================================================
   i18n — Khmer default, English toggle. Persisted in localStorage.
   ============================================================================ */
const I18N = {
  km: {
    adminPanel: 'ផ្ទាំងគ្រប់គ្រង', adminOnly: 'សម្រាប់តែអ្នកគ្រប់គ្រង MovMail ប៉ុណ្ណោះ',
    setupNote: 'លើកដំបូង៖ កំណត់ពាក្យសម្ងាត់អ្នកគ្រប់គ្រងរបស់អ្នក។ ពាក្យសម្ងាត់នេះរក្សាទុកតែក្នុងឧបករណ៍នេះប៉ុណ្ណោះ (ជា hash)។',
    name: 'ឈ្មោះ', password: 'ពាក្យសម្ងាត់', confirmPassword: 'បញ្ជាក់ពាក្យសម្ងាត់',
    savePassword: 'រក្សាទុកពាក្យសម្ងាត់', login: 'ចូលប្រើ', signOut: 'ចាកចេញ',
    totalUsers: 'អ្នកប្រើសរុប', activeToday: 'សកម្មថ្ងៃនេះ', pendingReceipts: 'វិក្កយបត្ររង់ចាំ', activeCodes: 'កូដសកម្ម',
    users: 'អ្នកប្រើប្រាស់', codes: 'កូដ', receipts: 'វិក្កយបត្រ', settings: 'ការកំណត់',
    searchPlaceholder: 'ស្វែងរកតាមឈ្មោះ / Gmail / ប្រទេស…',
    filterAll: 'ទាំងអស់', filterNormal: 'ធម្មតា', filterRisk: 'មានហានិភ័យ', filterBlocked: 'បានបិទ',
    refresh: 'ធ្វើឱ្យថ្មី', country: 'ប្រទេស', city: 'ទីក្រុង', device: 'ឧបករណ៍', connection: 'ការតភ្ជាប់',
    registered: 'ចុះឈ្មោះ', plan: 'កញ្ចប់', status: 'ស្ថានភាព', noUsers: 'មិនមានអ្នកប្រើប្រាស់ទេ',
    normal: 'ធម្មតា', blocked: 'បានបិទ', risk: 'មានហានិភ័យ',
    block: 'បិទគណនី', unblock: 'បើកគណនីវិញ', confirmBlock: 'បញ្ជាក់ការបិទ',
    blockReason: 'មូលហេតុបិទ', blockReasonPh: 'ឧ. ប៉ុនប៉ង hack ដើម្បីប្រើមិនកំណត់',
    securityEvents: 'ព្រឹត្តិការណ៍សុវត្ថិភាព', noSecurityEvents: 'មិនមានព្រឹត្តិការណ៍សុវត្ថិភាពទេ',
    generateCode: 'បង្កើតកូដថ្មី', usesPerDay: 'ចំនួនប្រើក្នុងមួយថ្ងៃ (10–100)', expiry: 'ផុតកំណត់',
    generate: 'បង្កើត', yourCode: 'កូដរបស់អ្នក៖', copy: 'ចម្លង', copied: 'បានចម្លង',
    codesList: 'បញ្ជីកូដ', noCodes: 'មិនមានកូដទេ',
    active: 'សកម្ម', used: 'បានប្រើ', disabled: 'បានបិទ', expired: 'ផុតកំណត់',
    disable: 'បិទ', activate: 'ធ្វើឱ្យសកម្ម', usedBy: 'ប្រើដោយ', expires: 'ផុតកំណត់', created: 'បង្កើត',
    pendingReceiptsTitle: 'វិក្កយបត្ររង់ចាំការអនុម័ត',
    receiptNote: 'ចុចលើរូបភាពដើម្បីមើលធំ។ សូមពិនិត្យដោយខ្លួនឯងថាវិក្កយបត្រពិតឬអត់ — ប្រព័ន្ធមិនបានផ្ទៀងផ្ទាត់ដោយស្វ័យប្រវត្តិទេ។',
    noReceipts: 'មិនមានវិក្កយបត្ររង់ចាំទេ', approve: 'អនុម័ត', reject: 'បដិសេធ', method: 'វិធីបង់ប្រាក់',
    apiSettings: 'ការកំណត់ API', apiBaseLabel: 'អាសយដ្ឋាន Proxy API៖', adminToken: 'Admin API Token',
    tokenPlaceholder: 'បិទភ្ជាប់ token នៅទីនេះ',
    tokenNote: 'Token នេះរក្សាទុកតែក្នុងឧបករណ៍នេះ ហើយផ្ញើជា X-Admin-Token លើរាល់ការហៅ API របស់អ្នកគ្រប់គ្រង។',
    save: 'រក្សាទុក', changePassword: 'ប្តូរពាក្យសម្ងាត់', currentPassword: 'ពាក្យសម្ងាត់បច្ចុប្បន្ន',
    newPassword: 'ពាក្យសម្ងាត់ថ្មី', changePasswordBtn: 'ប្តូរពាក្យសម្ងាត់',
    errName: 'ឈ្មោះអ្នកគ្រប់គ្រងត្រូវតែជា Sokhoeun។', errPassShort: 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោចណាស់ 8 តួអក្សរ។',
    errPassMismatch: 'ពាក្យសម្ងាត់ទាំងពីរមិនដូចគ្នាទេ។', errWrongLogin: 'ឈ្មោះ ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។',
    errAmount: 'ចំនួនប្រើក្នុងមួយថ្ងៃត្រូវតែចន្លោះពី 10 ដល់ 100។', errExpiry: 'សូមជ្រើសរើសថ្ងៃផុតកំណត់នៅពេលអនាគត។',
    errNoToken: 'សូមបញ្ចូល Admin API Token ក្នុងការកំណត់ជាមុនសិន។',
    errLoad: 'បរាជ័យក្នុងការទាញទិន្នន័យ។ សូមពិនិត្យ API និង Token រួចព្យាយាមម្តងទៀត។',
    errBlock: 'បរាជ័យក្នុងការបិទ/បើកគណនី។', errCode: 'បរាជ័យក្នុងការបង្កើតកូដ។',
    errReceipt: 'បរាជ័យក្នុងការដំណើរការវិក្កយបត្រ។',
    toastSaved: 'បានរក្សាទុក។', toastBlocked: 'បានបិទគណនី។', toastUnblocked: 'បានបើកគណនីវិញ។',
    toastApproved: 'បានអនុម័ត ហើយផ្ដល់កញ្ចប់។', toastRejected: 'បានបដិសេធវិក្កយបត្រ។',
    toastPassChanged: 'បានប្តូរពាក្យសម្ងាត់។', toastCodeDisabled: 'បានបិទកូដ។', toastCodeActive: 'បានធ្វើឱ្យកូដសកម្មវិញ។',
    lastActive: 'សកម្មចុងក្រោយ', gmail: 'Gmail', ip: 'IP'
  },
  en: {
    adminPanel: 'Admin Panel', adminOnly: 'For the MovMail admin only',
    setupNote: 'First run: set your admin password. It is stored only on this device (as a hash).',
    name: 'Name', password: 'Password', confirmPassword: 'Confirm password',
    savePassword: 'Save password', login: 'Log in', signOut: 'Sign out',
    totalUsers: 'Total users', activeToday: 'Active today', pendingReceipts: 'Pending receipts', activeCodes: 'Active codes',
    users: 'Users', codes: 'Codes', receipts: 'Receipts', settings: 'Settings',
    searchPlaceholder: 'Search by name / Gmail / country…',
    filterAll: 'All', filterNormal: 'Normal', filterRisk: 'At risk', filterBlocked: 'Blocked',
    refresh: 'Refresh', country: 'Country', city: 'City', device: 'Device', connection: 'Connection',
    registered: 'Registered', plan: 'Plan', status: 'Status', noUsers: 'No users yet',
    normal: 'Normal', blocked: 'Blocked', risk: 'At risk',
    block: 'Block account', unblock: 'Unblock account', confirmBlock: 'Confirm block',
    blockReason: 'Block reason', blockReasonPh: 'e.g. tried to hack for unlimited use',
    securityEvents: 'Security events', noSecurityEvents: 'No security events',
    generateCode: 'Generate new code', usesPerDay: 'Uses per day (10–100)', expiry: 'Expiry',
    generate: 'Generate', yourCode: 'Your code:', copy: 'Copy', copied: 'Copied',
    codesList: 'Code list', noCodes: 'No codes yet',
    active: 'Active', used: 'Used', disabled: 'Disabled', expired: 'Expired',
    disable: 'Disable', activate: 'Activate', usedBy: 'Used by', expires: 'Expires', created: 'Created',
    pendingReceiptsTitle: 'Receipts awaiting approval',
    receiptNote: 'Click an image to enlarge it. Please judge yourself whether a receipt is genuine — the system does not verify receipts automatically.',
    noReceipts: 'No pending receipts', approve: 'Approve', reject: 'Reject', method: 'Method',
    apiSettings: 'API settings', apiBaseLabel: 'Proxy API base URL:', adminToken: 'Admin API Token',
    tokenPlaceholder: 'Paste the token here',
    tokenNote: 'This token is stored only on this device and sent as X-Admin-Token on every admin API call.',
    save: 'Save', changePassword: 'Change password', currentPassword: 'Current password',
    newPassword: 'New password', changePasswordBtn: 'Change password',
    errName: 'The admin name must be Sokhoeun.', errPassShort: 'Password must be at least 8 characters.',
    errPassMismatch: 'The two passwords do not match.', errWrongLogin: 'Name or password is incorrect.',
    errAmount: 'Uses per day must be between 10 and 100.', errExpiry: 'Please pick a future expiry date.',
    errNoToken: 'Please enter the Admin API Token in Settings first.',
    errLoad: 'Failed to load data. Check the API and token, then try again.',
    errBlock: 'Failed to block/unblock the account.', errCode: 'Failed to create the code.',
    errReceipt: 'Failed to process the receipt.',
    toastSaved: 'Saved.', toastBlocked: 'Account blocked.', toastUnblocked: 'Account unblocked.',
    toastApproved: 'Approved — plan granted.', toastRejected: 'Receipt rejected.',
    toastPassChanged: 'Password changed.', toastCodeDisabled: 'Code disabled.', toastCodeActive: 'Code activated.',
    lastActive: 'Last active', gmail: 'Gmail', ip: 'IP'
  }
};
let LANG = localStorage.getItem(LS_LANG) || 'km';
function t(key) { return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key; }
function applyI18n() {
  document.documentElement.lang = LANG === 'km' ? 'km' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.dataset.i18nPh); });
  var lt = document.getElementById('langToggle');
  if (lt) lt.textContent = LANG === 'km' ? 'EN' : 'ខ្មែរ';
}

/* ============================================================================
   Helpers
   ============================================================================ */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function show(el, on) { el.hidden = !on; }
function showError(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
var toastTimer = null;
function toast(msg) {
  var el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
}
function fmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString(LANG === 'km' ? 'km-KH' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(LANG === 'km' ? 'km-KH' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}
function flagFor(country, code) {
  var map = { cambodia: 'KH', singapore: 'SG', thailand: 'TH', vietnam: 'VN', 'united states': 'US', usa: 'US', china: 'CN', japan: 'JP', korea: 'KR', india: 'IN', indonesia: 'ID', malaysia: 'MY', philippines: 'PH', myanmar: 'MM', laos: 'LA', taiwan: 'TW', 'hong kong': 'HK', australia: 'AU', 'united kingdom': 'GB', germany: 'DE', france: 'FR', canada: 'CA', brazil: 'BR', russia: 'RU' };
  var cc = (code || map[String(country || '').toLowerCase()] || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) {
    return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65) + ' ';
  }
  return '';
}

/* ============================================================================
   Auth — salted SHA-256 hash in localStorage only. No plaintext anywhere.
   ============================================================================ */
function getSetup() {
  try { return JSON.parse(localStorage.getItem(LS_SETUP) || 'null'); } catch (e) { return null; }
}
function getToken() { return localStorage.getItem(LS_TOKEN) || ''; }
function isLoggedIn() { return sessionStorage.getItem(SS_SESSION) === '1'; }

function showAuth() {
  show($('view-auth'), true); show($('view-app'), false); show($('signOutBtn'), false);
  var setup = getSetup();
  show($('setupForm'), !setup); show($('loginForm'), !!setup);
}
function showApp() {
  show($('view-auth'), false); show($('view-app'), true); show($('signOutBtn'), true);
  loadAll();
}

function onSetupSubmit(e) {
  e.preventDefault();
  var name = $('setupName').value.trim();
  var pass = $('setupPass').value, pass2 = $('setupPass2').value;
  if (name !== ADMIN_NAME) return showError($('setupError'), t('errName'));
  if (pass.length < 8) return showError($('setupError'), t('errPassShort'));
  if (pass !== pass2) return showError($('setupError'), t('errPassMismatch'));
  var salt = makeSalt();
  localStorage.setItem(LS_SETUP, JSON.stringify({
    name: ADMIN_NAME, salt: salt, hash: hashPassword(pass, salt), createdAt: new Date().toISOString()
  }));
  sessionStorage.setItem(SS_SESSION, '1');
  showError($('setupError'), '');
  toast(t('toastSaved'));
  showApp();
}
function onLoginSubmit(e) {
  e.preventDefault();
  var name = $('loginName').value.trim();
  var pass = $('loginPass').value;
  var setup = getSetup();
  if (!setup || name !== setup.name || name !== ADMIN_NAME || hashPassword(pass, setup.salt) !== setup.hash) {
    return showError($('loginError'), t('errWrongLogin'));
  }
  sessionStorage.setItem(SS_SESSION, '1');
  showError($('loginError'), '');
  showApp();
}
function onSignOut() {
  sessionStorage.removeItem(SS_SESSION);
  $('loginPass').value = '';
  showAuth();
}
function onChangePassSubmit(e) {
  e.preventDefault();
  var setup = getSetup();
  var oldPass = $('changePassOld').value, np = $('changePassNew').value, np2 = $('changePassNew2').value;
  if (!setup || hashPassword(oldPass, setup.salt) !== setup.hash) return showError($('changePassError'), t('errWrongLogin'));
  if (np.length < 8) return showError($('changePassError'), t('errPassShort'));
  if (np !== np2) return showError($('changePassError'), t('errPassMismatch'));
  var salt = makeSalt();
  localStorage.setItem(LS_SETUP, JSON.stringify({
    name: ADMIN_NAME, salt: salt, hash: hashPassword(np, salt), createdAt: setup.createdAt
  }));
  $('changePassOld').value = ''; $('changePassNew').value = ''; $('changePassNew2').value = '';
  showError($('changePassError'), '');
  toast(t('toastPassChanged'));
}

/* ============================================================================
   Admin API — every call carries X-Admin-Token (from Settings, never hardcoded).
   ============================================================================ */
async function api(path, options) {
  options = options || {};
  var res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  var text = await res.text(), data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
  return data;
}

/* ============================================================================
   Dashboard data
   ============================================================================ */
var usersCache = [], codesCache = [], receiptsCache = [];

function normUser(u) {
  u = u || {};
  var events = u.securityEvents || u.events || [];
  var blocked = !!u.blocked;
  var risk = !!u.risk || !!u.riskFlag || events.length > 0;
  return {
    name: u.name || u.displayName || '—',
    gmail: u.gmail || u.email || '',
    country: u.country || '', countryCode: u.countryCode || u.country_code || '',
    city: u.city || '', ip: u.ip || u.ipAddress || '',
    device: u.device || u.deviceModel || u.model || '',
    connection: u.connection || u.network || u.connectionType || '',
    registeredAt: u.registeredAt || u.createdAt || u.registered || '',
    lastActiveAt: u.lastActiveAt || u.lastActive || '',
    plan: u.plan || 'Free', blocked: blocked, risk: risk,
    reason: u.blockReason || u.reason || (events.length ? (events[0].type || events[0].message || '') : ''),
    events: events
  };
}
function userStatus(u) { return u.blocked ? 'blocked' : (u.risk ? 'risk' : 'normal'); }

function loadAll() { loadUsers(); loadCodes(); loadReceipts(); }

async function loadUsers() {
  showError($('usersError'), '');
  try {
    var data = await api('/api/admin/users');
    var list = Array.isArray(data) ? data : (data.users || []);
    usersCache = list.map(normUser);
    renderUsers();
    updateStats();
  } catch (e) { showError($('usersError'), t('errLoad')); }
}
async function loadCodes() {
  showError($('codesError'), '');
  try {
    var data = await api('/api/admin/codes');
    codesCache = Array.isArray(data) ? data : (data.codes || []);
    renderCodes();
    updateStats();
  } catch (e) { showError($('codesError'), t('errLoad')); }
}
async function loadReceipts() {
  showError($('receiptsError'), '');
  try {
    var data = await api('/api/admin/receipts');
    var list = Array.isArray(data) ? data : (data.receipts || []);
    receiptsCache = list.map(function (r) {
      return {
        id: r.id, gmail: r.gmail || r.email || '', plan: r.plan || '',
        method: r.method || '', amount: r.amount || '',
        imageUrl: r.imageUrl || r.screenshotUrl || r.image || '',
        createdAt: r.createdAt || r.submittedAt || '', status: (r.status || 'pending').toLowerCase()
      };
    });
    renderReceipts();
    updateStats();
  } catch (e) { showError($('receiptsError'), t('errLoad')); }
}

function updateStats() {
  $('statUsers').textContent = usersCache.length;
  var today = new Date().toDateString();
  $('statActive').textContent = usersCache.filter(function (u) {
    return u.lastActiveAt && new Date(u.lastActiveAt).toDateString() === today;
  }).length;
  $('statReceipts').textContent = receiptsCache.filter(function (r) { return r.status === 'pending'; }).length;
  $('statCodes').textContent = codesCache.filter(function (c) { return codeStatus(c) === 'active'; }).length;
}

/* ---------- Users table ---------- */
function renderUsers() {
  var q = ($('userSearch').value || '').trim().toLowerCase();
  var f = $('userFilter').value;
  var rows = usersCache.filter(function (u) {
    if (f !== 'all' && userStatus(u) !== f) return false;
    if (q && (u.name + ' ' + u.gmail + ' ' + u.country).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  $('usersBody').innerHTML = rows.map(function (u, i) {
    var st = userStatus(u);
    var idx = usersCache.indexOf(u);
    var pill = st === 'normal'
      ? '<span class="pill pill-green">' + esc(t('normal')) + '</span>'
      : '<span class="pill pill-red">' + esc(t(st)) + '</span>';
    var reason = (st !== 'normal' && u.reason) ? '<span class="reason">' + esc(u.reason) + '</span>' : '';
    return '<tr data-idx="' + idx + '" class="row-' + st + '">'
      + '<td>' + esc(u.name) + '</td>'
      + '<td>' + esc(u.gmail) + '</td>'
      + '<td>' + esc(flagFor(u.country, u.countryCode) + u.country) + '</td>'
      + '<td>' + esc(u.city || '—') + '</td>'
      + '<td>' + esc(u.ip || '—') + '</td>'
      + '<td>' + esc(u.device || '—') + '</td>'
      + '<td>' + esc(u.connection || '—') + '</td>'
      + '<td>' + esc(fmtDate(u.registeredAt)) + '</td>'
      + '<td>' + esc(u.plan) + '</td>'
      + '<td>' + pill + reason + '</td></tr>';
  }).join('');
  show($('usersEmpty'), rows.length === 0);
}
function openDrawer(idx) {
  var u = usersCache[idx];
  if (!u) return;
  var st = userStatus(u);
  $('drawerTitle').textContent = u.name + ' — ' + u.gmail;
  $('drawerBody').innerHTML =
    '<dl class="kv">'
    + '<dt>' + esc(t('gmail')) + '</dt><dd>' + esc(u.gmail) + '</dd>'
    + '<dt>' + esc(t('country')) + '</dt><dd>' + esc(flagFor(u.country, u.countryCode) + u.country) + '</dd>'
    + '<dt>' + esc(t('city')) + '</dt><dd>' + esc(u.city || '—') + '</dd>'
    + '<dt>' + esc(t('ip')) + '</dt><dd>' + esc(u.ip || '—') + '</dd>'
    + '<dt>' + esc(t('device')) + '</dt><dd>' + esc(u.device || '—') + '</dd>'
    + '<dt>' + esc(t('connection')) + '</dt><dd>' + esc(u.connection || '—') + '</dd>'
    + '<dt>' + esc(t('registered')) + '</dt><dd>' + esc(fmtDate(u.registeredAt)) + '</dd>'
    + '<dt>' + esc(t('lastActive')) + '</dt><dd>' + esc(fmtDate(u.lastActiveAt)) + '</dd>'
    + '<dt>' + esc(t('plan')) + '</dt><dd>' + esc(u.plan) + '</dd>'
    + '<dt>' + esc(t('status')) + '</dt><dd>' + esc(t(st)) + (u.reason ? ' — ' + esc(u.reason) : '') + '</dd>'
    + '</dl>'
    + '<h2>' + esc(t('securityEvents')) + '</h2>'
    + (u.events.length
      ? '<ul class="events-list">' + u.events.map(function (ev) {
          return '<li>' + esc(ev.type || ev.message || JSON.stringify(ev))
            + '<span class="ev-time">' + esc(fmtDate(ev.at || ev.time || ev.createdAt)) + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="no-events">' + esc(t('noSecurityEvents')) + '</p>');
  $('drawerBody').dataset.idx = idx;
  show($('blockBtn'), !u.blocked);
  show($('unblockBtn'), !!u.blocked);
  show($('blockReasonWrap'), false);
  $('blockReason').value = '';
  $('blockBtn').textContent = t('block');
  showError($('drawerError'), '');
  show($('drawerOverlay'), true);
  $('userDrawer').hidden = false;
}
function closeDrawer() {
  $('userDrawer').hidden = true; show($('drawerOverlay'), false);
}
async function onBlockClick() {
  var idx = Number($('drawerBody').dataset.idx);
  var u = usersCache[idx];
  if (!u) return;
  if ($('blockReasonWrap').hidden) {
    show($('blockReasonWrap'), true);
    $('blockBtn').textContent = t('confirmBlock');
    return;
  }
  var reason = $('blockReason').value.trim();
  try {
    await api('/api/admin/block', { method: 'POST', body: { gmail: u.gmail, blocked: true, reason: reason } });
    toast(t('toastBlocked'));
    closeDrawer();
    loadUsers();
  } catch (e) { showError($('drawerError'), t('errBlock')); }
}
async function onUnblockClick() {
  var idx = Number($('drawerBody').dataset.idx);
  var u = usersCache[idx];
  if (!u) return;
  try {
    await api('/api/admin/block', { method: 'POST', body: { gmail: u.gmail, blocked: false, reason: '' } });
    toast(t('toastUnblocked'));
    closeDrawer();
    loadUsers();
  } catch (e) { showError($('drawerError'), t('errBlock')); }
}

/* ---------- Codes ---------- */
function codeStatus(c) {
  if (c.disabled) return 'disabled';
  if (c.usedBy || c.usedOnceBy || c.used) return 'used';
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return 'expired';
  return (c.status || 'active').toLowerCase();
}
function renderCodes() {
  $('codesList').innerHTML = codesCache.map(function (c) {
    var code = c.code || '';
    var st = codeStatus(c);
    var usedBy = c.usedBy || c.usedOnceBy || '';
    var usedAt = c.usedAt || '';
    var meta = '<span>' + esc(t('usesPerDay')) + ': ' + esc(c.amountPerDay != null ? c.amountPerDay : c.amount || '—') + '</span>'
      + ' · <span>' + esc(t('expires')) + ': ' + esc(fmtDate(c.expiresAt)) + '</span>'
      + ' · <span>' + esc(t('created')) + ': ' + esc(fmtDate(c.createdAt)) + '</span>'
      + (st === 'used' && usedBy ? '<span class="used-by">' + esc(t('usedBy')) + ': ' + esc(usedBy) + (usedAt ? ' · ' + esc(fmtDate(usedAt)) : '') + '</span>' : '');
    var pillCls = st === 'active' ? 'pill-green' : (st === 'disabled' ? 'pill-red' : (st === 'expired' ? 'pill-amber' : 'pill-grey'));
    var action = st === 'disabled'
      ? '<button class="btn btn-secondary" type="button" data-code-action="activate" data-code="' + esc(code) + '">' + esc(t('activate')) + '</button>'
      : '<button class="btn btn-secondary" type="button" data-code-action="disable" data-code="' + esc(code) + '">' + esc(t('disable')) + '</button>';
    return '<div class="code-row status-' + st + '"><code>' + esc(code) + '</code>'
      + '<span class="pill ' + pillCls + '">' + esc(t(st)) + '</span>'
      + '<span class="meta">' + meta + '</span>' + action + '</div>';
  }).join('');
  show($('codesEmpty'), codesCache.length === 0);
}
async function onCodeSubmit(e) {
  e.preventDefault();
  var amount = Number($('codeAmount').value);
  var expiry = $('codeExpiry').value;
  if (!Number.isInteger(amount) || amount < 10 || amount > 100) return showError($('codeError'), t('errAmount'));
  if (!expiry || new Date(expiry) <= new Date()) return showError($('codeError'), t('errExpiry'));
  showError($('codeError'), '');
  try {
    var data = await api('/api/admin/codes', {
      method: 'POST',
      body: { amountPerDay: amount, expiresAt: new Date(expiry).toISOString() }
    });
    var code = (data && (data.code || data.refreshCode)) || '';
    $('newCodeValue').textContent = code;
    show($('newCodeBox'), true);
    $('copyCodeBtn').textContent = t('copy');
    loadCodes();
  } catch (err) { showError($('codeError'), t('errCode')); }
}
async function onCodeActionClick(e) {
  var btn = e.target.closest('[data-code-action]');
  if (!btn) return;
  var code = btn.dataset.code, action = btn.dataset.codeAction;
  try {
    await api('/api/admin/codes/' + encodeURIComponent(code) + '/' + action, { method: 'POST' });
    toast(action === 'disable' ? t('toastCodeDisabled') : t('toastCodeActive'));
    loadCodes();
  } catch (err) { showError($('codesError'), t('errLoad')); }
}

/* ---------- Receipts ---------- */
function renderReceipts() {
  var pending = receiptsCache.filter(function (r) { return r.status === 'pending'; });
  $('receiptsList').innerHTML = pending.map(function (r) {
    return '<div class="receipt-row" data-receipt-id="' + esc(r.id) + '">'
      + (r.imageUrl
        ? '<img class="receipt-thumb" src="' + esc(r.imageUrl) + '" alt="Receipt" data-full="' + esc(r.imageUrl) + '">'
        : '<div class="receipt-thumb"></div>')
      + '<div class="receipt-info">'
      + '<div class="r-gmail">' + esc(r.gmail) + '</div>'
      + '<div class="r-line">' + esc(t('plan')) + ': ' + esc(r.plan) + ' · ' + esc(t('method')) + ': ' + esc(r.method) + (r.amount ? ' · ' + esc(r.amount) : '') + '</div>'
      + '<div class="r-line">' + esc(fmtDate(r.createdAt)) + '</div>'
      + '</div>'
      + '<div class="receipt-actions">'
      + '<button class="btn btn-primary" type="button" data-receipt-action="approve" data-id="' + esc(r.id) + '">' + esc(t('approve')) + '</button>'
      + '<button class="btn btn-danger" type="button" data-receipt-action="reject" data-id="' + esc(r.id) + '">' + esc(t('reject')) + '</button>'
      + '</div></div>';
  }).join('');
  show($('receiptsEmpty'), pending.length === 0);
}
async function onReceiptActionClick(e) {
  var btn = e.target.closest('[data-receipt-action]');
  if (!btn) return;
  var id = btn.dataset.id, action = btn.dataset.receiptAction;
  try {
    await api('/api/admin/receipts/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
    receiptsCache = receiptsCache.filter(function (r) { return String(r.id) !== String(id); });
    renderReceipts();
    updateStats();
    toast(action === 'approve' ? t('toastApproved') : t('toastRejected'));
  } catch (err) { showError($('receiptsError'), t('errReceipt')); }
}
function onReceiptThumbClick(e) {
  var img = e.target.closest('.receipt-thumb[data-full]');
  if (!img) return;
  $('lightboxImg').src = img.dataset.full;
  show($('lightbox'), true);
}

/* ---------- Tabs / settings / misc ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + name; });
  if (name === 'users') loadUsers();
  if (name === 'codes') loadCodes();
  if (name === 'receipts') loadReceipts();
}
function onSaveToken() {
  localStorage.setItem(LS_TOKEN, $('tokenInput').value.trim());
  toast(t('toastSaved'));
  loadAll();
}
function init() {
  applyI18n();
  $('apiBaseShown').textContent = API_BASE;
  $('tokenInput').value = getToken();

  $('langToggle').addEventListener('click', function () {
    LANG = LANG === 'km' ? 'en' : 'km';
    localStorage.setItem(LS_LANG, LANG);
    applyI18n();
    if (isLoggedIn()) { renderUsers(); renderCodes(); renderReceipts(); updateStats(); }
  });
  $('setupForm').addEventListener('submit', onSetupSubmit);
  $('loginForm').addEventListener('submit', onLoginSubmit);
  $('signOutBtn').addEventListener('click', onSignOut);
  $('changePassForm').addEventListener('submit', onChangePassSubmit);
  $('saveTokenBtn').addEventListener('click', onSaveToken);

  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });
  $('userSearch').addEventListener('input', renderUsers);
  $('userFilter').addEventListener('change', renderUsers);
  $('refreshUsersBtn').addEventListener('click', loadUsers);
  $('usersBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-idx]');
    if (tr) openDrawer(Number(tr.dataset.idx));
  });
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerOverlay').addEventListener('click', closeDrawer);
  $('blockBtn').addEventListener('click', onBlockClick);
  $('unblockBtn').addEventListener('click', onUnblockClick);

  $('codeForm').addEventListener('submit', onCodeSubmit);
  $('codesList').addEventListener('click', onCodeActionClick);
  $('copyCodeBtn').addEventListener('click', function () {
    var code = $('newCodeValue').textContent;
    var done = function () { $('copyCodeBtn').textContent = t('copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, done);
    else done();
  });

  $('receiptsList').addEventListener('click', function (e) {
    if (e.target.closest('[data-receipt-action]')) onReceiptActionClick(e);
    else onReceiptThumbClick(e);
  });
  $('lightboxClose').addEventListener('click', function () { show($('lightbox'), false); });
  $('lightbox').addEventListener('click', function (e) { if (e.target === $('lightbox')) show($('lightbox'), false); });

  if (getSetup() && isLoggedIn()) showApp();
  else showAuth();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
