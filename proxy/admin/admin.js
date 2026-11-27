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
    listings: 'បញ្ជីលក់', orders: 'ការបញ្ជាទិញ',
    createListing: 'បង្កើតបញ្ជីលក់ដោយដៃ', createListingBtn: 'បង្កើតបញ្ជីលក់',
    listingEmail: 'អ៊ីមែលលក់', listingEmailPh: 'example@euploading.com',
    listingPassword: 'ពាក្យសម្ងាត់អ៊ីមែល', listingPrice: 'តម្លៃ ($)', listingTitle: 'ចំណងជើង',
    listingLogo: 'រូបសញ្ញា', listingToken: 'Token', listingTokenPh: 'ឧ. 1B Token',
    errLogoTooBig: 'រូបភាពធំពេក (អតិបរមា 5MB)។',
    priceShort: 'តម្លៃ', paid: 'បានបង់', amountMismatch: 'ចំនួនមិនត្រូវគ្នា',
    listingTitlePh: 'ឧ. គណនី PUBG', sellerGmail: 'Gmail អ្នកលក់',
    healthGood: 'ល្អ', healthBad: 'មិនល្អ', healthChecked: 'បានពិនិត្យ',
    listingNew: 'ថ្មី',
    checkHealth: 'ពិនិត្យ', checking: 'កំពុងពិនិត្យ…',
    markBad: 'សម្គាល់មិនល្អ', markGood: 'សម្គាល់ល្អ',
    autoDeleteIn: 'លុបដោយស្វ័យប្រវត្តិក្នុង {n} ម៉ោង',
    autoDeleteSoon: 'លុបដោយស្វ័យប្រវត្តិក្នុងពេលតិចជាង 1 ម៉ោង',
    listingIp: 'IP', listingIpPh: 'ឧ. 103.146.x.x',
    listingCountryCity: 'ប្រទេស / ទីក្រុង', listingCountryCityPh: 'ឧ. Cambodia, Phnom Penh',
    toastHealthChecked: 'បានពិនិត្យសុខភាពរួចហើយ។', toastHealthSet: 'បានកំណត់សុខភាពរួចហើយ។',
    errHealth: 'បរាជ័យក្នុងការពិនិត្យ/កំណត់សុខភាព។',
    listingsList: 'បញ្ជីលក់ទាំងអស់', noListings: 'មិនមានបញ្ជីលក់ទេ',
    ordersTitle: 'ការបញ្ជាទិញពីហាង', noOrders: 'មិនមានការបញ្ជាទិញទេ', buyer: 'អ្នកទិញ',
    orderNote: 'ការអនុម័តការបញ្ជាទិញនឹងលក់អ៊ីមែលនោះឱ្យអ្នកទិញនោះតែម្នាក់គត់ ហើយដកវាចេញពីហាងសាធារណៈ។ សូមពិនិត្យវិក្កយបត្រដោយខ្លួនឯងថាពិតឬអត់។',
    remove: 'ដកចេញ', confirmRemoveListing: 'តើអ្នកពិតជាចង់ដកបញ្ជីលក់នេះចេញមែនទេ?',
    relist: 'ដាក់លក់វិញ', confirmRelist: 'ដាក់អាខោននេះលក់វិញក្នុងហាងមែនទេ? តម្លៃ និងព័ត៌មានដដែល។',
    toastListingRelisted: 'បានដាក់លក់វិញក្នុងហាងហើយ។', errRelist: 'ដាក់លក់វិញមិនបានទេ។',
    sold: 'បានលក់', removed: 'បានដកចេញ', pending: 'រង់ចាំ', approved: 'បានអនុម័ត', rejected: 'បានបដិសេធ',
    errListingFields: 'សូមបំពេញអ៊ីមែល ពាក្យសម្ងាត់ តម្លៃ និងចំណងជើង។',
    errListing: 'បរាជ័យក្នុងការបង្កើតបញ្ជីលក់។', errOrder: 'បរាជ័យក្នុងការដំណើរការការបញ្ជាទិញ។',
    toastListingCreated: 'បានបង្កើតបញ្ជីលក់។', toastListingRemoved: 'បានដកបញ្ជីលក់ចេញ។',
    toastOrderApproved: 'បានអនុម័ត — អ៊ីមែលត្រូវបានលក់ឱ្យអ្នកទិញនេះ។', toastOrderRejected: 'បានបដិសេធការបញ្ជាទិញ។',
    /* v1.8: buyer activation report + delivery evidence (anti-scam). */
    reportWorks: '✅ ដំណើរការ', reportFailed: '❌ មិនដំណើរការ', reportNotYet: 'មិនទាន់រាយការណ៍',
    reportReasonNoCode: 'មិនទទួលបានកូដ', reportReasonVisa: 'ត្រូវដាក់ Visa card', reportReasonCantLogin: 'ចូលមិនបាន', reportReasonOther: 'ផ្សេងៗ',
    evidenceLast: 'សារចុងក្រោយ', evidenceNone: 'មិនទាន់មានសារមកដល់ក្រោយពេលទិញទេ', evidenceMsgs: 'សារក្រោយពេលទិញ',
    mismatchFlag: '⚠️ កូដបានមកដល់ហើយ តែអ្នកទិញថាមិនដំណើរការ',
    /* v1.9: admin code notifications for listed emails. */
    notifications: 'ការជូនដំណឹង', notifTitle: 'ការជូនដំណឹង — កូដមកដល់អ៊ីមែលលក់',
    notifNote: 'ពេលមានសារ ឬកូដមកដល់អ៊ីមែលដែលដាក់លក់ (ទាំងដែលលក់រួច) វានឹងលោតមកទីនេះ។',
    noNotif: 'មិនមានការជូនដំណឹងទេ', markAllRead: 'សម្គាល់ថាបានអានទាំងអស់',
    notifNew: 'ថ្មី', toastNotifNew: '📩 អ៊ីមែលលក់មានកូដថ្មី!',
    lastCode: 'កូដចុងក្រោយ', noLastCode: 'មិនទាន់មានកូដមកដល់ទេ', notifCode: 'កូដ',
    /* v1.9b: buyer identity + forward the code to the buyer. */
    notifBuyer: 'អ្នកទិញ', notifNoBuyer: 'មិនទាន់មានអ្នកទិញ',
    sendToBuyer: 'ផ្ញើទៅអ្នកទិញ', notifSent: '✓ បានផ្ញើទៅអ្នកទិញ',
    toastNotifSent: 'បានផ្ញើកូដទៅអ្នកទិញហើយ',
    toastNotifNewDetail: '📩 {buyer} — កូដពី {sender} បានមកដល់ {email}',
    searchPlaceholder: 'ស្វែងរកតាមឈ្មោះ / Gmail / ប្រទេស…',
    filterAll: 'ទាំងអស់', filterNormal: 'ធម្មតា', filterRisk: 'មានហានិភ័យ', filterBlocked: 'បានបិទ',
    refresh: 'ធ្វើឱ្យថ្មី', country: 'ប្រទេស', city: 'ទីក្រុង', device: 'ឧបករណ៍', connection: 'ការតភ្ជាប់',
    registered: 'ចុះឈ្មោះ', plan: 'កញ្ចប់', status: 'ស្ថានភាព', noUsers: 'មិនមានអ្នកប្រើប្រាស់ទេ',
    normal: 'ធម្មតា', blocked: 'បានបិទ', risk: 'មានហានិភ័យ',
    block: 'បិទគណនី', unblock: 'បើកគណនីវិញ', confirmBlock: 'បញ្ជាក់ការបិទ',
    blockReason: 'មូលហេតុបិទ', blockReasonPh: 'ឧ. ប៉ុនប៉ង hack ដើម្បីប្រើមិនកំណត់',
    securityEvents: 'ព្រឹត្តិការណ៍សុវត្ថិភាព', noSecurityEvents: 'មិនមានព្រឹត្តិការណ៍សុវត្ថិភាពទេ',
    generateCode: 'បង្កើតកូដថ្មី', usesPerDay: 'ចំនួនប្រើក្នុងមួយថ្ងៃ (10–100)', expiry: 'ផុតកំណត់',
    expiryDays: 'ផុតកំណត់ (ថ្ងៃ)', day: 'ថ្ងៃ', days: 'ថ្ងៃ',
    sendCode: 'ផ្ញើកូដ', allUsers: 'អ្នកប្រើទាំងអស់', selectRecipient: 'ជ្រើសរើសអ្នកទទួល',
    sentToUser: 'បានផ្ញើកូដទៅ {name} រួចហើយ', sentToAll: 'បានផ្ញើកូដទៅអ្នកប្រើទាំងអស់រួចហើយ',
    perUserNote: 'កូដខុសគ្នាសម្រាប់អ្នកប្រើម្នាក់ៗ',
    sentToAllCount: 'បានផ្ញើកូដខុសគ្នា {n} កូដទៅអ្នកប្រើ {n} នាក់រួចហើយ',
    errSendCode: 'បរាជ័យក្នុងការផ្ញើកូដ។ សូមព្យាយាមម្តងទៀត។', generating: 'កំពុងបង្កើត…',
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
    recipients: 'អ្នកទទួល', selectAll: 'ជ្រើសរើសទាំងអស់', clearSelection: 'សម្អាត',
    selectedCount: 'បានជ្រើសរើស {n} នាក់', selectedUsersTitle: 'អ្នកដែលបានជ្រើសរើស',
    sendResultsTitle: 'កូដដែលបានផ្ញើ', sentCodesCount: 'បានផ្ញើ {n} កូដរួចហើយ',
    errNoRecipients: 'សូមជ្រើសរើសអ្នកទទួលយ៉ាងហោចណាស់ម្នាក់។',
    errInvalidDays: 'សូមជ្រើសរើសថ្ងៃផុតកំណត់ 1–7 ថ្ងៃ។',
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
    listings: 'Listings', orders: 'Orders',
    createListing: 'Create a listing manually', createListingBtn: 'Create listing',
    listingEmail: 'Email to sell', listingEmailPh: 'example@euploading.com',
    listingPassword: 'Email password', listingPrice: 'Price ($)', listingTitle: 'Title',
    listingLogo: 'Logo', listingToken: 'Token', listingTokenPh: 'e.g. 1B Token',
    errLogoTooBig: 'Image too large (max 5MB).',
    priceShort: 'Price', paid: 'Paid', amountMismatch: 'Amount mismatch',
    listingTitlePh: 'e.g. PUBG account', sellerGmail: 'Seller Gmail',
    healthGood: 'Good', healthBad: 'Bad', healthChecked: 'Checked',
    listingNew: 'New',
    checkHealth: 'Check', checking: 'Checking…',
    markBad: 'Mark bad', markGood: 'Mark good',
    autoDeleteIn: 'Auto-deletes in {n}h',
    autoDeleteSoon: 'Auto-deletes in less than 1h',
    listingIp: 'IP', listingIpPh: 'e.g. 103.146.x.x',
    listingCountryCity: 'Country / City', listingCountryCityPh: 'e.g. Cambodia, Phnom Penh',
    toastHealthChecked: 'Health checked.', toastHealthSet: 'Health updated.',
    errHealth: 'Failed to check/update health.',
    listingsList: 'All listings', noListings: 'No listings yet',
    ordersTitle: 'Shop orders', noOrders: 'No orders yet', buyer: 'Buyer',
    orderNote: 'Approving an order sells that email to this buyer only and removes it from the public shop. Please judge yourself whether a receipt is genuine.',
    remove: 'Remove', confirmRemoveListing: 'Are you sure you want to remove this listing?',
    relist: 'Re-list', confirmRelist: 'Put this account back in the shop? Same price and details.',
    toastListingRelisted: 'Listed in the shop again.', errRelist: 'Could not re-list.',
    sold: 'Sold', removed: 'Removed', pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
    errListingFields: 'Please fill in the email, password, price and title.',
    errListing: 'Failed to create the listing.', errOrder: 'Failed to process the order.',
    toastListingCreated: 'Listing created.', toastListingRemoved: 'Listing removed.',
    toastOrderApproved: 'Approved — the email has been sold to this buyer.', toastOrderRejected: 'Order rejected.',
    /* v1.8: buyer activation report + delivery evidence (anti-scam). */
    reportWorks: '✅ It works', reportFailed: '❌ Does not work', reportNotYet: 'Not reported yet',
    reportReasonNoCode: 'No code received', reportReasonVisa: 'Asked for a Visa card', reportReasonCantLogin: "Can't log in", reportReasonOther: 'Other',
    evidenceLast: 'Last message', evidenceNone: 'No message arrived after the purchase yet', evidenceMsgs: 'messages after purchase',
    mismatchFlag: '⚠️ A code arrived, but the buyer says it does not work',
    /* v1.9: admin code notifications for listed emails. */
    notifications: 'Notifications', notifTitle: 'Notifications — codes arriving at listed emails',
    notifNote: 'When a message or code arrives at an email you listed for sale (including sold ones), it pops up here.',
    noNotif: 'No notifications yet', markAllRead: 'Mark all as read',
    notifNew: 'New', toastNotifNew: '📩 A listed email has a new code!',
    lastCode: 'Last code', noLastCode: 'No code arrived yet', notifCode: 'Code',
    /* v1.9b: buyer identity + forward the code to the buyer. */
    notifBuyer: 'Buyer', notifNoBuyer: 'No buyer yet',
    sendToBuyer: 'Send to buyer', notifSent: '✓ Sent to buyer',
    toastNotifSent: 'Code sent to the buyer',
    toastNotifNewDetail: '📩 {buyer} — code from {sender} arrived at {email}',
    searchPlaceholder: 'Search by name / Gmail / country…',
    filterAll: 'All', filterNormal: 'Normal', filterRisk: 'At risk', filterBlocked: 'Blocked',
    refresh: 'Refresh', country: 'Country', city: 'City', device: 'Device', connection: 'Connection',
    registered: 'Registered', plan: 'Plan', status: 'Status', noUsers: 'No users yet',
    normal: 'Normal', blocked: 'Blocked', risk: 'At risk',
    block: 'Block account', unblock: 'Unblock account', confirmBlock: 'Confirm block',
    blockReason: 'Block reason', blockReasonPh: 'e.g. tried to hack for unlimited use',
    securityEvents: 'Security events', noSecurityEvents: 'No security events',
    generateCode: 'Generate new code', usesPerDay: 'Uses per day (10–100)', expiry: 'Expiry',
    expiryDays: 'Expires in (days)', day: 'day', days: 'days',
    sendCode: 'Send code', allUsers: 'All users', selectRecipient: 'Choose recipient',
    sentToUser: 'Code sent to {name}', sentToAll: 'Code sent to all users',
    perUserNote: 'A different code for each user',
    sentToAllCount: 'Sent {n} different codes to {n} users',
    errSendCode: 'Failed to send the code. Please try again.', generating: 'Generating…',
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
    recipients: 'Recipients', selectAll: 'Select all', clearSelection: 'Clear',
    selectedCount: '{n} selected', selectedUsersTitle: 'Selected users',
    sendResultsTitle: 'Codes sent', sentCodesCount: 'Sent {n} codes',
    errNoRecipients: 'Please select at least one recipient.',
    errInvalidDays: 'Please pick an expiry of 1–7 days.',
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
  startNotifPolling(); /* v1.9: pop-up toast when a code arrives at a listed email */
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
  if (!res.ok) {
    var err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
    err.status = res.status; /* callers can branch on 404/405 (e.g. DELETE fallback) */
    throw err;
  }
  return data;
}

/* ============================================================================
   Dashboard data
   ============================================================================ */
var usersCache = [], codesCache = [], receiptsCache = [], listingsCache = [], ordersCache = [];

function normUser(u) {
  u = u || {};
  /* Real server shape (server.js userFromRow + listUsersWithRisk):
     gmail, name, country, city, ip, device, connection, plan, blocked,
     blocked_reason, daily_uses, redeemed_uses, created_at, updated_at,
     last_seen_at, risk. There is NO securityEvents array from the API. */
  var events = u.securityEvents || u.security_events || u.events || [];
  var blocked = !!u.blocked;
  var risk = !!u.risk || !!u.riskFlag || events.length > 0;
  return {
    name: u.name || u.displayName || '—',
    gmail: u.gmail || u.email || '',
    country: u.country || '', countryCode: u.countryCode || u.country_code || '',
    city: u.city || '', ip: u.ip || u.ipAddress || '',
    device: u.device || u.deviceModel || u.model || '',
    connection: u.connection || u.network || u.connectionType || '',
    registeredAt: u.registeredAt || u.created_at || u.createdAt || u.registered || '',
    lastActiveAt: u.lastActiveAt || u.last_seen_at || u.lastActive || '',
    plan: u.plan || 'Free', blocked: blocked, risk: risk,
    reason: u.blockReason || u.blocked_reason || u.reason || (events.length ? (events[0].type || events[0].message || '') : ''),
    events: events
  };
}
function userStatus(u) { return u.blocked ? 'blocked' : (u.risk ? 'risk' : 'normal'); }

/* v1.5: the three admin accounts — Admin emails are set by Mov.
   Same list as the Sell gate in server.js (ADMIN_SELLER_GMAILS);
   keep the two in sync. */
var ADMIN_GMAILS = [
  "sokhoeun7788@gmail.com",
  "skhoeun75@gmail.com",
  "hoeunsok138@gmail.com"
];
function isAdminGmail(gmail) {
  return ADMIN_GMAILS.indexOf(String(gmail || "").trim().toLowerCase()) !== -1;
}
function adminBadgeHtml(u) {
  return isAdminGmail(u.gmail) ? ' <span class="admin-badge-user">Admin</span>' : '';
}

function loadAll() { loadUsers(); loadCodes(); loadReceipts(); loadListings(); loadOrders(); loadNotifications(); }

async function loadUsers() {
  showError($('usersError'), '');
  try {
    var data = await api('/api/admin/users');
    var list = Array.isArray(data) ? data : (data.users || []);
    usersCache = list.map(normUser);
    renderUsers();
    renderRecipientList();
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
      /* Real server shape (server.js receiptFromRow): id, gmail, plan,
         method, imageDataUrl, status, created_at, decided_at.
         There is NO imageUrl / createdAt / amount from the API. */
      return {
        id: r.id, gmail: r.gmail || r.email || '', plan: r.plan || '',
        method: r.method || '', amount: r.amount || '',
        imageUrl: r.imageDataUrl || r.imageUrl || r.screenshotUrl || r.image || '',
        imageDataUrl: r.imageDataUrl || r.imageUrl || '',
        createdAt: r.created_at || r.createdAt || r.submittedAt || '',
        created_at: r.created_at || r.createdAt || '',
        status: (r.status || 'pending').toLowerCase()
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
      + '<td>' + esc(u.gmail) + adminBadgeHtml(u) + '</td>'
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
  $('drawerTitle').textContent = u.name + ' — ' + u.gmail + (isAdminGmail(u.gmail) ? ' · Admin' : '');
  $('drawerBody').innerHTML =
    '<dl class="kv">'
    + '<dt>' + esc(t('gmail')) + '</dt><dd>' + esc(u.gmail) + adminBadgeHtml(u) + '</dd>'
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
            + '<span class="ev-time">' + esc(fmtDate(ev.at || ev.time || ev.created_at || ev.createdAt)) + '</span></li>';
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
/* Expiry picker: 1–7 days, chosen as a segmented control (no free typing). */
var selectedExpiryDays = 1;
function renderExpirySeg() {
  var seg = $('expirySeg');
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach(function (b) {
    var d = Number(b.dataset.days);
    b.classList.toggle('active', d === selectedExpiryDays);
    b.textContent = d + ' ' + (d === 1 ? t('day') : t('days'));
  });
}
function codeStatus(c) {
  /* Real server shape (server.js codeFromRow): code, amountPerDay,
     status ('active'|'used'|'disabled'|'expired' — already derived
     server-side), created_at, expiresAt, usedBy, usedAt. */
  var st = String(c.status || '').toLowerCase();
  if (st === 'disabled' || c.disabled) return 'disabled';
  if (st === 'used' || c.usedBy || c.usedOnceBy || c.used) return 'used';
  if (st === 'expired') return 'expired';
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return 'expired';
  return 'active';
}
function renderCodes() {
  $('codesList').innerHTML = codesCache.map(function (c) {
    var code = c.code || '';
    var st = codeStatus(c);
    var usedBy = c.usedBy || c.usedOnceBy || '';
    var usedAt = c.usedAt || '';
    var meta = '<span>' + esc(t('usesPerDay')) + ': ' + esc(c.amountPerDay != null ? c.amountPerDay : c.amount || '—') + '</span>'
      + ' · <span>' + esc(t('expires')) + ': ' + esc(fmtDate(c.expiresAt)) + '</span>'
      + ' · <span>' + esc(t('created')) + ': ' + esc(fmtDate(c.created_at || c.createdAt)) + '</span>'
      + (st === 'used' && usedBy ? '<span class="used-by">' + esc(t('usedBy')) + ': ' + esc(usedBy) + (usedAt ? ' · ' + esc(fmtDate(usedAt)) : '') + '</span>' : '');
    var pillCls = st === 'active' ? 'pill-green' : (st === 'disabled' ? 'pill-red' : (st === 'expired' ? 'pill-amber' : 'pill-grey'));
    var action = st === 'disabled'
      ? '<button class="btn btn-secondary" type="button" data-code-action="activate" data-code="' + esc(code) + '">' + esc(t('activate')) + '</button>'
      : '<button class="btn btn-secondary" type="button" data-code-action="disable" data-code="' + esc(code) + '">' + esc(t('disable')) + '</button>';
    /* No per-code send UI any more: sending happens only through the
       unified create-and-send panel above (Generate → codes go to the
       selected recipients at once). */
    return '<div class="code-row status-' + st + '"><code>' + esc(code) + '</code>'
      + '<span class="pill ' + pillCls + '">' + esc(t(st)) + '</span>'
      + '<span class="meta">' + meta + '</span>' + action + '</div>';
  }).join('');
  show($('codesEmpty'), codesCache.length === 0);
}

/* ---------- Send a code to users (bell gift) ---------- */
function displayNameForGmail(gmail) {
  var u = null;
  for (var i = 0; i < usersCache.length; i++) if (usersCache[i].gmail === gmail) { u = usersCache[i]; break; }
  return u ? u.name : gmail;
}
function showSendStatus(el, msg, isErr) {
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('send-error', !!isErr);
  el.hidden = !msg;
}
/* ---------- Recipient multi-select (unified create-and-send flow) ----------
   BEFORE creating, the admin picks days + amount + recipients, then
   Generate sends a fresh code to every selected Gmail at once.
   selectedRecipients holds gmails (as stored in usersCache). */
var selectedRecipients = [];
var lastSendResults = [];
function allUserGmails() {
  return usersCache.map(function (u) { return u.gmail; }).filter(function (g) { return !!g; });
}
function getSelectedGmails() {
  var all = allUserGmails();
  return selectedRecipients.filter(function (g) { return all.indexOf(g) !== -1; });
}
function userByGmail(gmail) {
  for (var i = 0; i < usersCache.length; i++) if (usersCache[i].gmail === gmail) return usersCache[i];
  return null;
}
/* (Re)build the scrollable checkbox list from the loaded users list,
   preserving the current selection. Also refreshes the count label and
   the selected-users area. */
function renderRecipientList() {
  var list = $('recipientList');
  if (!list) return;
  var sel = {};
  selectedRecipients.forEach(function (g) { sel[g] = true; });
  list.innerHTML = usersCache.filter(function (u) { return !!u.gmail; }).map(function (u) {
    return '<label class="recipient-row"><input type="checkbox" data-gmail="' + esc(u.gmail) + '"' + (sel[u.gmail] ? ' checked' : '') + '>'
      + '<span class="r-who"><span class="r-name">' + esc(u.name) + '</span> '
      + '<span class="r-gmail">' + esc(u.gmail) + '</span></span></label>';
  }).join('');
  show($('noUsersForCodes'), usersCache.filter(function (u) { return !!u.gmail; }).length === 0);
  renderSelectedUsers();
}
function renderSelectedUsers() {
  var box = $('selectedUsers');
  if (!box) return;
  var chosen = getSelectedGmails();
  $('recipientCount').textContent = t('selectedCount').replace('{n}', String(chosen.length));
  /* NO cap: every selected user is listed; the area scrolls. */
  box.innerHTML = chosen.length
    ? '<div class="selected-users-title">' + esc(t('selectedUsersTitle')) + '</div>'
      + chosen.map(function (g) {
          var u = userByGmail(g);
          return '<div class="selected-user-row">' + esc(u ? u.name : g) + ' <span class="r-gmail">' + esc(g) + '</span></div>';
        }).join('')
    : '';
  show(box, chosen.length > 0);
}
function onRecipientListChange(e) {
  var cb = e.target && e.target.closest ? e.target.closest('input[type="checkbox"][data-gmail]') : null;
  if (!cb) return;
  var g = cb.dataset.gmail;
  if (cb.checked) { if (selectedRecipients.indexOf(g) === -1) selectedRecipients.push(g); }
  else { selectedRecipients = selectedRecipients.filter(function (x) { return x !== g; }); }
  renderSelectedUsers();
}
function selectAllRecipients() {
  selectedRecipients = allUserGmails().slice();
  renderRecipientList();
}
function clearRecipients() {
  selectedRecipients = [];
  renderRecipientList();
}
function renderSendResults(results) {
  lastSendResults = results || [];
  var box = $('sendResultsBox');
  var list = $('sendResultsList');
  if (!box || !list) return;
  list.innerHTML = lastSendResults.map(function (r) {
    return '<div class="send-result-row"><code>' + esc(r.code || '') + '</code>'
      + '<button class="btn btn-secondary" type="button" data-copy-code="' + esc(r.code || '') + '">' + esc(t('copy')) + '</button>'
      + '<span class="send-result-arrow" aria-hidden="true">→</span>'
      + '<span class="send-result-gmail">' + esc(r.gmail || '') + '</span></div>';
  }).join('');
  show(box, lastSendResults.length > 0);
}
function onSendResultsClick(e) {
  var btn = e.target && e.target.closest ? e.target.closest('[data-copy-code]') : null;
  if (!btn) return;
  var code = btn.dataset.copyCode;
  var done = function () { btn.textContent = t('copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, done);
  else done();
}
async function sendCodeTo(code, gmail, statusEl) {
  if (!getToken()) { showSendStatus(statusEl, t('errNoToken'), true); return false; }
  try {
    var data = await api('/api/admin/notify', { method: 'POST', body: { code: code, gmail: gmail } });
    var msg;
    if (gmail === 'ALL' && data && data.perUser && typeof data.notified === 'number') {
      /* Per-user codes: the server minted one different code per user. */
      msg = t('sentToAllCount').replace(/\{n\}/g, String(data.notified));
    } else if (gmail === 'ALL') {
      msg = t('sentToAll');
    } else {
      msg = t('sentToUser').replace('{name}', displayNameForGmail(gmail));
    }
    showSendStatus(statusEl, msg, false);
    toast(msg);
    if (gmail === 'ALL') {
      /* The server created fresh per-user codes — refresh the list so they
         appear as normal active codes. This re-renders per-code rows, so if
         the status span we just wrote into was rebuilt, re-apply the
         message to the fresh row. */
      await loadCodes();
      if (statusEl && !statusEl.isConnected) {
        var fresh = document.querySelector('[data-send-status="' + code + '"]');
        if (fresh) showSendStatus(fresh, msg, false);
      }
    }
    return true;
  } catch (err) { showSendStatus(statusEl, t('errSendCode'), true); return false; }
}
async function onSendCodeClick(btn) {
  var code = btn.dataset.sendCode;
  var row = btn.closest('.code-row');
  var sel = row ? row.querySelector('select.send-recipient') : null;
  var statusEl = row ? row.querySelector('[data-send-status]') : null;
  var gmail = sel ? (sel.value || 'ALL') : 'ALL';
  btn.disabled = true;
  try { await sendCodeTo(code, gmail, statusEl); }
  finally { btn.disabled = false; }
}
/* Unified create-and-send: days + amount + recipients are all chosen
   BEFORE Generate. One POST mints a fresh code per recipient and puts
   it in each Gmail's bell at once. */
async function onCodeSubmit(e) {
  e.preventDefault();
  var amount = Number($('codeAmount').value);
  if (!Number.isInteger(amount) || amount < 10 || amount > 100) return showError($('codeError'), t('errAmount'));
  if (!Number.isInteger(selectedExpiryDays) || selectedExpiryDays < 1 || selectedExpiryDays > 7) return showError($('codeError'), t('errInvalidDays'));
  var gmails = getSelectedGmails();
  if (!gmails.length) return showError($('codeError'), t('errNoRecipients'));
  showError($('codeError'), '');
  /* Deliberate ~5s loading state on the Generate button while the
     codes are created and sent. */
  var btn = $('generateCodeBtn');
  var originalText = btn.textContent;
  var startedAt = Date.now();
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + esc(t('generating'));
  try {
    var all = allUserGmails();
    var recipients = (gmails.length === all.length && all.length > 0) ? 'ALL' : gmails;
    var data = await api('/api/admin/codes/send', {
      method: 'POST',
      body: { expiryDays: selectedExpiryDays, amountPerDay: amount, recipients: recipients }
    });
    var elapsed = Date.now() - startedAt;
    if (elapsed < 5000) await new Promise(function (r) { setTimeout(r, 5000 - elapsed); });
    var results = (data && Array.isArray(data.results)) ? data.results : [];
    renderSendResults(results);
    if (results.length) toast(t('sentCodesCount').replace('{n}', String(results.length)));
    loadCodes();
  } catch (err) { showError($('codeError'), t('errCode')); }
  finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = originalText;
  }
}
async function onCodeActionClick(e) {
  var sendBtn = e.target.closest('[data-send-code]');
  if (sendBtn) { onSendCodeClick(sendBtn); return; }
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
    /* imageDataUrl is the real field (server.js receiptFromRow);
       imageUrl is kept only as a fallback. data-full carries the same
       URL so tapping the thumbnail opens the lightbox with it. */
    var img = r.imageDataUrl || r.imageUrl || '';
    return '<div class="receipt-row" data-receipt-id="' + esc(r.id) + '">'
      + (img
        ? '<img class="receipt-thumb" src="' + esc(img) + '" alt="Receipt" data-full="' + esc(img) + '">'
        : '<div class="receipt-thumb"></div>')
      + '<div class="receipt-info">'
      + '<div class="r-gmail">' + esc(r.gmail) + '</div>'
      + '<div class="r-line">' + esc(t('plan')) + ': ' + esc(r.plan) + ' · ' + esc(t('method')) + ': ' + esc(r.method) + (r.amount ? ' · ' + esc(r.amount) : '') + '</div>'
      + '<div class="r-line">' + esc(fmtDate(r.created_at || r.createdAt)) + '</div>'
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

/* ============================================================================
   Market — public Email Account shop (Version 1.2).
   API contract (all X-Admin-Token):
     GET  /api/admin/market/listings            -> [{id, maskedEmail, sellerGmail, price, title, status, createdAt, logoDataUrl, token, health, health_checked_at, health_bad_since, ip, country, city}]
     POST /api/admin/market/listings            -> body {email, password, price, title, sellerGmail, logoDataUrl, token, ip, country, city}; {ok:true, listing:{...}} or 400 (Mail.tm verification failed)
     POST /api/admin/market/listings/:id/check  -> re-checks the listing by Mail.tm login; {ok:true, listing:{...}}
     POST /api/admin/market/listings/:id/health -> body {health:'good'|'bad'}; manual health flip (Mail.tm login cannot detect a game/AI company banning the account)
     DELETE /api/admin/market/listings/:id      -> {ok:true} (status "removed")
   A 'bad' listing is auto-deleted by the server 24h after health_bad_since
   (lazy expiry) — the admin only displays the countdown, never deletes.
       — if the server only has POST .../:id/remove, the client falls back
         to it on 404/405 (see removeListing).
     GET  /api/admin/market/orders             -> [{id, listingId, maskedEmail, buyerGmail, price, amountPaid, method, imageDataUrl, status, createdAt}]
     POST /api/admin/market/orders/:id/approve -> {ok:true} (listing becomes sold to that buyer)
     POST /api/admin/market/orders/:id/reject  -> {ok:true} (listing stays active)
   The listing PASSWORD is sent once on manual create and is never stored
   in any cache and never rendered in the UI.
   ============================================================================ */
function normListing(l) {
  l = l || {};
  /* Real server shape: id, maskedEmail, sellerGmail, price, title,
     status ('active'|'sold'|'removed'), createdAt, logoDataUrl, token.
     No password field is ever returned. */
  return {
    id: l.id,
    maskedEmail: l.maskedEmail || l.masked_email || l.email || '',
    sellerGmail: l.sellerGmail || l.seller || l.seller_gmail || 'admin',
    price: l.price,
    title: l.title || '',
    logoDataUrl: l.logoDataUrl || l.logo || l.logo_url || '',
    token: l.token || '',
    status: String(l.status || 'active').toLowerCase(),
    createdAt: l.createdAt || l.created_at || '',
    /* Health (v1.3): 'good' | 'bad'. Legacy listings have no health field
       — treated as good. healthCheckedAt: last check time ('' = never).
       healthBadSince: when it turned bad ('' = not bad). */
    health: String(l.health || l.healthStatus || 'good').toLowerCase(),
    healthCheckedAt: l.health_checked_at || l.healthCheckedAt || l.health_checked || '',
    healthBadSince: l.health_bad_since || l.healthBadSince || '',
    /* IP profile (v1.3): stored on the listing at creation and adopted
       permanently by the bought mailbox on Restore. */
    ip: l.ip || l.ipAddress || '',
    country: l.country || '',
    city: l.city || '',
    countryCode: l.countryCode || l.country_code || '',
    /* v1.9: last code/message that arrived at this listed email. */
    lastCodeAt: l.last_code_at || l.lastCodeAt || '',
    lastCodeFrom: l.last_code_from || l.lastCodeFrom || '',
    lastCodeSubject: l.last_code_subject || l.lastCodeSubject || ''
  };
}
function normOrder(o) {
  o = o || {};
  /* Real server shape: id, listingId, maskedEmail, buyerGmail, price,
     amountPaid (what the buyer actually paid; may be absent on old
     orders), method ('KHQR'|'USDT'), imageDataUrl, status
     ('pending'|'approved'|'rejected'), createdAt. */
  return {
    id: o.id,
    listingId: o.listingId || o.listing_id || '',
    maskedEmail: o.maskedEmail || o.masked_email || o.email || '',
    buyerGmail: o.buyerGmail || o.buyer || o.buyer_gmail || o.gmail || '',
    price: o.price,
    amountPaid: (o.amountPaid != null ? o.amountPaid : (o.paid != null ? o.paid : o.amount_paid)),
    method: o.method || '',
    imageDataUrl: o.imageDataUrl || o.imageUrl || '',
    status: String(o.status || 'pending').toLowerCase(),
    createdAt: o.createdAt || o.created_at || ''
  };
}
function fmtPrice(p) {
  if (p == null || p === '') return '—';
  var n = Number(p);
  return isNaN(n) ? String(p) : '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}
async function loadListings() {
  showError($('listingsError'), '');
  try {
    var data = await api('/api/admin/market/listings');
    var list = Array.isArray(data) ? data : (data.listings || []);
    listingsCache = list.map(normListing);
    renderListings();
  } catch (e) { showError($('listingsError'), t('errLoad')); }
}
async function loadOrders() {
  showError($('ordersError'), '');
  try {
    var data = await api('/api/admin/market/orders');
    var list = Array.isArray(data) ? data : (data.orders || []);
    ordersCache = list.map(normOrder);
    renderOrders();
  } catch (e) { showError($('ordersError'), t('errLoad')); }
}
/* v1.9: listing-code notifications — a message/code arriving at any
   listed email (active or sold) pops up here. The server creates one
   notification per saved message; the admin polls every 30s while
   logged in, and a NEW arrival pops a toast — "email នេះមានកូដ".
   The toast only fires when the newest id actually grows (never on
   every poll, never for old notifications on first load). */
var notifCache = [], notifUnread = 0, notifSeenMaxId = 0, notifPrimed = false, notifTimer = null;
function normNotif(n) {
  n = n || {};
  return {
    id: n.id,
    listingId: n.listingId || n.listing_id || '',
    listingEmail: n.listingEmail || n.listing_email || n.email || '',
    listingTitle: n.listingTitle || n.listing_title || n.title || '',
    sender: n.sender || n.from || '',
    subject: n.subject || '',
    code: n.code || '',
    /* v1.9b: who bought it + whether the code was forwarded. */
    buyerGmail: n.buyerGmail || n.buyer_gmail || '',
    buyerName: n.buyerName || n.buyer_name || '',
    forwarded: !!(n.forwarded || n.forwardedAt || n.forwarded_at),
    forwardedAt: n.forwardedAt || n.forwarded_at || '',
    isRead: !!(n.isRead || n.is_read),
    createdAt: n.createdAt || n.created_at || ''
  };
}
function updateNotifBadge() {
  var b = $('notifTabBadge');
  if (!b) return;
  b.textContent = notifUnread > 99 ? '99+' : String(notifUnread);
  b.hidden = !(notifUnread > 0);
}
async function loadNotifications(silent) {
  try {
    var data = await api('/api/admin/notifications');
    var list = Array.isArray(data) ? data : (data.notifications || []);
    var unread = (data && typeof data.unread === 'number')
      ? data.unread
      : list.filter(function (x) { return !(x.isRead || x.is_read); }).length;
    var maxId = 0;
    list.forEach(function (x) { if (Number(x.id) > maxId) maxId = Number(x.id); });
    var isNew = notifPrimed && maxId > notifSeenMaxId;
    notifCache = list.map(normNotif);
    notifUnread = unread;
    if (maxId > notifSeenMaxId) notifSeenMaxId = maxId;
    notifPrimed = true;
    renderNotifications();
    updateNotifBadge();
    /* v1.9b: the pop-up names the buyer + the sender + the email
       ("email នេះមានកូដ" — who it is from and who bought it). */
    if (isNew && isLoggedIn()) {
      var newest = null;
      list.forEach(function (x) { if (!newest || Number(x.id) > Number(newest.id)) newest = x; });
      if (newest) {
        var nn = normNotif(newest);
        var who = nn.buyerName || nn.buyerGmail;
        toast(t('toastNotifNewDetail')
          .replace('{buyer}', who || nn.listingEmail || '—')
          .replace('{sender}', nn.sender || '—')
          .replace('{email}', nn.listingEmail || '—'));
      } else toast(t('toastNotifNew'));
    }
  } catch (e) {
    if (!silent) showError($('notifError'), t('errLoad'));
  }
}
function renderNotifications() {
  var sorted = notifCache.slice().sort(function (a, b) {
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  $('notifList').innerHTML = sorted.map(function (n) {
    var codeLine = n.code
      ? '<div class="n-line n-code">' + esc(t('notifCode')) + ': <code>' + esc(n.code) + '</code></div>'
      : '';
    /* v1.9b: who bought it (name + gmail, or "no buyer yet") and the
       forward button — only when a code + a known buyer exist. Once
       forwarded it becomes a "sent ✓" state and the button is gone. */
    var buyerLine = '<div class="n-line">👤 ' + esc(t('notifBuyer')) + ': '
      + (n.buyerGmail
        ? esc(n.buyerName ? n.buyerName + ' (' + n.buyerGmail + ')' : n.buyerGmail)
        : esc(t('notifNoBuyer')))
      + '</div>';
    var fwd = '';
    if (n.code && n.buyerGmail) {
      fwd = n.forwarded
        ? '<div class="n-line n-sent">' + esc(t('notifSent')) + '</div>'
        : '<button class="btn btn-primary notif-forward-btn" data-forward-id="' + esc(n.id) + '">' + esc(t('sendToBuyer')) + '</button>';
    }
    return '<div class="notif-row' + (n.isRead ? '' : ' notif-unread') + '" data-notif-id="' + esc(n.id) + '">'
      + '<div class="notif-info">'
      + '<div class="n-title">' + (n.isRead ? '' : '<span class="pill pill-red">' + esc(t('notifNew')) + '</span> ')
      + esc(n.listingTitle || n.listingEmail) + '</div>'
      + '<div class="n-line">' + esc(n.listingEmail) + '</div>'
      + buyerLine
      + '<div class="n-line">📩 ' + esc(n.sender || '—') + ' — ' + esc(n.subject || '—') + '</div>'
      + codeLine
      + fwd
      + '<div class="n-line n-time">' + esc(fmtDate(n.createdAt)) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  show($('notifEmpty'), sorted.length === 0);
}
async function onMarkNotifReadClick() {
  try {
    await api('/api/admin/notifications/read', { method: 'POST' });
    notifUnread = 0;
    notifCache.forEach(function (n) { n.isRead = true; });
    renderNotifications();
    updateNotifBadge();
    toast(t('toastSaved'));
  } catch (e) { showError($('notifError'), t('errLoad')); }
}
/* v1.9b: forward the code to the buyer — it lands in the buyer's
   website bell. Delegated: rows are re-rendered on every poll, so
   the listener lives on the list itself. The server is idempotent
   (second press returns already:true), and the button disables
   while the request is in flight. */
async function onNotifForwardClick(e) {
  var btn = e.target && e.target.closest ? e.target.closest('[data-forward-id]') : null;
  if (!btn) return;
  var id = Number(btn.getAttribute('data-forward-id'));
  if (!id) return;
  btn.disabled = true;
  try {
    var data = await api('/api/admin/notifications/' + id + '/forward', { method: 'POST' });
    if (data && data.notification) {
      var nn = normNotif(data.notification);
      notifCache = notifCache.map(function (x) { return String(x.id) === String(id) ? nn : x; });
      renderNotifications();
    }
    toast(t('toastNotifSent'));
  } catch (err) {
    showError($('notifError'), t('errLoad'));
    btn.disabled = false;
  }
}
function startNotifPolling() {
  if (notifTimer) return;
  notifTimer = setInterval(function () {
    if (isLoggedIn()) loadNotifications(true);
  }, 30000);
}
function listingPill(st) {
  if (st === 'active') return '<span class="pill pill-green">' + esc(t('active')) + '</span>';
  if (st === 'sold') return '<span class="pill pill-grey">' + esc(t('sold')) + '</span>';
  if (st === 'removed') return '<span class="pill pill-red">' + esc(t('removed')) + '</span>';
  return '<span class="pill pill-grey">' + esc(st) + '</span>';
}
/* ---------- Listing health (Version 1.3) ----------
   health: 'good' (legacy listings have no health field — treat as good)
   or 'bad'. healthCheckedAt: last automatic/manual check time.
   healthBadSince: when it turned bad; the server auto-deletes a bad
   listing 24h after that (lazy expiry — the admin only shows the
   countdown, it never deletes by itself). */
function listingHealth(l) {
  return String(l.health || 'good').toLowerCase() === 'bad' ? 'bad' : 'good';
}
function autoDeleteText(l, nowMs) {
  if (!l.healthBadSince) return '—';
  var badSince = new Date(l.healthBadSince).getTime();
  if (isNaN(badSince)) return '—';
  var remain = badSince + 24 * 3600 * 1000 - (nowMs || Date.now());
  if (remain <= 0) return t('autoDeleteSoon');
  /* Whole hours, rounded: bad 2h ago -> ~22h, bad 23h ago -> ~1h. */
  var hours = Math.round(remain / 3600000);
  if (hours < 1) return t('autoDeleteSoon');
  return t('autoDeleteIn').replace('{n}', String(hours));
}
function listingIpLine(l) {
  /* Flag + country/city + IP; '—' when the listing has no IP profile. */
  var place = [l.country, l.city].filter(function (x) { return !!x; }).join(', ');
  var parts = [];
  if (place) parts.push(flagFor(l.country, l.countryCode) + place);
  if (l.ip) parts.push('IP ' + l.ip);
  if (!parts.length) return '—';
  return parts.join(' · ');
}
/* v1.3: "New" badge — listed < 2 hours ago. Pure render-time
   check on createdAt; missing/invalid → no badge, never crash;
   future createdAt (clock skew) counts as new. */
function isNewListing(l) {
  if (!l || !l.createdAt) return false;
  var t0 = new Date(l.createdAt).getTime();
  if (isNaN(t0)) return false;
  return Date.now() - t0 < 2 * 60 * 60 * 1000;
}
function renderListings() {
  $('listingsList').innerHTML = listingsCache.map(function (l) {
    var health = listingHealth(l);
    var isBad = health === 'bad';
    var removeBtn = (l.status === 'active' || l.status === 'sold')
      ? '<button class="btn btn-danger" type="button" data-listing-remove="' + esc(l.id) + '">' + esc(t('remove')) + '</button>'
      : '';
    /* v1.7d: a sold listing can go back in the shop with one click —
       the server reuses the stored password, so Mov never types one. */
    var relistBtn = l.status === 'sold'
      ? '<button class="btn btn-primary" type="button" data-listing-relist="' + esc(l.id) + '">' + esc(t('relist')) + '</button>'
      : '';
    var healthPill = isBad
      ? '<span class="pill pill-red">' + esc(t('healthBad')) + '</span>'
      : '<span class="pill pill-green">' + esc(t('healthGood')) + '</span>';
    /* Manual toggle (Mail.tm login cannot detect a game/AI company
       banning the account, so the admin flips health by hand). */
    var healthToggleBtn = isBad
      ? '<button class="btn btn-secondary" type="button" data-listing-health="good" data-id="' + esc(l.id) + '">' + esc(t('markGood')) + '</button>'
      : '<button class="btn btn-secondary" type="button" data-listing-health="bad" data-id="' + esc(l.id) + '">' + esc(t('markBad')) + '</button>';
    var checkBtn = '<button class="btn btn-secondary" type="button" data-listing-check="' + esc(l.id) + '">' + esc(t('checkHealth')) + '</button>';
    var countdownLine = isBad
      ? '<div class="l-line l-auto-delete">' + esc(autoDeleteText(l)) + '</div>'
      : '';
    return '<div class="listing-row status-' + esc(l.status) + (isBad ? ' health-bad' : '') + '" data-listing-id="' + esc(l.id) + '">'
      + (l.logoDataUrl
        ? '<img class="listing-thumb" src="' + esc(l.logoDataUrl) + '" alt="">'
        : '')
      + '<div class="listing-info">'
      + '<div class="l-email">' + esc(l.maskedEmail) + (isNewListing(l) ? ' <span class="listing-new-badge">' + esc(t('listingNew')) + '</span>' : '') + '</div>'
      + '<div class="l-title">' + esc(l.title) + '</div>'
      + '<div class="l-line">' + esc(fmtPrice(l.price)) + ' · ' + esc(t('sellerGmail')) + ': ' + esc(l.sellerGmail) + '</div>'
      + (l.token ? '<div class="l-line">' + esc(t('listingToken')) + ': ' + esc(l.token) + '</div>' : '')
      + '<div class="l-line">' + esc(t('listingIp')) + ': ' + esc(listingIpLine(l)) + '</div>'
      + '<div class="l-line">' + healthPill + ' ' + esc(t('healthChecked')) + ': ' + esc(fmtDate(l.healthCheckedAt)) + '</div>'
      + (l.lastCodeAt
        ? '<div class="l-line">📩 ' + esc(t('lastCode')) + ': ' + esc(l.lastCodeFrom || '—') + ' — ' + esc(l.lastCodeSubject || '—') + ' (' + esc(fmtDate(l.lastCodeAt)) + ')</div>'
        : '<div class="l-line">📩 ' + esc(t('noLastCode')) + '</div>')
      + countdownLine
      + '<div class="l-line">' + esc(t('created')) + ': ' + esc(fmtDate(l.createdAt)) + '</div>'
      + '</div>'
      + listingPill(l.status)
      + '<div class="listing-actions">' + checkBtn + healthToggleBtn + relistBtn + removeBtn + '</div>'
      + '</div>';
  }).join('');
  show($('listingsEmpty'), listingsCache.length === 0);
}
/* v1.8: reason keys (from the buyer's report) → admin language. */
function reportReasonLabel(key) {
  if (key === 'no_code') return t('reportReasonNoCode');
  if (key === 'visa_card') return t('reportReasonVisa');
  if (key === 'cant_login') return t('reportReasonCantLogin');
  if (key === 'other') return t('reportReasonOther');
  return key || '';
}
function renderOrders() {
  /* Newest first. */
  var sorted = ordersCache.slice().sort(function (a, b) {
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  $('ordersList').innerHTML = sorted.map(function (o) {
    var pill = o.status === 'pending'
      ? '<span class="pill pill-amber">' + esc(t('pending')) + '</span>'
      : (o.status === 'approved'
        ? '<span class="pill pill-green">' + esc(t('approved')) + '</span>'
        : '<span class="pill pill-red">' + esc(t('rejected')) + '</span>');
    var img = o.imageDataUrl || '';
    /* "Price $X · Paid $Y" — paid is '—' when missing (old orders).
       Red flag only when both numbers exist and differ by > $0.005. */
    var paidNum = (o.amountPaid == null || o.amountPaid === '') ? null : Number(o.amountPaid);
    var priceNum = (o.price == null || o.price === '') ? null : Number(o.price);
    var paidTxt = paidNum == null || isNaN(paidNum) ? '—' : fmtPrice(paidNum);
    var mismatch = paidNum != null && priceNum != null && !isNaN(paidNum) && !isNaN(priceNum)
      && Math.abs(paidNum - priceNum) > 0.005;
    var priceLine = esc(t('priceShort')) + ' ' + esc(fmtPrice(o.price)) + ' · ' + esc(t('paid')) + ' ' + esc(paidTxt)
      + (mismatch ? ' <span class="pill pill-red">' + esc(t('amountMismatch')) + '</span>' : '');
    var actions = o.status === 'pending'
      ? '<div class="receipt-actions">'
        + '<button class="btn btn-primary" type="button" data-order-action="approve" data-id="' + esc(o.id) + '">' + esc(t('approve')) + '</button>'
        + '<button class="btn btn-danger" type="button" data-order-action="reject" data-id="' + esc(o.id) + '">' + esc(t('reject')) + '</button>'
        + '</div>'
      : '';
    /* v1.8: buyer activation report + delivery evidence. The report is
       what the buyer says; the evidence is what actually arrived in
       that mailbox after the purchase. When they disagree (buyer says
       it failed, but a code DID arrive) the red flag shows — that is
       Mov's proof against a false "it doesn't work" claim. */
    var rep = o.report || null;
    var repLine = '';
    if (rep && rep.status) {
      var repReason = (rep.status === 'failed' && rep.reason)
        ? ' · ' + esc(reportReasonLabel(rep.reason)) : '';
      repLine = '<div class="r-line">' + (rep.status === 'works'
        ? '<span class="pill pill-green">' + esc(t('reportWorks')) + '</span>'
        : '<span class="pill pill-red">' + esc(t('reportFailed')) + '</span>' + repReason)
        + '</div>';
    } else {
      repLine = '<div class="r-line"><span class="pill pill-grey">' + esc(t('reportNotYet')) + '</span></div>';
    }
    var ev = o.evidence || null;
    var evLine = '';
    if (ev && ev.count > 0) {
      evLine = '<div class="r-line">📩 ' + esc(t('evidenceLast')) + ': ' + esc(ev.lastFrom || '—')
        + ' — ' + esc(ev.lastSubject || '—') + ' (' + esc(fmtDate(ev.lastAt)) + ') · '
        + esc(String(ev.count)) + ' ' + esc(t('evidenceMsgs')) + '</div>';
    } else {
      evLine = '<div class="r-line">📩 ' + esc(t('evidenceNone')) + '</div>';
    }
    var mismatchLine = (rep && rep.status === 'failed' && ev && ev.count > 0)
      ? '<div class="r-line"><span class="pill pill-red">' + esc(t('mismatchFlag')) + '</span></div>'
      : '';
    /* Same row pattern as the receipts panel: thumbnail (tap = lightbox),
       info, approve/reject. */
    return '<div class="receipt-row order-row status-' + esc(o.status) + '" data-order-id="' + esc(o.id) + '">'
      + (img
        ? '<img class="receipt-thumb" src="' + esc(img) + '" alt="Receipt" data-full="' + esc(img) + '">'
        : '<div class="receipt-thumb"></div>')
      + '<div class="receipt-info">'
      + '<div class="r-gmail">' + esc(o.maskedEmail) + '</div>'
      + '<div class="r-line">' + esc(t('buyer')) + ': ' + esc(o.buyerGmail) + '</div>'
      + '<div class="r-line">' + priceLine + '</div>'
      + '<div class="r-line">' + esc(t('method')) + ': ' + esc(o.method || '—') + '</div>'
      + '<div class="r-line">' + esc(fmtDate(o.createdAt)) + '</div>'
      + repLine + evLine + mismatchLine
      + '</div>'
      + pill
      + actions
      + '</div>';
  }).join('');
  show($('ordersEmpty'), sorted.length === 0);
}
var LOGO_MAX_BYTES = 5 * 1024 * 1024; /* ~5MB, same as receipt images (server MARKET_IMAGE_MAX_CHARS) */
function readFileAsDataURL(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(new Error('read')); };
    r.readAsDataURL(file);
  });
}
function onListingLogoChange() {
  var file = $('listingLogo').files && $('listingLogo').files[0];
  var prev = $('listingLogoPreview');
  if (!file) { prev.removeAttribute('src'); prev.hidden = true; return; }
  if (file.size > LOGO_MAX_BYTES) {
    $('listingLogo').value = '';
    prev.removeAttribute('src');
    prev.hidden = true;
    return showError($('listingError'), t('errLogoTooBig'));
  }
  showError($('listingError'), '');
  readFileAsDataURL(file).then(function (url) { prev.src = url; prev.hidden = false; });
}
async function onListingSubmit(e) {
  e.preventDefault();
  var email = $('listingEmail').value.trim();
  var pass = $('listingPass').value;
  var priceRaw = $('listingPrice').value.trim();
  var price = Number(priceRaw);
  var title = $('listingTitle').value.trim();
  var seller = $('listingSeller').value.trim() || 'admin';
  if (!email || !pass || !title || priceRaw === '' || isNaN(price) || price <= 0) {
    return showError($('listingError'), t('errListingFields'));
  }
  var logoFile = $('listingLogo').files && $('listingLogo').files[0];
  var token = $('listingToken').value.trim();
  var ip = $('listingIp').value.trim();
  var ccRaw = $('listingCountryCity').value.trim();
  /* "Country, City" — split on the first comma; a bare country with no
     comma is accepted as country only. */
  var ccParts = ccRaw.split(',');
  var country = (ccParts[0] || '').trim();
  var city = ccParts.slice(1).join(',').trim();
  var logoDataUrl = '';
  if (logoFile) {
    if (logoFile.size > LOGO_MAX_BYTES) {
      return showError($('listingError'), t('errLogoTooBig'));
    }
    try { logoDataUrl = await readFileAsDataURL(logoFile); }
    catch (err) { return showError($('listingError'), t('errListing')); }
  }
  showError($('listingError'), '');
  var btn = $('createListingBtn');
  btn.disabled = true;
  try {
    /* The password is sent once in this request body and is never kept:
       the field is cleared below and no cache ever holds it. */
    await api('/api/admin/market/listings', {
      method: 'POST',
      body: { email: email, password: pass, price: price, title: title, sellerGmail: seller, logoDataUrl: logoDataUrl, token: token, ip: ip, country: country, city: city }
    });
    $('listingLogo').value = '';
    $('listingLogoPreview').removeAttribute('src');
    $('listingLogoPreview').hidden = true;
    $('listingToken').value = '';
    $('listingIp').value = '';
    $('listingCountryCity').value = '';
    $('listingEmail').value = '';
    $('listingPass').value = '';
    $('listingPrice').value = '';
    $('listingTitle').value = '';
    $('listingSeller').value = 'admin';
    toast(t('toastListingCreated'));
    loadListings();
  } catch (err) {
    /* Server error text surfaces here (e.g. 400 Mail.tm verification
       failed) via api()'s thrown message. */
    showError($('listingError'), err && err.message ? err.message : t('errListing'));
  } finally { btn.disabled = false; }
}
async function removeListing(id) {
  try {
    await api('/api/admin/market/listings/' + encodeURIComponent(id), { method: 'DELETE' });
  } catch (err) {
    /* Proxy may expose POST .../:id/remove instead of DELETE — fall back
       only on 404/405 (endpoint missing), not on other failures. */
    if (err && (err.status === 404 || err.status === 405)) {
      await api('/api/admin/market/listings/' + encodeURIComponent(id) + '/remove', { method: 'POST' });
    } else { throw err; }
  }
}
async function onListingsClick(e) {
  /* Per-listing health check: one call per click (button disabled +
     spinner while the check runs, so it can never be hammered). */
  var checkBtn = e.target.closest('[data-listing-check]');
  if (checkBtn) {
    var checkId = checkBtn.dataset.listingCheck;
    checkBtn.disabled = true;
    var checkLabel = checkBtn.textContent;
    checkBtn.innerHTML = '<span class="spinner spinner-dark" aria-hidden="true"></span> ' + esc(t('checking'));
    try {
      await api('/api/admin/market/listings/' + encodeURIComponent(checkId) + '/check', { method: 'POST' });
      toast(t('toastHealthChecked'));
      loadListings();
    } catch (err) {
      showError($('listingsError'), err && err.message ? err.message : t('errHealth'));
      checkBtn.disabled = false;
      checkBtn.textContent = checkLabel;
    }
    return;
  }
  /* Manual health toggle — the admin flips health by hand because a
     Mail.tm login cannot detect a game/AI company banning the account. */
  var healthBtn = e.target.closest('[data-listing-health]');
  if (healthBtn) {
    var healthId = healthBtn.dataset.id;
    var target = healthBtn.dataset.listingHealth === 'bad' ? 'bad' : 'good';
    healthBtn.disabled = true;
    try {
      await api('/api/admin/market/listings/' + encodeURIComponent(healthId) + '/health', { method: 'POST', body: { health: target } });
      toast(t('toastHealthSet'));
      loadListings();
    } catch (err) {
      showError($('listingsError'), err && err.message ? err.message : t('errHealth'));
      healthBtn.disabled = false;
    }
    return;
  }
  /* v1.7d: Re-list — put a sold account back in the shop. One
     click; the server reuses the stored password, so Mov never
     types one. A dead mailbox answers 400 and stays sold. */
  var relistBtn = e.target.closest('[data-listing-relist]');
  if (relistBtn) {
    var relistId = relistBtn.dataset.listingRelist;
    if (!window.confirm(t('confirmRelist'))) return;
    relistBtn.disabled = true;
    try {
      await api('/api/admin/market/listings/' + encodeURIComponent(relistId) + '/relist', { method: 'POST' });
      toast(t('toastListingRelisted'));
      loadListings();
    } catch (err) {
      showError($('listingsError'), err && err.message ? err.message : t('errRelist'));
      relistBtn.disabled = false;
    }
    return;
  }
  var btn = e.target.closest('[data-listing-remove]');
  if (!btn) return;
  var id = btn.dataset.listingRemove;
  if (!window.confirm(t('confirmRemoveListing'))) return;
  btn.disabled = true;
  try {
    await removeListing(id);
    toast(t('toastListingRemoved'));
    loadListings();
  } catch (err) {
    showError($('listingsError'), err && err.message ? err.message : t('errLoad'));
    btn.disabled = false;
  }
}
async function onOrderActionClick(e) {
  var btn = e.target.closest('[data-order-action]');
  if (!btn) return;
  var id = btn.dataset.id, action = btn.dataset.orderAction;
  btn.disabled = true;
  try {
    await api('/api/admin/market/orders/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
    toast(action === 'approve' ? t('toastOrderApproved') : t('toastOrderRejected'));
    /* Approval sells the listing — refresh both panels. */
    loadOrders();
    loadListings();
  } catch (err) {
    var msg = (err && err.message) ? err.message : t('errOrder');
    showError($('ordersError'), msg);
    toast(msg);
    btn.disabled = false;
  }
}

/* ---------- Tabs / settings / misc ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + name; });
  if (name === 'users') loadUsers();
  if (name === 'codes') loadCodes();
  if (name === 'receipts') loadReceipts();
  if (name === 'listings') loadListings();
  if (name === 'orders') loadOrders();
  if (name === 'notifications') loadNotifications();
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
    renderExpirySeg();
    if (isLoggedIn()) { renderUsers(); renderCodes(); renderReceipts(); renderListings(); renderOrders(); renderNotifications(); updateNotifBadge(); updateStats(); renderRecipientList(); renderSendResults(lastSendResults); }
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
  $('expirySeg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn');
    if (!b) return;
    selectedExpiryDays = Number(b.dataset.days) || 1;
    renderExpirySeg();
  });
  renderExpirySeg();
  renderRecipientList();
  $('recipientList').addEventListener('change', onRecipientListChange);
  $('selectAllBtn').addEventListener('click', selectAllRecipients);
  $('clearSelBtn').addEventListener('click', clearRecipients);
  $('sendResultsList').addEventListener('click', onSendResultsClick);
  $('codesList').addEventListener('click', onCodeActionClick);

  $('receiptsList').addEventListener('click', function (e) {
    if (e.target.closest('[data-receipt-action]')) onReceiptActionClick(e);
    else onReceiptThumbClick(e);
  });
  $('listingForm').addEventListener('submit', onListingSubmit);
  $('listingLogo').addEventListener('change', onListingLogoChange);
  $('listingsList').addEventListener('click', onListingsClick);
  $('markNotifReadBtn').addEventListener('click', onMarkNotifReadClick); /* v1.9 */
  $('notifList').addEventListener('click', onNotifForwardClick); /* v1.9b: Send to buyer */
  $('ordersList').addEventListener('click', function (e) {
    if (e.target.closest('[data-order-action]')) onOrderActionClick(e);
    else onReceiptThumbClick(e); /* same lightbox as receipts */
  });
  $('lightboxClose').addEventListener('click', function () { show($('lightbox'), false); });
  $('lightbox').addEventListener('click', function (e) { if (e.target === $('lightbox')) show($('lightbox'), false); });

  if (getSetup() && isLoggedIn()) showApp();
  else showAuth();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
