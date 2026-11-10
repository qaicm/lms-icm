/* LMS ICM · app.js — dibangun dari src/js/*.js (jangan diedit manual) */
/**
 * ============================================================
 * LMS ICM — Frontend SPA (js/app.js) · di-hosting di GitHub Pages
 * Backend: Google Apps Script sebagai REST API (URL /exec di js/config.js)
 * Prinsip gas-instant-ux-pro:
 *  1. SPA klien   : semua halaman dirender dari state lokal (0 panggilan saat pindah menu)
 *  2. Optimistic  : UI diperbarui dulu → antrean sinkron (Outbox) di latar + reqId idempoten
 *  3. Cache       : snapshot data per pengguna di localStorage (stale-while-revalidate)
 *  4. Batch       : login + bootstrap dalam 1 panggilan; 1 aksi = 1 panggilan
 *  5. Tahan HP    : fetch text/plain (tanpa CORS preflight), timeout, retry baca, warm-up
 * Token sesi dikirim di body POST — tidak pernah di URL.
 * ============================================================
 */
'use strict';

// ════════════════════════════════════════════════════════════
// BAGIAN 0 · UTILITAS
// ════════════════════════════════════════════════════════════
let BOOT = {};                                           // konfigurasi publik dari server (fn=boot), di-cache di perangkat
const GAS_URL = String((window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '').trim();
const CONFIG_OK = /^https?:\/\/[^\s]+\/exec$/.test(GAS_URL) && !/GANTI|XXXX/i.test(GAS_URL);
window.APP_BUILD = 'LP3-261110-1027';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const E = escHtml;                                       // dari kode bersama
const ic = (n, cls) => `<i class="bi bi-${n}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const clone = o => JSON.parse(JSON.stringify(o));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const nowIso = () => { const d = new Date(), off = -d.getTimezoneOffset(), p = n => String(Math.floor(Math.abs(n))).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + (off >= 0 ? '+' : '-') + p(off / 60) + ':' + p(off % 60); };
const todayYmd = () => nowIso().slice(0, 10);
const ts = s => (s ? new Date(s).getTime() : 0);
const plural = (n, w) => `${n} ${w}`;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmtPct = v => (Math.round(v * 10) / 10).toLocaleString('id-ID') + '%';
const sum = arr => arr.reduce((a, b) => a + (+b || 0), 0);
const uniq = arr => Array.from(new Set(arr));
const byKey = (arr, k) => { const m = {}; arr.forEach(x => { m[x[k]] = x; }); return m; };

function relTime(iso) {
  if (!iso) return '—';
  const d = ts(iso), diff = Date.now() - d, m = Math.round(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return m + ' menit lalu';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' jam lalu';
  const days = Math.round(h / 24);
  if (days === 1) return 'kemarin, ' + String(iso).slice(11, 16);
  if (days < 7) return days + ' hari lalu';
  return fmtTanggal(iso);
}
function relDay(ymd) {
  if (!ymd) return '';
  const d = Math.round((ts(ymd + 'T00:00:00') - ts(todayYmd() + 'T00:00:00')) / 864e5);
  if (d === 0) return 'Hari ini'; if (d === 1) return 'Besok'; if (d === -1) return 'Kemarin';
  if (d > 1 && d < 7) return d + ' hari lagi'; if (d < -1 && d > -7) return Math.abs(d) + ' hari lalu';
  return fmtTanggal(ymd);
}
function waitDays(iso) { return iso ? Math.max(0, (Date.now() - ts(iso)) / 864e5) : 0; }
function fmtWait(iso) {
  const h = (Date.now() - ts(iso)) / 36e5;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' Menit';
  if (h < 24) return Math.round(h) + ' Jam';
  return Math.floor(h / 24) + ' Hari';
}
function fmtSize(b) { b = +b || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function initials(name) {
  const clean = String(name || '').replace(/\b(Dr|Dra|Drs|Ust|Ustadzah|Prof|Ir|H|Hj)\.?\s+/gi, '').split(',')[0].trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function firstName(name) { return String(name || '').replace(/\b(Dr|Dra|Drs|Ust|Prof|Ir)\.?\s+/gi, '').split(/[\s,]+/)[0]; }
function greet() { const h = new Date().getHours(); return h < 11 ? 'Selamat Pagi' : h < 15 ? 'Selamat Siang' : h < 18 ? 'Selamat Sore' : 'Selamat Malam'; }
const avatarTone = r => ({ TEACHER: '', LEADER: 'sky', QA: 'amber', SUPERADMIN: 'green' }[r] || '');

const STATUS_LABEL = { DRAFT: 'Draft', PENDING: 'Pending Approval', RETURNED: 'Perlu Revisi', APPROVED: 'Disetujui', DELETED: 'Dihapus' };
const ROLE_LABEL = { TEACHER: 'Guru', LEADER: 'Pimpinan', QA: 'QA Admin', SUPERADMIN: 'Super Admin' };
const pill = st => `<span class="pill pill-${E(st)}">${E(STATUS_LABEL[st] || st)}</span>`;

/** localStorage aman (iframe pihak ketiga / Safari bisa menolak). */
const LS = {
  k: k => 'lmsicm:' + k,
  get(k, d) { try { const v = localStorage.getItem(this.k(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(this.k(k), JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(this.k(k)); } catch (e) { /* abaikan */ } }
};
const SS = {
  get(k) { try { return sessionStorage.getItem('lmsicm:' + k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem('lmsicm:' + k, v); } catch (e) { /* abaikan */ } },
  del(k) { try { sessionStorage.removeItem('lmsicm:' + k); } catch (e) { /* abaikan */ } }
};

// ════════════════════════════════════════════════════════════
// BAGIAN 1 · STATE APLIKASI (sumber kebenaran di klien)
// ════════════════════════════════════════════════════════════
const S = {
  token: null, remember: true, me: null, config: {}, refs: [], terms: [], activeTermId: '', people: {}, vers: {},
  chapters: [], lps: [], atts: [],               // data kerja guru
  lpsAll: [],                                    // ringkasan lintas guru (pimpinan/QA)
  chapterStats: [], themes: [], draftCounts: {}, users: [], audit: [],
  detail: {},                                    // cache detail LP per id
  route: { name: '', params: {} }, history: [],
  ui: {}, builder: null, review: null, form: null,
  lastSync: 0, charts: {}, uploads: {}
};

const isRole = (...r) => S.me && r.indexOf(S.me.peran) >= 0;
const refsOf = kat => S.refs.filter(r => r.kategori === kat && r.aktif).sort((a, b) => a.urutan - b.urutan);
const refLabel = (kat, kode) => { const r = S.refs.find(x => x.kategori === kat && x.kode === kode); return r ? r.label : kode; };
const refDesc = (kat, kode) => { const r = S.refs.find(x => x.kategori === kat && x.kode === kode); return r ? r.deskripsi : ''; };
const unitLabel = k => refLabel('UNIT', k);
const unitShort = k => { const r = S.refs.find(x => x.kategori === 'UNIT' && x.kode === k); return r && r.deskripsi ? r.deskripsi : k; };
const unitAlokasi = k => { const r = S.refs.find(x => x.kategori === 'UNIT' && x.kode === k); return r && r.nilai ? +r.nilai : 0; };
/** Pilihan alokasi sesi (1 Period, 2 Period, …) untuk unit tertentu — logika sama dengan periodOpts_ di server. */
function periodOpts(unit) {
  const opts = refsOf('PERIOD').filter(r => +r.nilai > 0).filter(r => {
    const sc = String(r.deskripsi || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
    return !sc.length || sc.includes('ALL') || sc.includes(String(unit).toUpperCase());
  }).map(r => ({ kode: r.kode, label: r.label, menit: +r.nilai }));
  if (!opts.length) { const m = unitAlokasi(unit); if (m) opts.push({ kode: 'UNIT', label: 'Alokasi unit', menit: m }); }
  return opts;
}
/** Alokasi sebuah pertemuan: pilihan guru → menit terdekat dengan total skenario → pilihan pertama. */
function sesAlok(se, unit) {
  const opts = periodOpts(unit), sc = (se && se.scenarios) || {}, tot = (+(sc.beginning || {}).menit || 0) + (+(sc.middle || {}).menit || 0) + (+(sc.end || {}).menit || 0);
  const hit = opts.find(o => o.kode === (se && se.alok_kode));
  if (hit || !opts.length) return hit || null;
  return tot > 0 ? opts.slice().sort((a, b) => Math.abs(a.menit - tot) - Math.abs(b.menit - tot) || b.menit - a.menit)[0] : opts[0];
}
/** Jumlah period sebuah pilihan alokasi ("2P"/"2 Period" → 2), sama dengan periodCount_ di server. */
function periodCount(opt, unit) {
  if (!opt) return 0;
  const m = /(\d+)/.exec(String(opt.kode)) || /(\d+)/.exec(String(opt.label));
  if (m && +m[1] > 0 && +m[1] <= 12) return +m[1];
  const base = periodOpts(unit).map(o => o.menit).sort((a, b) => a - b)[0] || opt.menit;
  return Math.max(1, Math.round(opt.menit / base));
}
/** Menit untuk 1 period di sebuah unit (untuk menaksir period dari total menit pada ringkasan). */
const periodMinutes = unit => { const o = periodOpts(unit).find(x => periodCount(x, unit) === 1); return o ? o.menit : 40; };
const sesMinutes = se => { const sc = (se && se.scenarios) || {}; return (+(sc.beginning || {}).menit || 0) + (+(sc.middle || {}).menit || 0) + (+(sc.end || {}).menit || 0); };
/** Total period sebuah LP: dari daftar pertemuan bila ada, kalau tidak ditaksir dari total menit. */
function lpPeriods(lp) {
  if (lp.sessions && lp.sessions.length) return lp.sessions.reduce((a, se) => a + periodCount(sesAlok(se, lp.unit), lp.unit), 0);
  return lp.durasi_total ? Math.round(lp.durasi_total / periodMinutes(lp.unit)) : 0;
}
const alokText = a => a ? a.label + ' · ' + a.menit + ' menit' : '';
const round5 = x => Math.round(x / 5) * 5;
/** Skenario bawaan untuk alokasi m menit (±15% pembuka, ±15% penutup, sisanya inti). */
function defScen(m) { const b = Math.max(5, round5(m * 0.15)); return { beginning: b, middle: Math.max(5, m - 2 * b), end: b }; }
/** Skalakan durasi skenario secara proporsional agar totalnya tepat m menit (kelipatan 5, inti menyerap sisa). */
function fitScen(sc, m) {
  const tot = (+sc.beginning.menit || 0) + (+sc.middle.menit || 0) + (+sc.end.menit || 0);
  let b, e;
  if (tot > 0) { b = Math.max(5, round5(sc.beginning.menit * m / tot)); e = Math.max(5, round5(sc.end.menit * m / tot)); }
  if (!tot || m - b - e < 5) { const d = defScen(m); b = d.beginning; e = d.end; }
  sc.beginning.menit = b; sc.end.menit = e; sc.middle.menit = m - b - e;
}
const gradeLabel = k => refLabel('GRADE', k);
const termById = id => S.terms.find(t => t.term_id === id) || null;
const activeTerm = () => termById(S.activeTermId) || S.terms.find(t => t.status === 'ACTIVE') || S.terms[0] || null;
const viewTerm = () => termById(S.ui.termId) || activeTerm();
const termLabel = t => (t ? `Term ${t.term} · ${t.tahun_ajaran}` : '—');
const person = id => S.people[id] || {};
const myUnits = () => (S.me ? (S.me.unit === 'ALL' ? ['ECP', 'PS', 'MS', 'HS'] : String(S.me.unit).split(',').map(s => s.trim()).filter(Boolean)) : []);
const cfg = (k, d) => (S.config && S.config[k] != null && S.config[k] !== '' ? S.config[k] : d);
/** Period per minggu mapel di satu kelas (Master Data → Period per Mapel). */
const subjPeriod = (unit, mapel, kelas) => { const r = S.refs.find(x => x.kategori === 'SUBJ_PERIOD' && x.aktif && x.kode === [unit, mapel, kelas].join('|')); return r && +r.nilai > 0 ? +r.nilai : 0; };
/** Anggaran period term untuk mapel+kelas: minggu efektif × period/minggu. */
function termBudget(t, unit, mapel, kelas) { const w = t ? +t.minggu_efektif || 0 : 0, ppm = subjPeriod(unit, mapel, kelas); return { weeks: w, ppm, total: w * ppm }; }
/** Period yang dipakai chapter AKTIF guru ini (mapel+kelas+term), kecuali satu chapter. */
const usedPeriods = (termId, mapel, kelas, exceptId) => sum(S.chapters.filter(c => c.term_id === termId && c.mata_pelajaran === mapel && String(c.kelas) === String(kelas) && c.status === 'AKTIF' && c.chapter_id !== exceptId).map(c => +c.jumlah_period || 0));
/** Perkiraan minggu efektif dari rentang tanggal (sama dengan autoWeeks_ di server). */
const autoWeeks = (a, b) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(a || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b || '')) return 0; const d = Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1; return Math.max(1, Math.round(d / 7)); };
const diffMode = () => (String(cfg('diff_mode', 'SATU')).toUpperCase() === 'BARIS' ? 'BARIS' : 'SATU');

/** Simpan snapshot data ke perangkat (debounce) agar pembukaan berikutnya instan. */
const persist = debounce(() => {
  if (!S.me) return;
  const snap = {
    v: 1, at: Date.now(), me: S.me, config: S.config, refs: S.refs, terms: S.terms, activeTermId: S.activeTermId, people: S.people, vers: S.vers,
    chapters: S.chapters, lps: S.lps, atts: S.atts, lpsAll: S.lpsAll, chapterStats: S.chapterStats, themes: S.themes, draftCounts: S.draftCounts,
    users: S.users, audit: S.audit.slice(0, 60)
  };
  if (!LS.set('data:' + S.me.user_id, snap)) { LS.del('data:' + S.me.user_id); }
}, 400);

function decodeColumnar(c) { if (!c || !c.c) return []; return c.r.map(r => { const o = {}; c.c.forEach((k, i) => { o[k] = r[i]; }); return o; }); }

/** Terapkan data bootstrap dari server (atau snapshot lokal). */
function applyBoot(b, fromSnapshot) {
  const prevLps = S.lps || [];
  S.me = b.me; S.config = b.config || {}; S.refs = b.refs || []; S.terms = b.terms || []; S.activeTermId = b.activeTermId || ''; S.people = b.people || {};
  S.vers = b.vers || S.vers || {};
  if (b.ws) {
    // Pertahankan item yang masih menunggu sinkron (optimistic) agar tidak tertimpa data server lama
    const pend = Outbox.pendingKeys();
    const keepCh = S.chapters.filter(c => pend['ch:' + c.chapter_id]);
    const keepLp = S.lps.filter(l => pend['lp:' + l.lp_id]);
    S.chapters = mergeKeep(b.ws.chapters, keepCh, 'chapter_id');
    S.lps = mergeKeep(b.ws.lps, keepLp, 'lp_id');
    // Pertahankan isi lengkap (payload) LP yang sudah pernah dibuka
    const prevFull = byKey(prevLps, 'lp_id');
    S.lps = S.lps.map(l => (!l.full && prevFull[l.lp_id] && prevFull[l.lp_id].full && prevFull[l.lp_id].diubah_pada === l.diubah_pada ? Object.assign({}, prevFull[l.lp_id], l, { full: true }) : l));
    S.atts = b.ws.attachments || [];
  }
  if (b.lps) S.lpsAll = Array.isArray(b.lps) ? b.lps : decodeColumnar(b.lps);
  if (b.lpsAll) S.lpsAll = b.lpsAll;
  if (S.lpsAll.length && !b.lpsNotModified) {
    const pend = Outbox.pendingKeys();
    S.lpsAll = S.lpsAll.map(l => (pend['dec:' + l.lp_id] ? Object.assign({}, l, (S._decided || {})[l.lp_id] || {}) : l));
  }
  if (b.chapterStats) S.chapterStats = b.chapterStats;
  if (b.themes) S.themes = b.themes;
  if (b.draftCounts) S.draftCounts = b.draftCounts;
  if (b.users) S.users = b.users;
  if (b.audit) S.audit = b.audit;
  if (!S.ui.termId || !termById(S.ui.termId)) S.ui.termId = S.activeTermId;
  if (!fromSnapshot) { S.lastSync = Date.now(); persist(); }
}
function mergeKeep(server, keep, k) {
  const m = byKey(server || [], k);
  keep.forEach(x => { m[x[k]] = x; });
  return Object.keys(m).map(id => m[id]);
}

// ════════════════════════════════════════════════════════════
// BAGIAN 2 · RPC (fetch → GAS /exec, JSON)
// ════════════════════════════════════════════════════════════
/** Fungsi/aksi baca: aman diulang otomatis bila koneksi putus. */
const READ_FN = { boot: 1, resume: 1, apiBatch: 1 };
const READ_API = { 'bootstrap': 1, 'lp.get': 1, 'lp.pdf': 1, 'file.get': 1, 'report.pdf': 1, 'audit.list': 1 };
const RPC_LOG = [];                                      // diagnosa: ketik RPC_LOG di Console (aksi, total ms, ms server)
window.__rpcCount = 0;

function rpcOnce(fn, args, timeout) {
  const ctrl = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), timeout);
  const t0 = performance.now();
  window.__rpcCount++;
  return fetch(GAS_URL, {
    method: 'POST', redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // permintaan "simple" → tanpa CORS preflight
    body: JSON.stringify({ fn, args })
  }).then(res => res.text().then(text => {
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw Object.assign(new Error(res.status === 200 ? 'Server membalas bukan JSON. Pastikan GAS_URL adalah URL /exec dan akses Web App "Anyone".' : 'Server membalas HTTP ' + res.status + '.'), { code: 'NET', retry: res.status >= 500 || res.status === 429 });
    }
    RPC_LOG.push({ fn: fn === 'api' ? args[1] : fn, total: Math.round(performance.now() - t0), server: j && j.ms });
    if (RPC_LOG.length > 60) RPC_LOG.shift();
    return j;
  }), err => {
    if (err && err.code === 'NET') throw err;
    const aborted = err && err.name === 'AbortError';
    throw Object.assign(new Error(aborted ? 'Server terlalu lama merespons. Coba lagi.' : (navigator.onLine === false ? 'Perangkat sedang offline.' : 'Tidak dapat terhubung ke server.')), { code: 'NET', retry: true });
  }).finally(() => clearTimeout(timer));
}

/**
 * Panggil fungsi backend: rpc('login', email, pw, remember), rpc('api', token, action, payload, reqId).
 * Baca diulang otomatis (maks 3×, jeda bertahap); tulis tidak diulang di sini —
 * Outbox yang mengulang dengan reqId yang sama sehingga server tidak menggandakan data.
 */
async function rpc(fn, ...args) {
  if (!CONFIG_OK) throw Object.assign(new Error('GAS_URL di js/config.js belum diisi.'), { code: 'CONFIG' });
  const isRead = READ_FN[fn] || (fn === 'api' && READ_API[args[1]]);
  const tries = isRead ? 3 : 1;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) { await new Promise(r => setTimeout(r, 1200 * i)); if (navigator.onLine === false) await waitOnline(15000); }
    try { return await rpcOnce(fn, args, isRead ? (i ? 45000 : 25000) : 120000); }
    catch (e) { lastErr = e; if (!e.retry) break; }
  }
  throw lastErr;
}
function waitOnline(ms) { return new Promise(r => { if (navigator.onLine !== false) return r(); const t = setTimeout(done, ms); function done() { clearTimeout(t); window.removeEventListener('online', done); r(); } window.addEventListener('online', done); }); }
/** Bangunkan server GAS (cold start) tanpa menunggu jawaban. */
function warmUp() { if (CONFIG_OK) try { fetch(GAS_URL + '?ping=' + Date.now(), { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).catch(() => {}); } catch (e) { /* abaikan */ } }

/** Panggil aksi API terautentikasi. Menolak dengan Error ber-kode bila gagal. */
function call(action, payload, reqId) {
  // Aksi tulis selalu membawa reqId → aman bila terkirim dua kali
  if (!reqId && !READ_API[action]) reqId = uid();
  return rpc('api', S.token, action, payload || {}, reqId || '').then(res => {
    if (!res || !res.success) {
      const err = Object.assign(new Error((res && res.message) || 'Terjadi kesalahan.'), { code: (res && res.code) || 'ERROR', data: res && res.data });
      if (err.code === 'AUTH') onAuthLost(err.message);
      throw err;
    }
    return res.data;
  });
}

// ════════════════════════════════════════════════════════════
// BAGIAN 3 · OUTBOX — antrean sinkron optimistic (tahan reload)
// ════════════════════════════════════════════════════════════
const RETRYABLE = { NET: 1, BUSY: 1, ERROR: 1 };
const Outbox = {
  items: [], running: false, timer: null, lastError: null,
  key() { return S.me ? 'outbox:' + S.me.user_id : null; },
  load() { this.items = (this.key() && LS.get(this.key(), [])) || []; this.items.forEach(i => { i.inflight = false; }); this.render(); },
  save() { if (this.key()) LS.set(this.key(), this.items.map(i => Object.assign({}, i, { inflight: false }))); this.render(); },
  pendingKeys() { const m = {}; this.items.forEach(i => { if (i.key) m[i.key] = 1; }); return m; },
  has(key) { return this.items.some(i => i.key === key); },
  /** Tambah aksi. Aksi dengan key sama & belum dikirim digabung (coalesce). */
  push(action, payload, opt) {
    opt = opt || {};
    const item = { id: uid(), action, payload, key: opt.key || null, label: opt.label || action, prev: opt.prev || null, tries: 0, at: Date.now() };
    if (item.key) {
      const replaceable = { 'lp.save': 1, 'chapter.save': 1, 'config.save': 1 };
      this.items = this.items.filter(i => i.inflight || i.key !== item.key || !(replaceable[i.action] && (i.action === action || action === 'lp.submit' || action === 'lp.delete')));
      if (action === 'config.save') { const old = this.items.find(i => i.key === item.key && !i.inflight && i.action === 'config.save'); if (old) item.payload = Object.assign({}, old.payload, payload); }
    }
    this.items.push(item);
    this.save();
    this.kick(0);
    return item.id;
  },
  drop(key) { this.items = this.items.filter(i => i.inflight || i.key !== key); this.save(); },
  kick(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.process(), ms || 0); },
  async process() {
    if (this.running || !S.token) return;
    const item = this.items[0];
    if (!item) { this.render(); return; }
    this.running = true; item.inflight = true; this.render();
    try {
      const data = await call(item.action, item.payload, item.id);   // id item = reqId (idempoten)
      this.items = this.items.filter(i => i.id !== item.id);
      this.lastError = null;
      (RECON[item.action] && RECON[item.action].ok) && RECON[item.action].ok(data, item);
      persist();
    } catch (err) {
      item.inflight = false; item.tries++;
      if (err.code === 'AUTH') { this.running = false; this.save(); return; }
      if (RETRYABLE[err.code] && item.tries < 8) {
        this.lastError = err.message; this.running = false; this.save();
        this.kick(Math.min(60000, 1500 * Math.pow(2, item.tries)));
        return;
      }
      // Ditolak server (validasi/terkunci/konflik) → batalkan perubahan optimistic
      this.items = this.items.filter(i => i.id !== item.id);
      (RECON[item.action] && RECON[item.action].fail) ? RECON[item.action].fail(err, item) : toast('error', 'Gagal menyimpan', err.message);
      persist();
    }
    this.running = false; this.save();
    if (this.items.length) this.kick(30);
    else { refreshCurrentQuiet(); }
  },
  render() {
    const el = $('#syncPill'); if (!el) return;
    const n = this.items.length;
    el.className = 'sync-pill' + (n ? (this.lastError ? ' err' : ' busy') : '');
    el.innerHTML = `<span class="s-dot"></span><span class="hide-mobile">${n ? (this.lastError ? 'Gagal sinkron · coba lagi' : 'Menyinkron ' + n + '…') : 'Tersimpan'}</span>`;
    el.title = n ? (this.lastError || 'Perubahan sedang dikirim ke server') : 'Semua perubahan sudah tersimpan di server';
  }
};

/** Rekonsiliasi hasil server per aksi (didefinisikan juga oleh modul halaman). */
const RECON = {};

// ════════════════════════════════════════════════════════════
// BAGIAN 4 · UI KIT: toast, modal, drawer, menu, unduhan
// ════════════════════════════════════════════════════════════
function toast(type, title, msg, opt) {
  opt = opt || {};
  const root = $('#toastRoot');
  const el = document.createElement('div');
  const icn = { success: 'check-circle-fill', error: 'exclamation-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' }[type] || 'info-circle-fill';
  el.className = 'toast-x ' + type;
  if (opt.page) el.dataset.page = '1'; // toast terkait halaman: ditutup saat pindah halaman
  if (opt.id) { dismissToast(opt.id); el.dataset.tid = opt.id; }       // id sama → ganti, bukan menumpuk
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="ic">${ic(icn)}</span><div class="flex-grow-1"><div class="tt">${E(title)}</div>${msg ? `<div class="tm">${E(msg)}</div>` : ''}${opt.action ? `<button class="link-btn mt-1 fs-sm" data-t="act">${E(opt.action.label)}</button>` : ''}</div><button class="cl" aria-label="Tutup">${ic('x-lg')}</button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  el.querySelector('.cl').onclick = close;
  if (opt.action) el.querySelector('[data-t=act]').onclick = () => { close(); opt.action.fn(); };
  root.appendChild(el);
  while (root.children.length > 4) root.firstChild.remove();
  setTimeout(close, opt.ms || (type === 'error' ? 7000 : 4200));
}
function dismissToast(id) { $$('#toastRoot .toast-x').forEach(t => { if (t.dataset.tid === id) t.remove(); }); }
function clearPageToasts() { $$('#toastRoot .toast-x[data-page]').forEach(t => t.remove()); }

let modalStack = [];
function modal(o) {
  const back = document.createElement('div');
  back.className = 'mdl-back';
  back.innerHTML = `<div class="mdl ${o.size || ''}" role="dialog" aria-modal="true" aria-label="${E(o.title || 'Dialog')}">${o.html}</div>`;
  const prevFocus = document.activeElement;
  const api = {
    el: back.firstChild,
    close(v) { back.remove(); modalStack = modalStack.filter(m => m !== api); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* abaikan */ } o.onClose && o.onClose(v); }
  };
  back.addEventListener('mousedown', e => { if (e.target === back && !o.sticky) api.close(); });
  back.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) api.close(); });
  $('#modalRoot').appendChild(back);
  modalStack.push(api);
  o.onMount && o.onMount(api.el, api);
  setTimeout(() => { const f = api.el.querySelector('[autofocus], textarea, input:not([type=checkbox]), .btn-primary'); f && f.focus(); }, 30);
  return api;
}
function confirmDlg(o) {
  return new Promise(res => {
    const tone = o.tone || 'primary';
    modal({
      title: o.title, onClose: v => res(!!v),
      html: `<div class="mdl-head"><div class="d-flex gap-3 align-items-start"><span class="icon-tile ${o.iconTone || ''}">${ic(o.icon || 'question-circle')}</span><div><h3>${E(o.title)}</h3><div class="text-2 mt-1">${o.message || ''}</div></div></div></div>
        <div class="mdl-foot"><button class="btn btn-ghost" data-close>${E(o.cancel || 'Batal')}</button><button class="btn btn-${tone}" data-ok>${E(o.ok || 'Ya, lanjutkan')}</button></div>`,
      onMount: (el, m) => { el.querySelector('[data-ok]').onclick = () => m.close(true); }
    });
  });
}
function drawer(o) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="drawer-back"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="${E(o.title)}"><div class="drawer-head"><div><div class="eyebrow">${E(o.eyebrow || '')}</div><h3 class="fs-5 fw-8">${E(o.title)}</h3></div><button class="btn-icon" data-close aria-label="Tutup">${ic('x-lg')}</button></div><div class="drawer-body">${o.body}</div><div class="drawer-foot">${o.foot || ''}</div></section>`;
  const api = { el: wrap.querySelector('.drawer'), close() { wrap.remove(); modalStack = modalStack.filter(m => m !== api); } };
  wrap.querySelector('.drawer-back').onclick = api.close;
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  $('#modalRoot').appendChild(wrap);
  modalStack.push(api);
  o.onMount && o.onMount(api.el, api);
  setTimeout(() => { const f = api.el.querySelector('input, select, textarea'); f && f.focus(); }, 40);
  return api;
}
let openMenu = null;
function popMenu(anchor, html, onMount) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu-pop';
  m.innerHTML = html;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth;
  let left = Math.min(window.innerWidth - w - 10, Math.max(10, r.right - w));
  let top = r.bottom + 8;
  if (top + m.offsetHeight > window.innerHeight - 10) top = Math.max(10, r.top - m.offsetHeight - 8);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  openMenu = m;
  onMount && onMount(m);
  setTimeout(() => document.addEventListener('mousedown', menuOutside), 0);
  return m;
}
function menuOutside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('mousedown', menuOutside); } }

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (openMenu) { closeMenu(); return; }
  const top = modalStack[modalStack.length - 1];
  if (top) top.close();
});

function b64ToBlob(b64, mime) {
  const bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'application/octet-stream' });
}
/** Unduh tanpa membuka tab baru / mengubah URL iframe. */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}
function downloadCsv(name, cols, rows) {
  const q = v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [cols.map(q).join(';')].concat(rows.map(r => r.map(q).join(';'))).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
  toast('success', 'Ekspor selesai', name + ' terunduh (buka dengan Excel / Google Sheets).');
}
function setBtnBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${E(label || 'Memproses…')}`; }
  else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}
function fileToB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Gagal membaca berkas.')); r.readAsDataURL(file); });
}
function pickFile(accept) {
  return new Promise(res => {
    const inp = $('#filePicker');
    inp.value = ''; inp.accept = accept || ''; inp.multiple = false;
    inp.onchange = () => res(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}
function copyText(t) {
  const done = () => toast('success', 'Disalin', t.length > 60 ? t.slice(0, 60) + '…' : t);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fallback());
  else fallback();
  function fallback() { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* abaikan */ } ta.remove(); }
}

/** Komponen kecil */
const emptyState = (icon, title, text, cta) => `<div class="empty"><div class="ill">${ic(icon)}</div><h4>${E(title)}</h4><p>${text}</p>${cta || ''}</div>`;
const skeletonPage = () => `<div class="sk sk-title"></div><div class="stat-grid">${'<div class="stat"><div class="sk sk-line" style="width:60%"></div><div class="sk" style="height:36px;width:40%;margin-top:auto"></div></div>'.repeat(4)}</div><div class="card-x"><div class="sk sk-line"></div><div class="sk sk-line" style="width:80%"></div><div class="sk sk-block mt-3"></div></div>`;
function statCard(o) {
  return `<div class="stat"><div class="stat-top"><div class="stat-label">${o.ey ? `<span class="ey">${E(o.ey)}</span>` : ''}${E(o.label)}</div><span class="icon-tile sm ${o.tone || ''}">${ic(o.icon)}</span></div>
    <div class="stat-value ${o.vtone || ''}">${o.value}${o.unit ? `<small>${E(o.unit)}</small>` : ''}</div>${o.spark || ''}<div class="stat-cap">${o.cap || ''}</div></div>`;
}
function pager(total, page, per, act) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (pages <= 1) return '';
  const btn = (p, l, on, dis) => `<button ${dis ? 'disabled' : ''} class="${on ? 'on' : ''}" data-act="${act}" data-page="${p}" aria-label="Halaman ${p}">${l}</button>`;
  let h = btn(page - 1, ic('chevron-left'), false, page <= 1);
  const show = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) show.push(p);
  let last = 0;
  show.forEach(p => { if (p - last > 1) h += '<button disabled>…</button>'; h += btn(p, p, p === page); last = p; });
  return `<div class="pager">${h + btn(page + 1, ic('chevron-right'), false, page >= pages)}</div>`;
}
/** Sparkline SVG ringan (tanpa library). */
function sparkline(vals, color) {
  vals = vals && vals.length ? vals : [0, 0];
  const w = 120, h = 34, max = Math.max(1, ...vals), min = Math.min(...vals, 0), st = w / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => [i * st, h - 4 - ((v - min) / Math.max(1, max - min)) * (h - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h} Z" fill="${color}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function whenChart(cb, tries) {
  if (window.Chart) { cb(); return; }
  if ((tries || 0) > 100) return;
  setTimeout(() => whenChart(cb, (tries || 0) + 1), 100);
}
function destroyCharts() { Object.keys(S.charts).forEach(k => { try { S.charts[k].destroy(); } catch (e) { /* abaikan */ } }); S.charts = {}; }

// ════════════════════════════════════════════════════════════
// BAGIAN 5 · SESI (login, resume, logout) — token di memori/perangkat, BUKAN di URL
// ════════════════════════════════════════════════════════════
function storedToken() { return SS.get('token') || LS.get('token', null); }
function storeToken(t, remember) {
  S.token = t; S.remember = remember;
  SS.set('token', t);
  if (remember) LS.set('token', t); else LS.del('token');
}

function start() {
  if (!CONFIG_OK) { renderConfigNeeded(); hideBoot(); return; }
  warmUp();                                               // bangunkan server GAS selagi layar disiapkan
  BOOT = LS.get('boot', null) || {};
  const tok = storedToken();
  if (!tok) {
    // Layar login tampil seketika dari konfigurasi tersimpan; diperbarui diam-diam di latar
    if (BOOT.ready) { showLogin(); refreshBoot(true); }
    else refreshBoot(false).then(ok => { if (ok) (BOOT.ready ? showLogin() : renderSetupNeeded()); });
    return;
  }
  S.token = tok;
  refreshBoot(true);
  // Stale-while-revalidate: tampilkan snapshot lokal SEKETIKA, lalu segarkan di latar
  const lastUid = LS.get('lastUid', null);
  const snap = lastUid ? LS.get('data:' + lastUid, null) : null;
  if (snap && snap.me) {
    applyBoot(snap, true);
    Outbox.load();
    enterApp(true);
    resumeSession(true);
  } else {
    resumeSession(false);
  }
}

/** Ambil konfigurasi publik (nama sekolah, akun demo, Client ID Google) dari server. */
function refreshBoot(quiet) {
  return rpc('boot').then(res => {
    if (!res || !res.success) throw Object.assign(new Error((res && res.message) || 'Server belum siap.'), { code: (res && res.code) || 'ERROR' });
    const before = JSON.stringify(BOOT);
    BOOT = res.data; LS.set('boot', BOOT);
    // Perbarui layar login bila konfigurasi berubah dan pengguna belum mulai mengetik
    const em = $('#lgEmail');
    if (quiet && em && !em.value && document.activeElement !== $('#lgPw') && before !== JSON.stringify(BOOT)) showLogin();
    return true;
  }).catch(err => {
    if (quiet) return false;
    hideBoot();
    showLogin('Tidak dapat terhubung ke server: ' + err.message, true);
    return false;
  });
}

function renderConfigNeeded() {
  const v = $('#authView'); v.hidden = false; $('#app').hidden = true;
  v.innerHTML = `<div class="auth-card" style="max-width:600px"><div class="auth-logo">${ic('plug')}</div><h1 class="text-center" style="font-size:1.4rem">Alamat backend belum diisi</h1>
    <p class="text-2 text-center">Frontend sudah tampil, tetapi belum tahu alamat Google Apps Script.</p>
    <ol class="fs-md"><li>Deploy <b>Kode.gs</b> sebagai Web App (Execute as: <b>Me</b>, Who has access: <b>Anyone</b>) lalu salin URL yang berakhiran <code>/exec</code>.</li>
    <li>Buka berkas <code>js/config.js</code>, ganti isi <code>GAS_URL</code> dengan URL tersebut.</li>
    <li>Simpan, lalu <code>git add .</code> → <code>git commit -m "isi GAS_URL"</code> → <code>git push</code>. Tunggu 1–2 menit dan muat ulang (Ctrl+Shift+R).</li></ol>
    <div class="notice amber mt-2"><span class="ic">${ic('info-circle')}</span><div>Nilai saat ini: <code>${E(GAS_URL || '(kosong)')}</code>. Gunakan URL <b>/exec</b>, bukan <b>/dev</b>.</div></div></div>`;
}

function resumeSession(quiet) {
  return rpc('resume', S.token, S.vers || {}).then(res => {
    if (!res.success) {
      if (res.code === 'AUTH') { onAuthLost(res.message); return; }
      throw Object.assign(new Error(res.message), { code: res.code });
    }
    applyBoot(res.data);
    LS.set('lastUid', S.me.user_id);
    if (!quiet) { Outbox.load(); enterApp(false); }
    else { renderShell(); refreshCurrentQuiet(true); }
    Outbox.kick(200);
  }).catch(err => {
    if (quiet) { toast('warning', 'Mode offline', 'Menampilkan data tersimpan di perangkat. ' + err.message); return; }
    hideBoot();
    if (err.code === 'SETUP') { renderSetupNeeded(err.message); return; }
    showLogin('Tidak dapat terhubung ke server: ' + err.message, true);
  });
}

function onSession(data, remember) {
  storeToken(data.token, remember);
  S.chapters = []; S.lps = []; S.lpsAll = []; S.detail = {};
  applyBoot(data.boot);
  LS.set('lastUid', S.me.user_id);
  Outbox.load();
  enterApp(false);
  toast('success', greet() + ', ' + firstName(S.me.nama) + '!', 'Masuk sebagai ' + ROLE_LABEL[S.me.peran] + '.');
}

let authLostShown = false;
function onAuthLost(msg) {
  if (authLostShown) return;
  authLostShown = true;
  S.token = null; SS.del('token'); LS.del('token');
  try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) { /* abaikan */ }
  showLogin(msg || 'Sesi berakhir. Silakan masuk kembali.');
  setTimeout(() => { authLostShown = false; }, 1500);
}

async function doLogout() {
  if (Outbox.items.length) {
    const okk = await confirmDlg({ title: 'Masih ada perubahan yang belum terkirim', message: `${Outbox.items.length} perubahan belum tersinkron ke server. Keluar sekarang akan menyimpannya di perangkat ini dan mengirimnya saat Anda masuk kembali.`, ok: 'Tetap keluar', tone: 'amber-solid', icon: 'cloud-arrow-up', iconTone: 'amber' });
    if (!okk) return;
  }
  const t = S.token;
  if (t) rpc('logout', t).catch(() => {});
  S.token = null; SS.del('token'); LS.del('token');
  try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) { /* abaikan */ }
  stopPolling();
  destroyCharts();
  S.me = null;
  showLogin();
}

function hideBoot() { const b = $('#boot'); if (b) { b.style.opacity = '0'; setTimeout(() => b.remove(), 300); } }

// ════════════════════════════════════════════════════════════
// BAGIAN 6 · HALAMAN LOGIN & SETUP
// ════════════════════════════════════════════════════════════
function showLogin(msg, offline) {
  hideBoot();
  $('#app').hidden = true;
  const v = $('#authView');
  v.hidden = false;
  const logo = BOOT.logoUrl ? `<img src="${E(BOOT.logoUrl)}" alt="">` : ic('mortarboard-fill');
  const demo = (BOOT.demo || []).length ? `<details class="demo-box"><summary>${ic('stars')}<span class="flex-grow-1">Akun demo untuk mencoba · kata sandi <b class="text-nowrap">ICM2026!</b></span>${ic('chevron-down', 'demo-chev')}</summary><div class="demo-list">${BOOT.demo.map(d => `<button type="button" class="demo-item" data-act="login.demo" data-email="${E(d.email)}"><span class="avatar ${avatarTone(d.peran)}">${E(initials(d.nama))}</span><span class="flex-grow-1"><b class="d-block">${E(d.nama)}</b><span class="text-2">${E(ROLE_LABEL[d.peran] || d.peran)} · ${E(d.unit)}</span></span>${ic('box-arrow-in-right', 'text-2')}</button>`).join('')}</div></details>` : '';
  v.innerHTML = `<div class="w-100" style="max-width:440px">
    <div class="auth-card">
      <div class="text-center">
        <div class="auth-logo">${logo}</div>
        <h1 style="font-size:1.6rem;font-weight:800">${E(BOOT.appName || 'LMS ICM')}</h1>
        <div class="text-2 fs-md">Academic Preparation &amp; Governance</div>
        <span class="auth-units">KB-TK · SD · SMP · SMA</span>
      </div>
      <h2 class="mt-4 mb-1" style="font-size:1.2rem">Masuk ke akun Anda</h2>
      <p class="text-2 fs-md mb-3">Gunakan email institusi ${E(BOOT.schoolName || 'sekolah')} Anda.</p>
      ${msg ? `<div class="notice amber mb-3"><span class="ic">${ic(offline ? 'wifi-off' : 'info-circle')}</span><div class="flex-grow-1">${E(msg)}${offline ? `<div class="mt-2"><button type="button" class="btn btn-soft btn-sm" data-act="boot.retry">${ic('arrow-repeat')} Coba lagi</button></div>` : ''}</div></div>` : ''}
      <form id="loginForm" novalidate>
        <label class="form-label" for="lgEmail"><span>Email Institusi <span class="req">*</span></span></label>
        <div class="input-icon mb-3">${ic('envelope')}<input id="lgEmail" type="email" class="form-control" autocomplete="username" placeholder="nama.guru@icm.sch.id" required></div>
        <label class="form-label" for="lgPw"><span>Kata Sandi <span class="req">*</span></span></label>
        <div class="input-icon">${ic('lock')}<input id="lgPw" type="password" class="form-control" autocomplete="current-password" placeholder="••••••••" required><button type="button" class="btn-icon eye" data-act="pw.toggle" data-target="lgPw" aria-label="Tampilkan kata sandi">${ic('eye')}</button></div>
        <div id="lgErr" class="field-err" hidden></div>
        <div class="d-flex justify-content-between align-items-center my-3 gap-2">
          <label class="d-flex align-items-center gap-2 fs-md"><input type="checkbox" class="form-check-input m-0" id="lgRemember" checked> Ingat perangkat ini</label>
          <button type="button" class="link-btn fs-md" data-act="pw.forgot">Lupa kata sandi?</button>
        </div>
        <button class="btn btn-primary btn-lg w-100" type="submit" id="lgBtn">Masuk ke Sistem ${ic('arrow-right')}</button>
      </form>
      ${BOOT.googleClientId ? `<div class="divider-text">atau</div><div id="gsiBtn" class="gsi-wrap" aria-label="Masuk dengan Google"><button class="btn btn-outline btn-lg w-100" type="button" disabled>${ic('google')} Memuat tombol Google…</button></div>` : ''}
      ${demo}
    </div>
    <div class="auth-foot">Hubungi Helpdesk IT untuk kendala akun · v${E(BOOT.version || '1.0.0')}</div></div>`;
  const f = $('#loginForm');
  f.onsubmit = e => { e.preventDefault(); submitLogin(); };
  if (BOOT.googleClientId) mountGoogleButton();
  setTimeout(() => { const em = $('#lgEmail'); em && em.focus(); }, 50);
}

/**
 * Tombol "Sign in with Google" (Google Identity Services). Hanya tampil bila
 * Super Admin sudah mengisi Google Client ID. ID token diverifikasi di server.
 */
let gsiLoading = null;
function loadGsi() {
  if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
  if (gsiLoading) return gsiLoading;
  gsiLoading = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.defer = true;
    sc.onload = () => resolve(); sc.onerror = () => { gsiLoading = null; reject(new Error('Skrip Google tidak dapat dimuat.')); };
    document.head.appendChild(sc);
  });
  return gsiLoading;
}
function mountGoogleButton() {
  loadGsi().then(() => {
    const box = $('#gsiBtn'); if (!box) return;
    google.accounts.id.initialize({ client_id: BOOT.googleClientId, callback: onGoogleCredential, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
    box.innerHTML = '';
    google.accounts.id.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'center', width: Math.min(400, box.clientWidth || 360), locale: 'id' });
  }).catch(e => { const box = $('#gsiBtn'); if (box) box.innerHTML = `<div class="fs-sm text-2 text-center">${ic('exclamation-circle')} ${E(e.message)} Gunakan email &amp; kata sandi.</div>`; });
}
function onGoogleCredential(resp) {
  const remember = $('#lgRemember') ? $('#lgRemember').checked : true;
  const err = $('#lgErr');
  const btn = $('#lgBtn'); setBtnBusy(btn, true, 'Memeriksa akun Google…');
  rpc('loginGoogle', resp && resp.credential, remember).then(res => {
    if (!res.success) { setBtnBusy(btn, false); err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + E(res.message); return; }
    onSession(res.data, remember);
  }).catch(e => { setBtnBusy(btn, false); err.hidden = false; err.innerHTML = ic('wifi-off') + ' ' + E(e.message); });
}

function submitLogin() {
  const email = $('#lgEmail').value.trim(), pw = $('#lgPw').value, remember = $('#lgRemember').checked;
  const err = $('#lgErr');
  $('#lgEmail').classList.toggle('is-invalid', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
  $('#lgPw').classList.toggle('is-invalid', !pw);
  if (!email || !pw) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' Isi email dan kata sandi.'; return; }
  const btn = $('#lgBtn');
  setBtnBusy(btn, true, 'Memverifikasi…');
  rpc('login', email, pw, remember).then(res => {
    if (!res.success) { setBtnBusy(btn, false); err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + E(res.message); return; }
    onSession(res.data, remember);
  }).catch(e => { setBtnBusy(btn, false); err.hidden = false; err.innerHTML = ic('wifi-off') + ' ' + E(e.message); });
}

function renderSetupNeeded(msg) {
  const v = $('#authView'); v.hidden = false; $('#app').hidden = true;
  v.innerHTML = `<div class="auth-card" style="max-width:560px"><div class="auth-logo">${ic('tools')}</div><h1 class="text-center" style="font-size:1.4rem">Aplikasi belum di-setup</h1>
    <p class="text-2 text-center">${E(msg || BOOT.setupMessage || 'Jalankan setupAppEnvironment() dari editor Apps Script.')}</p>
    <ol class="fs-md"><li>Buka editor Apps Script proyek ini.</li><li>Pilih fungsi <b>setupAppEnvironment</b> lalu klik <b>Run</b> dan berikan izin.</li><li>Muat ulang halaman ini (Ctrl+Shift+R).</li></ol>
    <div class="text-center mt-3"><button class="btn btn-soft" data-act="boot.retry">${ic('arrow-repeat')} Periksa lagi</button></div></div>`;
}

// ════════════════════════════════════════════════════════════
// BAGIAN 7 · SHELL: sidebar, topbar, navigasi bawah (per peran)
// ════════════════════════════════════════════════════════════
const NAV = {
  TEACHER: [
    { r: 'dashboard', i: 'grid-1x2', l: 'Dashboard' },
    { r: 'chapters', i: 'journal-bookmark', l: 'Analisis Chapter', m: 'Analisis' },
    { r: 'lps', i: 'file-earmark-text', l: 'Lesson Plan', m: 'RPP', badge: () => S.lps.filter(l => l.status === 'RETURNED').length },
    { r: 'profile', i: 'person-gear', l: 'Profil & Akun', m: 'Akun' }
  ],
  LEADER: [
    { r: 'lead', i: 'grid-1x2', l: 'Dashboard' },
    { r: 'queue', i: 'patch-check', l: 'Persetujuan', m: 'Antrean', badge: () => leaderLps().filter(l => l.status === 'PENDING').length },
    { r: 'archive', i: 'archive', l: 'Arsip Lesson Plan', m: 'Arsip' },
    { r: 'profile', i: 'person-gear', l: 'Profil & TTD', m: 'Akun' }
  ],
  QA: [
    { r: 'qa', i: 'bar-chart-line', l: 'Laporan QA', m: 'QA' },
    { r: 'all', i: 'files', l: 'Semua Lesson Plan', m: 'RPP' },
    { r: 'master', i: 'sliders', l: 'Master Data', m: 'Master' },
    { r: 'users', i: 'people', l: 'Pengguna', m: 'Pengguna' },
    { r: 'profile', i: 'person-gear', l: 'Profil & Akun', m: 'Akun' }
  ],
  SUPERADMIN: [
    { r: 'qa', i: 'bar-chart-line', l: 'Laporan QA', m: 'QA' },
    { r: 'all', i: 'files', l: 'Semua Lesson Plan', m: 'RPP' },
    { r: 'queue', i: 'patch-check', l: 'Persetujuan', m: 'Antrean', badge: () => leaderLps().filter(l => l.status === 'PENDING').length },
    { r: 'master', i: 'sliders', l: 'Master Data', m: 'Master' },
    { r: 'users', i: 'shield-lock', l: 'Pengguna & Sistem', m: 'Sistem' },
    { r: 'profile', i: 'person-gear', l: 'Profil & Akun', m: 'Akun' }
  ]
};
const HOME = { TEACHER: 'dashboard', LEADER: 'lead', QA: 'qa', SUPERADMIN: 'qa' };
const NAV_OWNER = { 'chapter-form': 'chapters', builder: 'lps', 'lp-view': null, review: 'queue' };

function enterApp(fromSnapshot) {
  hideBoot();
  $('#authView').hidden = true;
  $('#app').hidden = false;
  renderShell();
  const r = HOME[S.me.peran] || 'dashboard';
  go(r, {}, { replace: true });
  startPolling();
  if (!fromSnapshot) Outbox.kick(300);
}

function renderShell() {
  if (!S.me) return;
  const me = S.me, items = NAV[me.peran] || [];
  const unitChip = me.unit === 'ALL' ? 'Semua Unit · ICM' : myUnits().map(u => unitShort(u) + ' / ' + unitLabel(u)).join(' · ');
  const logo = cfg('logoUrl') ? `<img src="${E(cfg('logoUrl'))}" alt="">` : ic('mortarboard-fill');
  $('#sidebar').innerHTML = `
    <div class="sb-brand"><div class="sb-logo">${logo}</div><div class="txt"><div class="sb-name">${E(cfg('appName', 'LMS ICM'))}</div><div class="sb-tag">${me.peran === 'QA' || me.peran === 'SUPERADMIN' ? 'Academic QA' : me.peran === 'LEADER' ? 'Academic Governance' : 'Academic Preparation'}</div></div></div>
    <span class="sb-unit">${E(unitChip)}</span>
    <div class="sb-label">Menu Utama</div>
    <nav class="sb-nav">${items.map(it => { const b = it.badge ? it.badge() : 0; return `<button class="nav-i" data-go="${it.r}" data-nav="${it.r}" title="${E(it.l)}">${ic(it.i)}<span>${E(it.l)}</span>${b ? `<span class="nav-badge">${b}</span><span class="nb-dot"></span>` : ''}</button>`; }).join('')}</nav>
    <div class="sb-foot">
      <div class="sb-user"><span class="avatar ${avatarTone(me.peran)}">${E(initials(me.nama))}</span><div class="who"><b class="clamp-1">${E(me.nama)}</b><span>${E(me.jabatan || ROLE_LABEL[me.peran])}</span></div></div>
      <button class="nav-i logout" data-act="logout" title="Keluar">${ic('box-arrow-right')}<span>Keluar</span></button>
      <div class="fs-xs text-2 px-2 mt-1" title="Versi tampilan yang sedang berjalan" style="opacity:.75">Versi ${E(window.APP_BUILD || '')}</div>
    </div>`;
  renderTopbar();
  const mob = items.slice(0, 4);
  if (items.length > 4 && !mob.some(x => x.r === 'profile')) mob[3] = items.find(x => x.r === 'profile');
  $('#bottomNav').innerHTML = mob.map(it => { const b = it.badge ? it.badge() : 0; return `<button class="bn-i" data-go="${it.r}" data-nav="${it.r}">${ic(it.i)}<span>${E(it.m || it.l)}</span>${b ? `<span class="b">${b}</span>` : ''}</button>`; }).join('');
  markNav();
}

function renderTopbar() {
  const me = S.me, t = viewTerm();
  const unread = notifications().filter(n => n.unread).length;
  const ctxMap = { TEACHER: 'Persiapan Akademik', LEADER: 'Curriculum Governance', QA: 'QA Monitoring', SUPERADMIN: 'Administrasi Sistem' };
  $('#topbar').innerHTML = `
    <button class="icon-btn only-mobile" data-act="nav.open" aria-label="Buka menu">${ic('list')}</button>
    <div class="tb-ctx">${ic('mortarboard', 'text-3')}<span>${E(cfg('schoolName', 'ICM'))}</span><span class="sep">/</span><b>${E(ctxMap[me.peran])}${me.unit !== 'ALL' ? ' ' + E(myUnits().map(unitShort).join(' & ')) : ''}</b></div>
    <span class="only-mobile fw-8" style="color:var(--primary-strong)">${E(cfg('appName', 'LMS ICM'))}</span>
    <div class="tb-spacer"></div>
    <button id="syncPill" class="sync-pill" data-act="sync.now"></button>
    <button class="tb-pill term" data-act="term.pick" aria-label="Pilih term">${ic('calendar3')}<span>${E(termLabel(t))}</span>${ic('chevron-down', 'text-3')}</button>
    <button class="icon-btn" data-act="notif.open" aria-label="Notifikasi${unread ? ' (' + unread + ' baru)' : ''}">${ic('bell')}${unread ? '<span class="dot"></span>' : ''}</button>
    <button class="tb-user" data-act="user.menu" aria-label="Menu akun"><span class="avatar ${avatarTone(me.peran)}">${E(initials(me.nama))}</span><span class="nm hide-mobile"><b>${E(me.nama)}</b><span>${E(me.jabatan || ROLE_LABEL[me.peran])}${me.unit !== 'ALL' ? ' · ' + E(myUnits().map(unitShort).join(', ')) : ''}</span></span></button>`;
  Outbox.render();
}

function markNav() {
  const owner = NAV_OWNER[S.route.name] !== undefined ? NAV_OWNER[S.route.name] : S.route.name;
  const o = owner || S.route.from || '';
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === o));
}

// ════════════════════════════════════════════════════════════
// BAGIAN 8 · ROUTER SPA (0 RPC saat berpindah halaman)
// ════════════════════════════════════════════════════════════
const PAGES = {};   // diisi modul halaman: PAGES.nama = { title, roles, render(params), mount(params), leave() }

function go(name, params, opt) {
  opt = opt || {};
  const p = PAGES[name];
  if (!p) { toast('error', 'Halaman tidak ditemukan', name); return; }
  if (p.roles && !isRole(...p.roles)) { toast('warning', 'Akses dibatasi', 'Halaman ini tidak tersedia untuk peran Anda.'); return; }
  const cur = PAGES[S.route.name];
  if (cur && cur.leave) cur.leave();
  if (S.route.name && !opt.replace && !opt.back) S.history.push({ name: S.route.name, params: S.route.params });
  if (S.history.length > 30) S.history.shift();
  S.route = { name, params: params || {}, from: opt.from || (NAV_OWNER[name] === null ? (S.route.from || S.route.name) : null) };
  closeMenu();
  closeSidebar();
  clearPageToasts();
  renderRoute(true);
  try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
}
function back(fallback) {
  const h = S.history.pop();
  if (h) go(h.name, h.params, { back: true });
  else go(fallback || HOME[S.me.peran], {}, { replace: true });
}
function renderRoute(animate) {
  const p = PAGES[S.route.name];
  if (!p) return;
  destroyCharts();
  const view = $('#view');
  view.innerHTML = p.render(S.route.params || {});
  if (animate) { view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter'); }
  document.title = (p.title ? (typeof p.title === 'function' ? p.title(S.route.params) : p.title) + ' · ' : '') + cfg('appName', 'LMS ICM');
  markNav();
  p.mount && p.mount(S.route.params || {});
}
/** Render ulang halaman aktif setelah data latar diperbarui — tanpa mengganggu pengguna yang sedang mengetik. */
function refreshCurrentQuiet(force) {
  if (!S.me || $('#app').hidden) return;
  renderShell();
  const p = PAGES[S.route.name];
  if (!p) return;
  if (p.noAutoRefresh && !force) return;
  if (p.noAutoRefresh) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) && $('#view').contains(ae)) return;
  if (modalStack.length) return;
  const y = window.scrollY;
  renderRoute(false);
  window.scrollTo(0, y);
}

function openSidebar() { $('#sidebar').classList.add('open'); }
function closeSidebar() { const s = $('#sidebar'); if (s) s.classList.remove('open'); }

// ════════════════════════════════════════════════════════════
// BAGIAN 9 · NOTIFIKASI (diturunkan dari data — tanpa sheet tambahan)
// ════════════════════════════════════════════════════════════
function notifications() {
  if (!S.me) return [];
  const seen = LS.get('notifSeen:' + S.me.user_id, 0), out = [], horizon = Date.now() - 30 * 864e5;
  if (isRole('TEACHER')) {
    S.lps.forEach(l => {
      if ((l.status === 'RETURNED' || l.status === 'APPROVED') && ts(l.decided_at) > horizon) {
        out.push({ t: l.decided_at, icon: l.status === 'RETURNED' ? 'arrow-counterclockwise' : 'patch-check-fill', tone: l.status === 'RETURNED' ? 'amber' : 'green', title: l.status === 'RETURNED' ? 'Dikembalikan untuk revisi' : 'Lesson plan disetujui', text: `${l.chapter_label} — ${l.reviewer_terakhir || 'Pimpinan'}`, go: l.status === 'RETURNED' ? ['builder', { id: l.lp_id }] : ['lp-view', { id: l.lp_id }] });
      }
    });
  } else {
    const sla = cfg('sla_hari', 2);
    leaderLps().forEach(l => {
      if (l.status === 'PENDING' && ts(l.submitted_at) > Date.now() - 14 * 864e5) {
        const late = waitDays(l.submitted_at) > sla;
        out.push({ t: l.submitted_at, icon: late ? 'alarm' : 'inbox', tone: late ? 'rose' : 'sky', title: late ? `Menunggu > ${sla} hari` : 'Pengajuan baru', text: `${person(l.user_id).n || 'Guru'} · ${l.chapter_label} · ${l.jumlah_sesi || 0} pertemuan`, go: isRole('LEADER', 'SUPERADMIN') ? ['review', { id: l.lp_id }] : ['lp-view', { id: l.lp_id }] });
      }
    });
  }
  out.sort((a, b) => ts(b.t) - ts(a.t));
  return out.slice(0, 25).map(n => Object.assign(n, { unread: ts(n.t) > seen }));
}
function openNotifs(btn) {
  const list = notifications();
  popMenu(btn, `<div class="d-flex justify-content-between align-items-center px-2 py-1"><b>Notifikasi</b><button class="link-btn fs-sm" data-act="notif.seen">Tandai dibaca</button></div><div class="sep"></div>
    <div class="notif-list">${list.length ? list.map((n, i) => `<div class="notif ${n.unread ? 'unread' : ''}" data-act="notif.go" data-i="${i}"><span class="icon-tile sm ${n.tone}">${ic(n.icon)}</span><div class="min-w-0"><div class="t">${E(n.title)}</div><div class="s clamp-2">${E(n.text)}</div><div class="s">${E(relTime(n.t))}</div></div></div>`).join('') : `<div class="text-2 fs-md p-3 text-center">${ic('bell-slash')} Belum ada notifikasi.</div>`}</div>`, m => { m.style.width = '360px'; m._list = list; });
}

// ════════════════════════════════════════════════════════════
// BAGIAN 10 · DELEGASI EVENT GLOBAL
// ════════════════════════════════════════════════════════════
const ACT = {};    // diisi modul: ACT['nama.aksi'] = (el, ev) => {}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g && !g.disabled) {
    e.preventDefault();
    const params = {};
    Object.keys(g.dataset).forEach(k => { if (k.indexOf('p') === 0 && k.length > 1 && k[1] === k[1].toUpperCase()) params[k[1].toLowerCase() + k.slice(2)] = g.dataset[k]; });
    go(g.dataset.go, params);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (a && !a.disabled) {
    const fn = ACT[a.dataset.act];
    if (fn) { e.preventDefault(); fn(a, e); }
  }
});

Object.assign(ACT, {
  'logout': () => doLogout(),
  'nav.open': () => openSidebar(),
  'nav.close': () => closeSidebar(),
  'pw.toggle': el => { const i = document.getElementById(el.dataset.target); if (!i) return; i.type = i.type === 'password' ? 'text' : 'password'; el.innerHTML = ic(i.type === 'password' ? 'eye' : 'eye-slash'); },
  'pw.forgot': () => modal({ title: 'Lupa kata sandi', html: `<div class="mdl-head"><div class="d-flex gap-3"><span class="icon-tile">${ic('key')}</span><div><h3>Lupa kata sandi?</h3><p class="text-2 mt-1 mb-0">Demi keamanan, kata sandi hanya dapat diatur ulang oleh <b>Super Admin IT</b>. Hubungi Helpdesk IT sekolah; Anda akan menerima kata sandi sementara yang wajib diganti setelah masuk.</p></div></div></div><div class="mdl-foot"><button class="btn btn-primary" data-close>Mengerti</button></div>` }),
  'login.demo': el => { $('#lgEmail').value = el.dataset.email; $('#lgPw').value = 'ICM2026!'; submitLogin(); },
  'boot.retry': el => { setBtnBusy(el, true, 'Menghubungkan…'); refreshBoot(false).then(ok => { if (ok) (BOOT.ready ? showLogin() : renderSetupNeeded()); }); },
  'notif.open': el => openNotifs(el),
  'notif.seen': () => { LS.set('notifSeen:' + S.me.user_id, Date.now()); closeMenu(); renderTopbar(); },
  'notif.go': el => { const m = openMenu && openMenu._list; const n = m && m[+el.dataset.i]; LS.set('notifSeen:' + S.me.user_id, Date.now()); closeMenu(); renderTopbar(); if (n) go(n.go[0], n.go[1]); },
  'sync.now': () => { if (Outbox.items.length) { Outbox.lastError = null; Outbox.items.forEach(i => { i.tries = 0; }); Outbox.kick(0); toast('info', 'Menyinkron', Outbox.items.length + ' perubahan sedang dikirim.'); } else syncNow(true); },
  'term.pick': el => {
    const terms = S.terms.filter(t => t.status !== 'DRAFT' || isRole('QA', 'SUPERADMIN'));
    popMenu(el, `<div class="px-2 py-1 fs-xs text-3 fw-7">PILIH TERM UNTUK DITAMPILKAN</div>${terms.map(t => `<button class="mi" data-act="term.set" data-id="${E(t.term_id)}">${ic(t.term_id === viewTerm().term_id ? 'check2-circle' : 'circle')}<span class="flex-grow-1">${E(t.kode)}</span>${pill(t.status === 'ACTIVE' ? 'ACTIVE' : t.status === 'CLOSED' ? 'CLOSED' : 'DRAFT').replace('Pending Approval', 'DRAFT')}</button>`).join('')}`);
  },
  'term.set': el => { S.ui.termId = el.dataset.id; closeMenu(); renderShell(); renderRoute(false); },
  'user.menu': el => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    popMenu(el, `<div class="d-flex gap-2 align-items-center p-2"><span class="avatar lg ${avatarTone(S.me.peran)}">${E(initials(S.me.nama))}</span><div class="min-w-0"><b class="d-block clamp-1">${E(S.me.nama)}</b><span class="fs-xs text-2">${E(S.me.email)}</span></div></div><div class="sep"></div>
      <button class="mi" data-go="profile">${ic('person-gear')}Profil & keamanan</button>
      <button class="mi" data-act="theme.toggle">${ic(dark ? 'sun' : 'moon-stars')}${dark ? 'Mode terang' : 'Mode gelap'}</button>
      <button class="mi" data-act="sync.full">${ic('arrow-repeat')}Muat ulang data dari server</button>
      <div class="sep"></div><button class="mi" data-act="logout" style="color:var(--rose)">${ic('box-arrow-right')}Keluar</button>`);
  },
  'theme.toggle': () => { const d = document.documentElement, n = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; d.setAttribute('data-theme', n); LS.set('theme', n); try { localStorage.setItem('lmsicm:theme', n); } catch (e) { /* abaikan */ } closeMenu(); if (Object.keys(S.charts).length) renderRoute(false); },
  'sync.full': () => { closeMenu(); syncNow(true); }
});

// ════════════════════════════════════════════════════════════
// BAGIAN 11 · SINKRON LATAR (polling ringan + delta versi)
// ════════════════════════════════════════════════════════════
let pollTimer = null, lastActivity = Date.now();
function syncNow(loud) {
  if (!S.token) return Promise.resolve();
  if (loud) toast('info', 'Memuat data terbaru…', '');
  return call('bootstrap', { vers: loud ? {} : S.vers }).then(b => {
    const beforeQ = leaderLps().filter(l => l.status === 'PENDING').length;
    applyBoot(b);
    const afterQ = leaderLps().filter(l => l.status === 'PENDING').length;
    if (!loud && isRole('LEADER') && afterQ > beforeQ) toast('info', 'Pengajuan baru masuk', (afterQ - beforeQ) + ' lesson plan menunggu tinjauan Anda.', { action: { label: 'Buka antrean', fn: () => go('queue') } });
    if (loud) toast('success', 'Data diperbarui', 'Sinkron ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    refreshCurrentQuiet();
  }).catch(e => { if (loud) toast('error', 'Gagal memuat', e.message); });
}
function startPolling() {
  stopPolling();
  const every = isRole('TEACHER') ? 180000 : 120000;
  pollTimer = setInterval(() => {
    if (document.hidden || Outbox.running || Outbox.items.length) return;
    syncNow(false);
  }, every);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.token && Date.now() - S.lastSync > 60000 && !Outbox.items.length) syncNow(false);
  if (document.hidden && S.builder && S.builder.dirty) builderFlush();
});
window.addEventListener('online', () => { Outbox.lastError = null; Outbox.kick(0); });

// ════════════════════════════════════════════════════════════
// BAGIAN 12 · DATA TURUNAN GURU
// ════════════════════════════════════════════════════════════
const liveLps = () => S.lps.filter(l => l.status !== 'DELETED');
const chaptersInTerm = tid => S.chapters.filter(c => c.term_id === tid && c.status !== 'DELETED');
const lpsInTerm = tid => liveLps().filter(l => l.term_id === tid);
const chapterById = id => S.chapters.find(c => c.chapter_id === id) || null;
const lpById = id => S.lps.find(l => l.lp_id === id) || S.lpsAll.find(l => l.lp_id === id) || null;
const lpsOfChapter = id => liveLps().filter(l => l.chapter_id === id);
const activeSubs = ch => (ch.subs || []).filter(s => s.aktif !== false);
const activeLos = ch => (ch.los || []).filter(l => l.aktif !== false);
const isEditable = l => l && (l.status === 'DRAFT' || l.status === 'RETURNED');
const lpTitle = l => l.chapter_label || 'Tanpa chapter';
const lpMeta = l => `${+l.jumlah_sesi || (l.sessions || []).length || 0} pertemuan · ${lpPeriods(l)} period`;
const lpOfChapter = id => lpsOfChapter(id)[0] || null;
const unsyncedBadge = key => (Outbox.has(key) ? `<span class="chip amber ms-1" title="Menunggu sinkron ke server">${ic('cloud-arrow-up')} sinkron</span>` : '');

/** Progres chapter: 1 lesson plan per chapter; ukurannya period yang sudah direncanakan di LP vs period chapter. */
function chapterProgress(ch) {
  const lp = lpOfChapter(ch.chapter_id), target = +ch.jumlah_period || 0, planned = lp ? lpPeriods(lp) : 0;
  const p = lp ? (lp.status === 'APPROVED' ? 100 : Math.min(99, Math.round(pct(Math.min(planned, target), Math.max(1, target))))) : 0;
  const tone = !lp ? 'rose' : lp.status === 'APPROVED' ? 'done' : lp.status === 'RETURNED' ? 'rose' : 'amber';
  const label = !lp ? 'Belum ada LP' : STATUS_LABEL[lp.status];
  return { lp, target, planned, p, tone, label };
}
const chaptersWithoutLp = termId => chaptersInTerm(termId).filter(c => c.status === 'AKTIF' && !lpOfChapter(c.chapter_id));
/** Ringkasan anggaran period per mapel+kelas guru pada term (untuk panel di daftar chapter & dashboard). */
function budgetGroups(t) {
  const g = {};
  const add = (unit, mapel, kelas) => { if (!mapel || !kelas) return; const k = [unit, mapel, kelas].join('|'); if (!g[k]) g[k] = { unit, mapel, kelas, used: 0, chapters: 0 }; return g[k]; };
  const mine = String(S.me.mata_pelajaran || '').split(',').map(x => x.trim()).filter(Boolean), kel = String(S.me.kelas || '').split(',').map(x => x.trim()).filter(Boolean);
  mine.forEach(m => kel.forEach(k => myUnits().forEach(u => { if (S.refs.some(r => r.kategori === 'GRADE' && r.kode === k && (!r.deskripsi || r.deskripsi === u))) add(u, m, k); })));
  chaptersInTerm(t.term_id).forEach(c => { const x = add(c.unit, c.mata_pelajaran, c.kelas); if (c.status === 'AKTIF') { x.used += +c.jumlah_period || 0; x.chapters++; } });
  return Object.keys(g).map(k => Object.assign(g[k], termBudget(t, g[k].unit, g[k].mapel, g[k].kelas)));
}
function budgetPanelHtml(t, compact) {
  const groups = budgetGroups(t);
  if (!groups.length) return '';
  return `<section class="card-x pure mb-4 budget-card"><div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-2"><div><b>${ic('hourglass-split')} Anggaran Period ${E(termLabel(t))}</b><div class="fs-xs text-2">${t.minggu_efektif || 0} minggu efektif × period per minggu tiap mapel. Total period semua chapter tidak boleh melebihi anggaran.</div></div></div>
    <div class="budget-grid">${groups.map(x => { const left = x.total - x.used, pp = x.total ? Math.min(100, Math.round(pct(x.used, x.total))) : 0, tone = !x.total ? 'gray' : left < 0 ? 'rose' : left === 0 ? 'green' : 'amber';
      return `<div class="budget-item"><div class="d-flex justify-content-between gap-2 align-items-baseline"><b class="clamp-1">${E(refLabel('SUBJECT', x.mapel))} · ${E(gradeLabel(x.kelas))}</b><span class="fs-sm fw-7" style="color:var(--${tone === 'green' ? 'green' : tone === 'rose' ? 'rose' : 'primary-strong'})">${x.used}${x.total ? ' / ' + x.total : ''} period</span></div>
        ${x.total ? `<div class="bar-mini ${tone === 'green' ? 'green' : tone === 'rose' ? 'rose' : ''} mt-1"><span style="width:${pp}%"></span></div><div class="fs-xs text-2 mt-1">${x.weeks} minggu × ${x.ppm} period/minggu · ${left > 0 ? 'sisa <b>' + left + '</b> period belum dipetakan ke chapter' : left === 0 ? '<b>pas</b> — seluruh period sudah dipetakan' : '<b style="color:var(--rose)">lebih ' + (-left) + ' period</b>'}</div>`
          : `<div class="fs-xs mt-1" style="color:var(--amber-ink)">${ic('info-circle')} Period per minggu untuk mapel & kelas ini belum diatur QA (Master Data → Period per Mapel).</div>`}${compact ? '' : ''}</div>`; }).join('')}</div></section>`;
}

// ════════════════════════════════════════════════════════════
// BAGIAN 13 · DASHBOARD GURU
// ════════════════════════════════════════════════════════════
PAGES.dashboard = {
  title: 'Dashboard', roles: ['TEACHER'],
  render() {
    const t = viewTerm(), tid = t ? t.term_id : '', me = S.me;
    const chs = chaptersInTerm(tid), lps = lpsInTerm(tid);
    const by = st => lps.filter(l => l.status === st);
    const approved = by('APPROVED'), pending = by('PENDING'), returned = by('RETURNED'), drafts = by('DRAFT');
    const withTp = chs.filter(c => activeLos(c).length > 0).length;
    const weekAgo = Date.now() - 7 * 864e5, apWeek = approved.filter(l => ts(l.decided_at) > weekAgo).length;
    const actChs = chs.filter(c => c.status === 'AKTIF'), totalTarget = actChs.length, made = actChs.filter(c => lpOfChapter(c.chapter_id)).length, coverage = Math.round(pct(made, totalTarget));
    const missAll = chaptersWithoutLp(tid), miss = missAll.slice(0, 5);
    const bud = t ? budgetGroups(t).filter(x => x.total) : [], budLeft = sum(bud.map(x => Math.max(0, x.total - x.used)));
    const insights = [];
    if (returned.length) insights.push(`${returned.length} dokumen menunggu revisi Anda — mulai dari yang tanggal mengajarnya paling dekat.`);
    if (pending.length) insights.push(`${pending.length} lesson plan sedang ditinjau pimpinan; status akan diperbarui otomatis.`);
    const decided = lps.filter(l => l.decided_at && l.submitted_at && l.status !== 'PENDING');
    if (decided.length) { const avg = sum(decided.map(l => Math.max(0, ts(l.decided_at) - ts(l.submitted_at)))) / decided.length / 864e5; insights.push(`Rata-rata waktu keputusan pimpinan untuk dokumen Anda: ${avg.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari.`); }
    if (totalTarget) insights.push(`Cakupan term: ${made} dari ${totalTarget} chapter sudah memiliki lesson plan (${coverage}%).`);
    if (budLeft) insights.push(`Masih ada ${budLeft} period dalam anggaran term yang belum dipetakan ke chapter.`);
    if (!insights.length) insights.push('Mulai dengan menyusun Analisis Chapter untuk term ini — TP/LO akan otomatis tersedia di Lesson Plan Builder.');
    const actionList = returned.slice().sort((a, b) => (a.tanggal_ajar || '9') < (b.tanggal_ajar || '9') ? -1 : 1);
    return `
    <div class="page-head">
      <div><h1>${greet()}, ${E(firstName(me.nama))}! <span aria-hidden="true">👋</span></h1>
        <div class="desc">Tahun Ajaran ${E(t ? t.tahun_ajaran : '—')} · ${E(t ? 'Semester ' + t.semester + ' (Term ' + t.term + ')' : '')} · <span style="color:var(--primary-strong);font-weight:600">${E(myUnits().map(unitShort).join(', '))} ${E(cfg('schoolName', '').replace('Sekolah ', ''))}</span></div></div>
      <div class="actions"><button class="btn btn-soft" data-act="t.export">${ic('download')} Ekspor Rekap</button><button class="btn btn-primary" data-act="lp.new">${ic('plus-lg')} Buat Lesson Plan</button></div>
    </div>
    <div class="stat-grid">
      ${statCard({ label: 'Chapter Dipetakan', icon: 'journal-bookmark', value: chs.length ? withTp : 0, unit: '/ ' + chs.length, cap: `<span class="dot"></span> ${chs.length ? Math.round(pct(withTp, chs.length)) : 0}% memiliki TP lengkap` })}
      ${statCard({ label: 'Lesson Plan Disetujui', icon: 'patch-check', tone: 'sky', value: approved.length, cap: `${apWeek ? `<span class="chip sky">+${apWeek} minggu ini</span>` : ''} ${ic('shield-check', 'text-3')} Disetujui pimpinan` })}
      ${statCard({ label: 'Menunggu Review', icon: 'hourglass-split', tone: 'amber', value: pending.length, cap: `<span class="chip amber">Dalam antrean</span> <span class="dot amber"></span> Sedang ditinjau` })}
      ${statCard({ label: 'Perlu Revisi (Returned)', icon: 'exclamation-circle', tone: 'rose', value: returned.length, vtone: returned.length ? 'rose' : '', cap: returned.length ? `<span class="chip rose">Perlu Tindakan</span> <span class="dot rose"></span> Segera perbaiki` : `<span class="dot green"></span> Tidak ada revisi` })}
    </div>

    ${actionList.length ? `<section class="card-x action-panel mb-4">
      <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="icon-tile sm amber">${ic('bell')}</span><div><h3>Perlu Tindakan Anda (${actionList.length} Dokumen Dikembalikan)</h3><div class="sub">Catatan pimpinan untuk perbaikan sebelum jadwal mengajar dimulai.</div></div></div><span class="chip amber">${ic('circle-fill', 'fs-xs')} Prioritas Tinggi</span></div>
      ${actionList.map(l => `<div class="action-item"><span class="pill pill-RETURNED">Returned</span>
        <div class="min-w-0"><div class="fw-7">${E(lpTitle(l))} <span class="text-2 fw-6 fs-sm">(${E(lpMeta(l))})</span></div>
          <div class="note">${ic('chat-square-quote', 'me-1')} ${E(l.reviewer_terakhir || 'Pimpinan')}: “${E(l.catatan_terakhir || 'Lihat anotasi pada dokumen.')}”</div></div>
        <div class="d-flex align-items-center gap-3 flex-wrap justify-content-end"><span class="meta">${l.tanggal_ajar ? 'Batas: ' + E(relDay(l.tanggal_ajar)) : 'Rev. ' + E(l.revisi_ke)}</span><button class="btn btn-primary btn-sm" data-go="builder" data-p-id="${E(l.lp_id)}">Buka & Revisi ${ic('arrow-right')}</button></div></div>`).join('')}
    </section>` : (drafts.length ? `<section class="card-x mb-4"><div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="icon-tile sm">${ic('pencil-square')}</span><div><h3>Lanjutkan draft Anda</h3><div class="sub">${drafts.length} lesson plan belum diajukan ke pimpinan.</div></div></div></div>
      ${drafts.slice(0, 3).map(l => `<div class="action-item"><span class="pill pill-DRAFT">Draft</span><div class="min-w-0"><div class="fw-7">${E(lpTitle(l))}</div><div class="note">Terakhir diubah ${E(relTime(l.diubah_pada))}</div></div><button class="btn btn-soft btn-sm" data-go="builder" data-p-id="${E(l.lp_id)}">Lanjutkan ${ic('arrow-right')}</button></div>`).join('')}</section>` : '')}

    <div class="row g-4 mb-4">
      <div class="col-lg-7"><section class="card-x h-100">
        <div class="card-head"><div><h3>Lesson Plan per Chapter</h3><div class="sub">Period terencana di lesson plan dibanding period chapter · ${E(termLabel(t))}</div></div><span class="chip">Term Coverage: ${coverage}%</span></div>
        ${actChs.length ? actChs.map(ch => { const p = chapterProgress(ch); return `<div class="prog-item"><div class="prog-head"><div class="t clamp-1">${E(ch.kode)} · ${E(ch.nama_chapter)}<small>(${p.planned} / ${p.target} period)</small></div><span class="chip ${p.tone === 'done' ? 'green' : p.tone}">${E(p.label)}</span></div><div class="prog-track ${p.tone === 'done' ? '' : p.tone}"><span style="width:${p.p}%"></span></div></div>`; }).join('')
          : emptyState('journal-plus', 'Belum ada chapter', 'Susun Analisis Chapter agar TP/LO dapat dipanggil di Lesson Plan.', `<button class="btn btn-primary" data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button>`)}
        ${actChs.length ? `<div class="inset d-flex flex-wrap gap-3 justify-content-between align-items-center mt-4 fs-sm"><span><span class="dot"></span> Disetujui &nbsp; <span class="dot amber"></span> Draft / ditinjau &nbsp; <span class="dot rose"></span> Belum ada / revisi</span><button class="link-btn" data-go="chapters">Rincian Kurikulum ${ic('arrow-right')}</button></div>` : ''}
      </section></div>
      <div class="col-lg-5"><section class="card-x h-100">
        <div class="card-head"><div><h3>Chapter Tanpa Lesson Plan</h3><div class="sub">Setiap chapter memerlukan satu lesson plan</div></div><span class="chip rose">${missAll.length}</span></div>
        ${miss.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Chapter</th><th>Period</th><th class="text-end">Aksi</th></tr></thead><tbody>${miss.map(c => `<tr><td><div class="t-title clamp-1">${E(c.kode)} · ${E(c.nama_chapter)}</div><div class="t-sub">${E(gradeLabel(c.kelas))} · ${E(refLabel('SUBJECT', c.mata_pelajaran))}</div></td><td class="fw-7 text-nowrap">${+c.jumlah_period || 0} period</td><td class="text-end"><button class="btn btn-soft btn-sm" data-go="builder" data-p-chapter="${E(c.chapter_id)}">Buat</button></td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty py-4"><div class="ill">${ic('check2-all')}</div><h4>Semua chapter sudah punya lesson plan</h4><p>Tambahkan chapter baru bila materi berikutnya siap.</p></div>`}
        <div class="inset d-flex justify-content-between align-items-center mt-3 fs-sm"><span class="text-2">${ic('calendar-week')} ${E(termLabel(t))}</span><button class="link-btn" data-go="lps">Lihat semua lesson plan ${ic('arrow-right')}</button></div>
      </section></div>
    </div>
    <section class="insight"><span class="icon-tile">${ic('stars')}</span><div><b>Insight Otomatis</b><ul>${insights.map(i => `<li>${E(i)}</li>`).join('')}</ul></div></section>`;
  }
};

ACT['t.export'] = () => {
  const t = viewTerm();
  downloadCsv(`Rekap_LessonPlan_${(S.me.nama || '').split(',')[0].replace(/\W+/g, '_')}_${t ? t.kode.replace(/\W+/g, '_') : ''}.csv`,
    ['Kode Dokumen', 'Chapter', 'Sub-bab / Topik', 'Jumlah Pertemuan', 'Total Period', 'Total Menit', 'Mulai', 'Status', 'Revisi', 'Catatan Terakhir', 'Diajukan', 'Diputuskan'],
    lpsInTerm(t.term_id).map(l => [l.kode_dok, l.chapter_label, l.sub_label, l.jumlah_sesi, lpPeriods(l), l.durasi_total, l.tanggal_ajar, STATUS_LABEL[l.status], l.revisi_ke, l.catatan_terakhir, l.submitted_at, l.decided_at]));
};

// ════════════════════════════════════════════════════════════
// BAGIAN 14 · MODUL A — DAFTAR ANALISIS CHAPTER
// ════════════════════════════════════════════════════════════
PAGES.chapters = {
  title: 'Analisis Chapter', roles: ['TEACHER', 'SUPERADMIN'],
  render() {
    const t = viewTerm(), u = S.ui.ch = S.ui.ch || { q: '', mapel: '', status: '', page: 1, per: 10 };
    const all = chaptersInTerm(t.term_id);
    const rows = all.filter(c => (!u.q || (c.nama_chapter + ' ' + c.kode + ' ' + (c.subs || []).map(s => s.nama_sub).join(' ') + ' ' + (c.los || []).map(l => stripTags(l.teks_tp)).join(' ')).toLowerCase().indexOf(u.q.toLowerCase()) >= 0)
      && (!u.mapel || c.mata_pelajaran === u.mapel) && (!u.status || c.status === u.status)).sort((a, b) => a.kode < b.kode ? -1 : 1);
    const page = Math.min(u.page, Math.max(1, Math.ceil(rows.length / u.per))), slice = rows.slice((page - 1) * u.per, page * u.per);
    const mapels = uniq(all.map(c => c.mata_pelajaran));
    const withLp = all.filter(c => lpsOfChapter(c.chapter_id).length).length;
    const totalTp = sum(all.map(c => activeLos(c).length));
    const term = activeTerm();
    return `
    <div class="crumbs"><span>Akademik</span><span>/</span><span class="cur">Analisis Chapter</span></div>
    <div class="page-head">
      <div><h1>Analisis Chapter <span class="text-2 fw-6" style="font-size:.6em">(${E(termLabel(t))})</span></h1><div class="desc">Pemetaan Bab, Sub-bab, dan Tujuan Pembelajaran (TP/LO) per jenjang — sumber data otomatis untuk Lesson Plan.</div></div>
      <div class="actions"><span class="tb-pill">${ic('circle-fill', 'fs-xs')} ${all.length} Bab Total</span><span class="tb-pill">${ic('patch-check')} ${withLp} Dipakai LP</span>
        ${t.status === 'ACTIVE' ? `<button class="btn btn-primary" data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button>` : `<span class="chip gray">${ic('lock')} Term ${t.status === 'CLOSED' ? 'ditutup' : 'belum aktif'}</span>`}</div>
    </div>
    ${budgetPanelHtml(t)}
    <section class="card-x flush pure mb-4">
      <div class="filter-bar">
        <div class="input-icon search">${ic('search')}<input class="form-control" data-f="ch.q" value="${E(u.q)}" placeholder="Cari bab, sub-bab, atau kata kunci TP…" aria-label="Cari chapter"></div>
        <select class="form-select" data-f="ch.mapel" aria-label="Filter mata pelajaran"><option value="">Semua Mapel</option>${mapels.map(m => `<option value="${E(m)}" ${u.mapel === m ? 'selected' : ''}>${E(refLabel('SUBJECT', m))}</option>`).join('')}</select>
        <select class="form-select" data-f="ch.status" aria-label="Filter status"><option value="">Semua Status</option><option value="AKTIF" ${u.status === 'AKTIF' ? 'selected' : ''}>Aktif</option><option value="NONAKTIF" ${u.status === 'NONAKTIF' ? 'selected' : ''}>Nonaktif</option></select>
        <button class="btn btn-soft btn-sm" data-act="ch.export">${ic('download')} Ekspor Matrix</button>
      </div>
      ${(u.q || u.mapel || u.status) ? `<div class="filter-chips">${u.q ? `<span class="chip">Cari: ${E(u.q)} <button class="x" data-act="ch.clear" data-k="q" aria-label="Hapus filter">×</button></span>` : ''}${u.mapel ? `<span class="chip">Mapel: ${E(refLabel('SUBJECT', u.mapel))} <button class="x" data-act="ch.clear" data-k="mapel">×</button></span>` : ''}${u.status ? `<span class="chip">Status: ${E(u.status)} <button class="x" data-act="ch.clear" data-k="status">×</button></span>` : ''}<button class="link-btn fs-sm" data-act="ch.clear" data-k="all">${ic('arrow-counterclockwise')} Reset Filter</button></div>` : ''}
      ${slice.length ? `<div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Kode & Judul Chapter</th><th>Mapel & Kelas</th><th>Sub-bab</th><th>TP / LO</th><th>Period</th><th>Lesson Plan</th><th class="text-end">Aksi</th></tr></thead><tbody>
        ${slice.map(c => { const p = chapterProgress(c), used = lpsOfChapter(c.chapter_id).length, no = String(c.kode || '').replace(/\D/g, '') || '–'; const noTp = !activeLos(c).length; return `<tr class="clickable ${noTp ? 'row-warn' : ''}" data-act="ch.open" data-id="${E(c.chapter_id)}">
          <td data-label="Chapter" class="col-main"><div class="d-flex gap-3 align-items-center"><span class="code-chip ${noTp ? 'amber' : ''}">${E(no.padStart(2, '0'))}</span><div class="min-w-0"><div class="t-title">${E(c.kode)}: ${E(c.nama_chapter)} ${unsyncedBadge('ch:' + c.chapter_id)}</div><div class="t-sub clamp-1">${c.status === 'NONAKTIF' ? '<span class="pill pill-NONAKTIF plain me-1">Nonaktif</span>' : ''}${E(activeSubs(c).slice(0, 2).map(s => s.nama_sub).join(' · '))}${activeSubs(c).length > 2 ? ' …' : ''}</div></div></div></td>
          <td data-label="Mapel & Kelas"><div class="fw-6">${E(refLabel('SUBJECT', c.mata_pelajaran))}</div><div class="t-sub">${E(gradeLabel(c.kelas))} · ${E(unitShort(c.unit))}</div></td>
          <td data-label="Sub-chapter"><span class="chip">${activeSubs(c).length} Sub-bab</span></td>
          <td data-label="TP / LO"><span class="chip ${noTp ? 'amber' : ''}">${activeLos(c).length} TP</span></td>
          <td data-label="Period" class="text-nowrap fw-6">${ic('hourglass-split', 'text-3 me-1')} ${+c.jumlah_period || 0} period</td>
          <td data-label="Lesson Plan">${p.lp ? `<div class="fs-sm fw-6">${pill(p.lp.status)}</div><div class="t-sub">${p.planned}/${p.target} period</div>` : `<span class="chip rose">Belum ada</span>`}</td>
          <td class="text-end cell-actions"><div class="row-actions">
            <button class="btn-icon" data-act="ch.open" data-id="${E(c.chapter_id)}" aria-label="Edit">${ic('pencil')}</button>
            <button class="btn-icon" data-act="ch.dup" data-id="${E(c.chapter_id)}" aria-label="Duplikat ke term lain" title="Duplikat ke term lain">${ic('copy')}</button>
            <button class="btn-icon" data-act="ch.lp" data-id="${E(c.chapter_id)}" aria-label="${p.lp ? 'Buka lesson plan' : 'Buat lesson plan'}" title="${p.lp ? 'Buka lesson plan chapter ini' : 'Buat lesson plan dari chapter ini'}">${ic(p.lp ? 'file-earmark-text' : 'file-earmark-plus')}</button>
            <button class="btn-icon danger" data-act="ch.del" data-id="${E(c.chapter_id)}" ${used ? 'disabled title="Terkait lesson plan yang sudah dibuat"' : 'title="Hapus"'} aria-label="Hapus">${ic('trash3')}</button></div></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="tbl-foot"><span>Menampilkan ${slice.length} dari ${rows.length} chapter · Tampilkan <select class="form-select d-inline-block w-auto" style="min-height:32px;padding:.15rem 2rem .15rem .6rem" data-f="ch.per">${[10, 25, 50].map(n => `<option ${u.per === n ? 'selected' : ''}>${n}</option>`).join('')}</select></span>${pager(rows.length, page, u.per, 'ch.page')}</div>`
        : emptyState('journal-plus', all.length ? 'Tidak ada chapter yang cocok' : 'Belum ada Analisis Chapter untuk term ini', all.length ? 'Ubah kata kunci atau reset filter.' : 'Susun chapter, sub-bab/topik, jumlah period, dan TP/LO sekali di awal term.', all.length ? '' : `<button class="btn btn-primary" data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button>`)}
    </section>
    <div class="row g-3">
      <div class="col-md-4"><div class="card-x pure d-flex gap-3"><span class="icon-tile">${ic('diagram-3')}</span><div><b>Alur Tujuan Pembelajaran</b><div class="text-2 fs-sm">${totalTp} TP terdefinisi di ${all.length} chapter dan otomatis muncul di Lesson Plan Builder.</div></div></div></div>
      <div class="col-md-4"><div class="card-x pure d-flex gap-3"><span class="icon-tile sky">${ic('clipboard2-check')}</span><div><b>Kesiapan Kurikulum</b><div class="text-2 fs-sm">${all.length ? Math.round(pct(all.filter(c => activeLos(c).length && activeSubs(c).length).length, all.length)) : 0}% chapter siap diturunkan menjadi lesson plan.</div></div></div></div>
      <div class="col-md-4"><div class="card-x pure d-flex gap-3"><span class="icon-tile amber">${ic('calendar-check')}</span><div><b>Batas Analisis Chapter</b><div class="text-2 fs-sm">${term && term.batas_rpp ? 'Disarankan selesai ' + E(fmtTanggal(term.batas_rpp)) + ' (' + E(relDay(term.batas_rpp)) + ').' : 'Belum ditetapkan oleh QA.'}</div></div></div></div>
    </div>`;
  }
};

/** Filter global: input/select dengan data-f="halaman.kunci" */
document.addEventListener('input', e => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const [pg, k] = el.dataset.f.split('.');
  S.ui[pg] = S.ui[pg] || {};
  S.ui[pg][k] = el.type === 'number' || k === 'per' ? +el.value : el.value;
  S.ui[pg].page = 1;
  const rerender = () => { const pos = el.selectionStart, id = el.dataset.f; renderRoute(false); const n = document.querySelector(`[data-f="${id}"]`); if (n && el.tagName === 'INPUT') { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* abaikan */ } } };
  if (el.tagName === 'INPUT') { clearTimeout(el._t); filterDebounce(rerender); } else rerender();
});
const filterDebounce = debounce(fn => fn(), 220);

Object.assign(ACT, {
  'ch.open': el => go('chapter-form', { id: el.dataset.id }),
  'ch.page': el => { S.ui.ch.page = +el.dataset.page; renderRoute(false); },
  'ch.clear': el => { const k = el.dataset.k; if (k === 'all') S.ui.ch = { q: '', mapel: '', status: '', page: 1, per: S.ui.ch.per }; else S.ui.ch[k] = ''; renderRoute(false); },
  'ch.lp': el => { const lp = lpOfChapter(el.dataset.id); if (lp) go(isEditable(lp) ? 'builder' : 'lp-view', { id: lp.lp_id }); else go('builder', { chapter: el.dataset.id }); },
  'ch.dup': el => {
    const src = chapterById(el.dataset.id); if (!src) return;
    const terms = S.terms.filter(t => t.status === 'ACTIVE');
    popMenu(el, `<div class="px-2 py-1 fs-xs text-3 fw-7">DUPLIKAT KE TERM</div>${terms.map(t => `<button class="mi" data-act="ch.dupTo" data-id="${E(src.chapter_id)}" data-term="${E(t.term_id)}">${ic('calendar-plus')} ${E(t.kode)}</button>`).join('') || '<div class="p-2 text-2 fs-sm">Tidak ada term aktif.</div>'}`);
  },
  'ch.dupTo': el => { closeMenu(); go('chapter-form', { dup: el.dataset.id, term: el.dataset.term }); },
  'ch.del': async el => {
    const c = chapterById(el.dataset.id); if (!c) return;
    if (lpsOfChapter(c.chapter_id).length) { toast('warning', 'Tidak dapat dihapus', 'Chapter sudah dipakai lesson plan. Nonaktifkan saja dari halaman edit.'); return; }
    const okk = await confirmDlg({ title: 'Hapus chapter ini?', message: `<b>${E(c.kode)}: ${E(c.nama_chapter)}</b> beserta sub-chapter dan TP-nya akan dihapus.`, ok: 'Hapus', tone: 'danger', icon: 'trash3', iconTone: 'rose' });
    if (!okk) return;
    const prev = clone(c);
    S.chapters = S.chapters.filter(x => x.chapter_id !== c.chapter_id);
    renderRoute(false);
    toast('success', 'Chapter dihapus', c.kode + ' ' + c.nama_chapter);
    if (Outbox.items.some(i => i.key === 'ch:' + c.chapter_id && i.action === 'chapter.save' && !i.inflight) && !c.dibuat_pada) { Outbox.drop('ch:' + c.chapter_id); persist(); return; }
    Outbox.push('chapter.delete', { chapter_id: c.chapter_id }, { key: 'ch:' + c.chapter_id, prev, label: 'Hapus chapter' });
  },
  'ch.export': () => {
    const t = viewTerm(), rows = [];
    chaptersInTerm(t.term_id).forEach(c => { const sm = byKey(c.subs || [], 'sub_id'); activeLos(c).forEach(l => rows.push([c.kode, c.nama_chapter, refLabel('SUBJECT', c.mata_pelajaran), gradeLabel(c.kelas), c.jumlah_period, sm[l.sub_id] ? sm[l.sub_id].kode + ' ' + sm[l.sub_id].nama_sub : '', l.kode, stripTags(l.teks_tp), l.ranah, l.taksonomi])); });
    downloadCsv('Matrix_Analisis_Chapter_' + t.kode.replace(/\W+/g, '_') + '.csv', ['Kode', 'Chapter', 'Mapel', 'Kelas', 'Jumlah Period', 'Sub-bab / Topik', 'Kode TP', 'Tujuan Pembelajaran', 'Ranah', 'Taksonomi'], rows);
  }
});

RECON['chapter.save'] = {
  ok(data) { const i = S.chapters.findIndex(c => c.chapter_id === data.chapter_id); if (i >= 0) S.chapters[i] = data; else S.chapters.push(data); if (S.route.name === 'chapters' || S.route.name === 'dashboard') refreshCurrentQuiet(); },
  fail(err, item) {
    const id = item.payload.chapter_id;
    if (item.prev) { const i = S.chapters.findIndex(c => c.chapter_id === id); if (i >= 0) S.chapters[i] = item.prev; } else S.chapters = S.chapters.filter(c => c.chapter_id !== id);
    LS.set('chform:' + id, { f: item.payload, at: Date.now() });
    toast('error', 'Chapter gagal disimpan', err.message, { action: { label: 'Buka & perbaiki', fn: () => go('chapter-form', { id, restore: '1' }) } });
    refreshCurrentQuiet();
  }
};
RECON['chapter.delete'] = {
  ok() {},
  fail(err, item) { if (item.prev) S.chapters.push(item.prev); toast('error', 'Chapter gagal dihapus', err.message); refreshCurrentQuiet(); }
};
RECON['chapter.status'] = { ok(data) { RECON['chapter.save'].ok(data); }, fail(err, item) { if (item.prev) { const i = S.chapters.findIndex(c => c.chapter_id === item.prev.chapter_id); if (i >= 0) S.chapters[i] = item.prev; } toast('error', 'Gagal mengubah status', err.message); refreshCurrentQuiet(); } };

// ════════════════════════════════════════════════════════════
// BAGIAN 15 · MODUL A — FORM ANALISIS CHAPTER
// ════════════════════════════════════════════════════════════
const RANAH = ['Kognitif & Analisis', 'Psikomotorik & Kolaborasi', 'Afektif & Karakter'];
function newChapterForm(termId) {
  const units = myUnits(), unit = units[0] || 'HS', mapel = String(S.me.mata_pelajaran || '').split(',')[0].trim();
  const kelas = String(S.me.kelas || '').split(',')[0].trim();
  const m = mapel || (refsOf('SUBJECT')[0] || {}).kode || '', sub0 = uid();
  const b = termBudget(termById(termId), unit, m, kelas), left = b.total ? b.total - usedPeriods(termId, m, kelas) : 0;
  const jp = b.total ? Math.max(1, Math.min(left > 0 ? left : 1, b.ppm * 2)) : 4;
  return { chapter_id: uid(), term_id: termId, unit, mata_pelajaran: m, kelas: kelas || '', nama_chapter: '', jumlah_period: jp, subs: [{ sub_id: sub0, nama_sub: '' }], los: [{ lo_id: uid(), teks_tp: '', ranah: RANAH[0], taksonomi: '', sub_id: sub0 }], _new: true };
}

PAGES['chapter-form'] = {
  title: p => (p.id ? 'Edit Analisis Chapter' : 'Tambah Analisis Chapter'), roles: ['TEACHER', 'SUPERADMIN'], noAutoRefresh: true,
  render(p) {
    const exist = p.id ? chapterById(p.id) : null;
    if (p.id && !exist) return emptyState('journal-x', 'Chapter tidak ditemukan', 'Mungkin sudah dihapus atau belum tersinkron.', `<button class="btn btn-primary" data-go="chapters">Kembali ke daftar</button>`);
    let f;
    const draft = LS.get('chform:' + (p.id || 'new'), null);
    if (exist) { f = clone(exist); f.subs = activeSubs(f).map(s => ({ sub_id: s.sub_id, nama_sub: s.nama_sub, kode: s.kode })); f.los = activeLos(f).map(l => ({ lo_id: l.lo_id, teks_tp: l.teks_tp, ranah: l.ranah || RANAH[0], taksonomi: l.taksonomi || '', kode: l.kode, sub_id: f.subs.some(s => s.sub_id === l.sub_id) ? l.sub_id : '' })); }
    else if (p.dup) { const src = chapterById(p.dup); f = newChapterForm(p.term || activeTerm().term_id); if (src) { const idMap = {}; const subs = activeSubs(src).map(s => { const n = uid(); idMap[s.sub_id] = n; return { sub_id: n, nama_sub: s.nama_sub }; }); Object.assign(f, { unit: src.unit, mata_pelajaran: src.mata_pelajaran, kelas: src.kelas, nama_chapter: src.nama_chapter, jumlah_period: src.jumlah_period || f.jumlah_period, subs, los: activeLos(src).map(l => ({ lo_id: uid(), teks_tp: l.teks_tp, ranah: l.ranah, taksonomi: l.taksonomi, sub_id: idMap[l.sub_id] || '' })) }); } }
    else f = newChapterForm(activeTerm() ? activeTerm().term_id : '');
    if (draft && draft.f && (p.restore || (!exist && !p.dup && draft.f.nama_chapter))) { f = Object.assign(f, draft.f); S.ui.chDraftRestored = true; }
    if (!(+f.jumlah_period > 0)) f.jumlah_period = 4;
    S.form = { f, exist: !!exist, errors: {}, savedAt: draft ? draft.at : 0, key: 'chform:' + (p.id || 'new') };
    return `<div id="chForm">${chapterFormHtml()}</div>`;
  },
  mount() { if (S.ui.chDraftRestored) { S.ui.chDraftRestored = false; toast('info', 'Draft dipulihkan', 'Isian yang belum tersimpan dimuat dari perangkat ini.'); } },
  leave() { S.form = null; }
};

function chapterFormHtml() {
  const { f, exist, errors } = S.form, units = myUnits().length ? myUnits() : ['HS'];
  const term = termById(f.term_id), no = exist ? (String(chapterById(f.chapter_id).kode || '').replace(/\D/g, '') || '1') : String(chaptersInTerm(f.term_id).length + 1);
  const used = exist ? lpsOfChapter(f.chapter_id).length : 0;
  const grades = refsOf('GRADE').filter(g => !g.deskripsi || g.deskripsi === f.unit);
  const err = k => errors[k] ? `<div class="field-err" data-err="${k}">${ic('exclamation-circle')} ${E(errors[k])}</div>` : '';
  const subjects = refsOf('SUBJECT'), mine = String(S.me.mata_pelajaran || '').split(',').map(s => s.trim()).filter(Boolean);
  const subjSorted = subjects.slice().sort((a, b) => (mine.indexOf(b.kode) >= 0) - (mine.indexOf(a.kode) >= 0));
  return `
  <div class="crumbs"><button class="link-btn" data-go="chapters">Analisis Chapter</button><span>/</span><span class="cur">${exist ? 'Edit ' + E(chapterById(f.chapter_id).kode) : 'Tambah Analisis Baru'}</span><span class="ms-auto"><button class="link-btn" data-act="chf.cancel">${ic('arrow-left')} Kembali ke Daftar Chapter</button></span></div>
  <div class="mx-auto" style="max-width:920px">
  ${used ? `<div class="notice sky mb-3"><span class="ic">${ic('info-circle')}</span><div>Chapter ini sudah dipakai <b>${used} lesson plan</b>. Sub-chapter atau TP yang Anda hapus akan <b>dinonaktifkan</b> (bukan dihapus) agar lesson plan lama tetap utuh.</div></div>` : ''}
  <section class="bld-card">
    <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="sec-num">1</span><div><h3>Informasi Umum Chapter</h3><div class="sub">Identitas kurikulum dan ruang lingkup materi pembelajaran</div></div></div><span class="chip">${E(unitShort(f.unit))} · ${E(gradeLabel(f.kelas) || 'Kelas')}</span></div>
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label" for="cfUnit"><span>Unit Sekolah <span class="req">*</span></span></label>
        ${units.length > 1 ? `<select id="cfUnit" class="form-select" data-cf="unit">${units.map(u => `<option value="${u}" ${f.unit === u ? 'selected' : ''}>${E(unitShort(u))} / ${E(unitLabel(u))}</option>`).join('')}</select>` : `<div class="input-icon"><input id="cfUnit" class="form-control" value="${E(unitShort(f.unit) + ' / ' + unitLabel(f.unit))}" readonly><button class="btn-icon eye" tabindex="-1" aria-hidden="true">${ic('lock')}</button></div>`}</div>
      <div class="col-md-6"><label class="form-label" for="cfTerm"><span>Tahun Ajaran & Term <span class="req">*</span></span></label>
        <select id="cfTerm" class="form-select ${errors.term_id ? 'is-invalid' : ''}" data-cf="term_id">${S.terms.map(t => `<option value="${t.term_id}" ${f.term_id === t.term_id ? 'selected' : ''} ${t.status !== 'ACTIVE' ? 'disabled' : ''}>${E(t.tahun_ajaran)} · Term ${t.term} (${E(t.semester)})${t.status !== 'ACTIVE' ? ' — ' + (t.status === 'CLOSED' ? 'ditutup' : 'belum aktif') : ''}</option>`).join('')}</select>${err('term_id')}</div>
      <div class="col-md-6"><label class="form-label" for="cfMapel"><span>Mata Pelajaran <span class="req">*</span></span></label>
        <select id="cfMapel" class="form-select ${errors.mata_pelajaran ? 'is-invalid' : ''}" data-cf="mata_pelajaran"><option value="">Pilih mata pelajaran…</option>${subjSorted.map(s => `<option value="${s.kode}" ${f.mata_pelajaran === s.kode ? 'selected' : ''}>${E(s.label)}${mine.indexOf(s.kode) >= 0 ? ' ★' : ''}</option>`).join('')}</select>${err('mata_pelajaran')}</div>
      <div class="col-md-6"><label class="form-label" for="cfKelas"><span>Tingkat Kelas <span class="req">*</span></span></label>
        <select id="cfKelas" class="form-select ${errors.kelas ? 'is-invalid' : ''}" data-cf="kelas"><option value="">Pilih kelas…</option>${grades.map(g => `<option value="${g.kode}" ${String(f.kelas) === g.kode ? 'selected' : ''}>${E(g.label)}</option>`).join('')}</select>${err('kelas')}</div>
      <div class="col-12"><label class="form-label" for="cfNama"><span>Judul Chapter / Bab Pokok <span class="req">*</span></span><span class="hint" id="cfNamaCnt">${f.nama_chapter.length}/150 karakter</span></label>
        <input id="cfNama" class="form-control fw-6 ${errors.nama_chapter ? 'is-invalid' : ''}" maxlength="150" data-cf="nama_chapter" value="${E(f.nama_chapter)}" placeholder="Contoh: Bab 3: Enzim dan Metabolisme Karbohidrat" style="font-size:1rem">${err('nama_chapter')}</div>
    </div>
  </section>

  <section class="bld-card">
    <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="sec-num">2</span><div><h3>Sub-bab / Topik & Jumlah Period</h3><div class="sub">Urutan topik materi dan period yang dialokasikan untuk chapter ini</div></div></div><span class="chip">${ic('hourglass-split')} <span id="cfJpChip">${+f.jumlah_period || 0}</span> period</span></div>
    <div class="inset">
      <div class="d-flex justify-content-between mb-2 px-1"><span class="fs-xs fw-7 text-3" style="letter-spacing:.08em">DAFTAR SUB-BAB / TOPIK</span><span class="fs-xs text-3">Gunakan panah untuk mengubah urutan</span></div>
      <div id="cfSubs">${f.subs.map((s, i) => `<div class="file-row mb-2" style="padding:8px 10px">
        <span class="d-flex flex-column"><button class="btn-icon" style="height:18px" data-act="chf.subMove" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan">${ic('chevron-up')}</button><button class="btn-icon" style="height:18px" data-act="chf.subMove" data-i="${i}" data-d="1" ${i === f.subs.length - 1 ? 'disabled' : ''} aria-label="Turunkan">${ic('chevron-down')}</button></span>
        <span class="chip">${E(no)}.${i + 1}</span>
        <input class="form-control border-0 bg-transparent px-1" style="min-height:36px" data-cfsub="${i}" value="${E(s.nama_sub)}" placeholder="Nama sub-bab / topik ${i + 1}…" aria-label="Sub-bab ${i + 1}">
        <button class="btn-icon danger" data-act="chf.subDel" data-i="${i}" aria-label="Hapus sub-chapter" ${f.subs.length === 1 ? 'disabled' : ''}>${ic('trash3')}</button></div>`).join('')}</div>
      <button class="btn btn-outline w-100" data-act="chf.subAdd" style="border-style:dashed;color:var(--primary-strong)">${ic('plus-circle')} Tambah Sub-bab / Topik</button>
      ${err('subs')}
    </div>
    <div class="inset d-flex flex-wrap gap-3 align-items-center justify-content-between mt-3" style="background:var(--surface-pure);border:1px solid var(--border)">
      <div style="flex:1 1 260px"><b class="d-block">Jumlah Period Chapter <span class="req" style="color:var(--rose)">*</span></b><span class="fs-sm text-2">Berapa period yang dialokasikan untuk menuntaskan chapter ini. Lesson plan chapter nanti berisi pertemuan 1P/2P yang totalnya sama dengan angka ini.</span></div>
      <div class="d-flex align-items-center gap-3 flex-wrap"><div class="stepper-num"><button data-act="chf.period" data-d="-1" aria-label="Kurangi">−</button><input type="number" min="1" max="300" data-cf="jumlah_period" value="${+f.jumlah_period || 1}" aria-label="Jumlah period" class="${errors.jumlah_period ? 'is-invalid' : ''}"><button data-act="chf.period" data-d="1" aria-label="Tambah">+</button></div>
        <div class="fs-sm" id="cfBudget">${chfBudgetHtml(f)}</div></div>
    </div>${err('jumlah_period')}
  </section>

  <section class="bld-card">
    <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="sec-num">3</span><div><h3>Tujuan Pembelajaran (TP / LO)</h3><div class="sub">Tulis semua TP di chapter ini, lalu tentukan sub-bab/topik tempat setiap TP dicapai. Satu sub-bab boleh memiliki lebih dari satu TP.</div></div></div><span class="chip sky">${f.los.length} TP</span></div>
    <div class="d-flex flex-wrap gap-2 mb-3" id="cfLoCov">${chfCoverageHtml(f)}</div>
    <div class="inset" id="cfLos">${f.los.map((l, i) => `<div class="card-x pure mb-3" style="padding:16px">
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2"><span class="chip">${E(l.kode || 'TP-' + no + '.' + (i + 1))}</span>
        <select class="form-select form-select-sm w-auto fs-sm fw-6 lo-sub ${errors['los' + i] ? 'is-invalid' : ''}" data-cflo="${i}" data-k="sub_id" aria-label="Sub-bab untuk TP ${i + 1}"><option value="">Pilih sub-bab…</option>${f.subs.map((s, si) => `<option value="${E(s.sub_id)}" ${l.sub_id === s.sub_id ? 'selected' : ''}>Sub-bab ${E(no)}.${si + 1}${s.nama_sub.trim() ? ' · ' + E(s.nama_sub.trim().slice(0, 50)) : ''}</option>`).join('')}</select>
        <select class="form-select form-select-sm w-auto border-0 fs-xs text-2" style="min-height:30px;background-color:transparent" data-cflo="${i}" data-k="ranah" aria-label="Ranah">${RANAH.map(r => `<option ${l.ranah === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <span class="ms-auto rt-bar border-0 p-0 bg-transparent" role="toolbar" aria-label="Format teks">${[['bold', 'type-bold', 'Tebal'], ['italic', 'type-italic', 'Miring'], ['underline', 'type-underline', 'Garis bawah'], ['insertUnorderedList', 'list-ul', 'Daftar'], ['insertOrderedList', 'list-ol', 'Penomoran'], ['createLink', 'link-45deg', 'Sisipkan tautan'], ['removeFormat', 'eraser', 'Hapus format']].map(b => `<button type="button" data-act="rt.cmd" data-cmd="${b[0]}" data-i="${i}" title="${b[2]}" aria-label="${b[2]}">${ic(b[1])}</button>`).join('')}</span></div>
      <div class="rt-edit ${errors['lo' + i] ? 'is-invalid' : ''}" contenteditable="true" data-cflo="${i}" data-k="teks_tp" data-placeholder="Peserta didik mampu…" role="textbox" aria-multiline="true" aria-label="Tujuan pembelajaran ${i + 1}" style="border-radius:var(--r-ctl)">${sanitizeRich(l.teks_tp)}</div>
      ${errors['lo' + i] ? `<div class="field-err" data-err="lo${i}">${ic('exclamation-circle')} ${E(errors['lo' + i])}</div>` : ''}${errors['los' + i] ? `<div class="field-err" data-err="los${i}">${ic('exclamation-circle')} ${E(errors['los' + i])}</div>` : ''}
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mt-2"><input class="form-control form-control-sm border-0 bg-transparent fs-xs text-2 px-0" style="min-height:28px;max-width:320px" data-cflo="${i}" data-k="taksonomi" value="${E(l.taksonomi || '')}" placeholder="Target taksonomi (mis. C4 Menganalisis)" aria-label="Target taksonomi">
        <button class="link-btn fs-xs" style="color:var(--rose)" data-act="chf.loDel" data-i="${i}" ${f.los.length === 1 ? 'disabled' : ''}>${ic('trash3')} Hapus TP</button></div></div>`).join('')}
      <button class="btn btn-outline w-100" data-act="chf.loAdd" style="border-style:dashed;color:var(--primary-strong)">${ic('journal-plus')} + Tambah Tujuan Pembelajaran (TP)</button>${err('los')}
    </div>
  </section>
  <section class="insight mb-2"><span class="icon-tile">${ic('clipboard2-check')}</span><div><b>Kepatuhan Kurikulum ICM</b><div class="fs-sm text-2">Analisis ini mencakup ${f.subs.filter(s => s.nama_sub.trim()).length} sub-bab, ${f.los.filter(l => stripTags(l.teks_tp).length >= 10).length} TP, dan ${+f.jumlah_period || 0} period untuk ${E(termLabel(term))}.</div></div><span class="ms-auto chip ${Object.keys(errors).length ? 'rose' : 'green'}" id="cfStd">${Object.keys(errors).length ? ic('exclamation-circle') + ' Perlu dilengkapi' : ic('check-circle') + ' Standar Valid'}</span></section>
  </div>
  <div class="sticky-bar"><span class="autosave" id="cfSaved">${ic('cloud-check')} ${S.form.savedAt ? 'Draft tersimpan otomatis ' + E(relTime(new Date(S.form.savedAt).toISOString())) : 'Isian disimpan otomatis di perangkat'}</span><span class="grow"></span>
    ${exist ? `<button class="btn btn-ghost" data-act="chf.toggle">${ic(chapterById(f.chapter_id).status === 'NONAKTIF' ? 'toggle-off' : 'toggle-on')} ${chapterById(f.chapter_id).status === 'NONAKTIF' ? 'Aktifkan' : 'Nonaktifkan'}</button>` : ''}
    <button class="btn btn-ghost" data-act="chf.cancel">Batal</button>
    <button class="btn btn-soft" data-act="chf.save" data-next="lp">Simpan & Buat Lesson Plan</button>
    <button class="btn btn-primary" data-act="chf.save">${ic('check2')} Simpan Data</button></div>`;
}

/** Teks anggaran period (diperbarui langsung saat angka diketik, tanpa render ulang form). */
function chfBudgetHtml(f) {
  const t = termById(f.term_id), b = termBudget(t, f.unit, f.mata_pelajaran, f.kelas), jp = +f.jumlah_period || 0;
  if (!f.mata_pelajaran || !f.kelas) return `<span class="text-2">Pilih mapel & kelas untuk melihat anggaran period term.</span>`;
  if (!b.total) return `<b class="d-block">Anggaran term belum diatur</b><span class="text-2">Period/minggu ${E(refLabel('SUBJECT', f.mata_pelajaran))} ${E(gradeLabel(f.kelas))} belum diisi QA.</span>`;
  const used = usedPeriods(f.term_id, f.mata_pelajaran, f.kelas, f.chapter_id), left = b.total - used - jp;
  return `<b class="d-block">Anggaran term: ${b.total} period</b><span class="text-2">${b.weeks} minggu × ${b.ppm} period/minggu · chapter lain ${used}</span><div class="fw-7 mt-1" style="color:${left < 0 ? 'var(--rose)' : left === 0 ? 'var(--green)' : 'var(--primary-strong)'}">${left < 0 ? ic('exclamation-triangle') + ' Lebih ' + (-left) + ' period dari anggaran' : left === 0 ? ic('check-circle') + ' Pas — seluruh anggaran terpetakan' : 'Sisa ' + left + ' period — harus dihabiskan oleh chapter lain hingga total tepat ' + b.total}</div>`;
}
/** Ringkasan cakupan TP per sub-bab. */
function chfCoverageHtml(f) {
  const no = S.form && S.form.exist ? (String((chapterById(f.chapter_id) || {}).kode || '').replace(/\D/g, '') || '1') : String(chaptersInTerm(f.term_id).length + 1);
  return f.subs.map((s, i) => { const n = f.los.filter(l => l.sub_id === s.sub_id).length; return `<span class="chip ${n ? 'green' : 'amber'}" title="${E(s.nama_sub)}">${n ? ic('check2') : ic('exclamation-circle')} ${E(no)}.${i + 1} · ${n} TP</span>`; }).join('');
}
function chfRerender() { const y = window.scrollY; $('#chForm').innerHTML = chapterFormHtml(); window.scrollTo(0, y); }
const chfLocalSave = debounce(() => { if (!S.form) return; S.form.savedAt = Date.now(); LS.set(S.form.key, { f: S.form.f, at: S.form.savedAt }); const el = $('#cfSaved'); if (el) el.innerHTML = ic('cloud-check') + ' Draft tersimpan otomatis baru saja'; }, 500);

/* Validasi hidup: begitu isian diperbaiki, pesan error-nya langsung hilang (tanpa re-render, fokus tetap). */
function chfClearErr(key, el) {
  const errs = S.form && S.form.errors; if (!errs || !errs[key]) return;
  delete errs[key];
  const m = $(`#chForm [data-err="${key}"]`); m && m.remove();
  el && el.classList.remove('is-invalid');
  if (!Object.keys(errs).length) { dismissToast('val'); const c = $('#cfStd'); if (c) { c.className = 'ms-auto chip green'; c.innerHTML = ic('check-circle') + ' Standar Valid'; } }
}
document.addEventListener('input', e => {
  if (!S.form) return;
  const t = e.target, f = S.form.f;
  if (t.dataset.cf === 'nama_chapter' && t.value.trim().length >= 3) chfClearErr('nama_chapter', t);
  if (t.dataset.cf && t.tagName === 'SELECT' && t.value) S.form.errors && delete S.form.errors[t.dataset.cf];
  if (t.dataset.cfsub != null && t.value.trim()) chfClearErr('subs');
  if (t.dataset.cflo != null && t.isContentEditable) { const n = stripTags(t.innerHTML).length; if (n) chfClearErr('los'); if (n >= 10) chfClearErr('lo' + t.dataset.cflo, t); }
  if (t.dataset.cf) {
    f[t.dataset.cf] = t.dataset.cf === 'jumlah_period' ? Math.max(0, Math.min(300, +t.value || 0)) : t.value;
    if (t.dataset.cf === 'nama_chapter') { const c = $('#cfNamaCnt'); if (c) c.textContent = t.value.length + '/150 karakter'; }
    if (t.dataset.cf === 'jumlah_period') { const bx = $('#cfBudget'); if (bx) bx.innerHTML = chfBudgetHtml(f); const ch = $('#cfJpChip'); if (ch) ch.textContent = f.jumlah_period; if (f.jumlah_period >= 1) chfClearErr('jumlah_period', t); }
    if (t.tagName === 'SELECT') { if (t.dataset.cf === 'unit') f.kelas = ''; chfRerender(); }
    chfLocalSave();
  } else if (t.dataset.cfsub != null) { f.subs[+t.dataset.cfsub].nama_sub = t.value; chfLocalSave(); }
  else if (t.dataset.cflo != null && t.dataset.k === 'sub_id') { f.los[+t.dataset.cflo].sub_id = t.value; if (t.value) chfClearErr('los' + t.dataset.cflo, t); const cv = $('#cfLoCov'); if (cv) cv.innerHTML = chfCoverageHtml(f); chfLocalSave(); }
  else if (t.dataset.cflo != null) { const lo = f.los[+t.dataset.cflo]; lo[t.dataset.k] = t.isContentEditable ? t.innerHTML : t.value; chfLocalSave(); }
});
document.addEventListener('change', e => { if (S.form && e.target.tagName === 'SELECT' && e.target.dataset.cflo != null && e.target.dataset.k === 'ranah') { S.form.f.los[+e.target.dataset.cflo].ranah = e.target.value; chfLocalSave(); } });

Object.assign(ACT, {
  'chf.subAdd': () => { S.form.f.subs.push({ sub_id: uid(), nama_sub: '' }); chfRerender(); const ins = $$('[data-cfsub]'); ins[ins.length - 1].focus(); },
  'chf.subDel': el => { const f = S.form.f, gone = f.subs.splice(+el.dataset.i, 1)[0]; f.los.forEach(l => { if (gone && l.sub_id === gone.sub_id) l.sub_id = ''; }); chfRerender(); chfLocalSave(); },
  'chf.subMove': el => { const a = S.form.f.subs, i = +el.dataset.i, j = i + (+el.dataset.d); if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; chfRerender(); chfLocalSave(); },
  'chf.loAdd': () => { const f = S.form.f, last = f.los[f.los.length - 1]; f.los.push({ lo_id: uid(), teks_tp: '', ranah: RANAH[0], taksonomi: '', sub_id: last && last.sub_id ? last.sub_id : (f.subs[0] || {}).sub_id || '' }); chfRerender(); const ed = $$('.rt-edit'); ed[ed.length - 1].focus(); },
  'chf.loDel': el => { S.form.f.los.splice(+el.dataset.i, 1); chfRerender(); chfLocalSave(); },
  'chf.period': el => { const f = S.form.f; f.jumlah_period = Math.max(1, Math.min(300, (+f.jumlah_period || 1) + (+el.dataset.d))); const i = $('[data-cf="jumlah_period"]'); if (i) i.value = f.jumlah_period; const bx = $('#cfBudget'); if (bx) bx.innerHTML = chfBudgetHtml(f); const ch = $('#cfJpChip'); if (ch) ch.textContent = f.jumlah_period; chfClearErr('jumlah_period', i); chfLocalSave(); },
  'rt.cmd': el => {
    const ed = $(`.rt-edit[data-cflo="${el.dataset.i}"]`); if (!ed) return;
    ed.focus();
    if (el.dataset.cmd === 'createLink') { const url = (prompt('Alamat tautan (https://…)', 'https://') || '').trim(); if (!/^https?:\/\//i.test(url)) return; document.execCommand('createLink', false, url); }
    else document.execCommand(el.dataset.cmd, false, null);
    S.form.f.los[+el.dataset.i].teks_tp = ed.innerHTML; chfLocalSave();
  },
  'chf.cancel': async () => {
    const f = S.form && S.form.f, dirty = f && (f.nama_chapter || f.subs.some(s => s.nama_sub) || f.los.some(l => stripTags(l.teks_tp)));
    if (dirty && !S.form.exist) { const okk = await confirmDlg({ title: 'Batalkan pengisian?', message: 'Isian tetap tersimpan sebagai draft di perangkat ini dan dapat dilanjutkan nanti.', ok: 'Ya, kembali', tone: 'primary', icon: 'arrow-left' }); if (!okk) return; }
    go('chapters');
  },
  'chf.toggle': () => {
    const c = chapterById(S.form.f.chapter_id); if (!c) return;
    const prev = clone(c); c.status = c.status === 'NONAKTIF' ? 'AKTIF' : 'NONAKTIF';
    Outbox.push('chapter.status', { chapter_id: c.chapter_id, status: c.status }, { key: 'ch:' + c.chapter_id, prev, label: 'Status chapter' });
    toast('success', c.status === 'NONAKTIF' ? 'Chapter dinonaktifkan' : 'Chapter diaktifkan', c.kode); persist(); go('chapters');
  },
  'chf.save': el => {
    const f = S.form.f, errs = {};
    const term = termById(f.term_id);
    if (!term) errs.term_id = 'Pilih term terlebih dahulu.'; else if (term.status !== 'ACTIVE') errs.term_id = 'Pilih term berstatus aktif.';
    if (!f.mata_pelajaran) errs.mata_pelajaran = 'Pilih mata pelajaran.';
    if (!f.kelas) errs.kelas = 'Pilih tingkat kelas.';
    if (String(f.nama_chapter).trim().length < 3) errs.nama_chapter = 'Nama chapter minimal 3 karakter.';
    const subs = f.subs.filter(s => s.nama_sub.trim());
    if (!subs.length) errs.subs = 'Tambahkan minimal satu sub-chapter.';
    const seen = {}; subs.forEach(s => { const k = s.nama_sub.trim().toLowerCase(); if (seen[k]) errs.subs = 'Sub-chapter tidak boleh kembar dalam satu chapter.'; seen[k] = 1; });
    if (!(f.jumlah_period >= 1 && f.jumlah_period <= 300)) errs.jumlah_period = 'Isi jumlah period chapter (1–300).';
    else { const b = termBudget(term, f.unit, f.mata_pelajaran, f.kelas), used = usedPeriods(f.term_id, f.mata_pelajaran, f.kelas, f.chapter_id); const st = S.form.exist ? (chapterById(f.chapter_id) || {}).status : 'AKTIF'; if (b.total && st !== 'NONAKTIF' && used + f.jumlah_period > b.total) errs.jumlah_period = `Melebihi anggaran term: chapter lain sudah ${used} dari ${b.total} period, sisa ${Math.max(0, b.total - used)} period.`; }
    const los = f.los.filter(l => stripTags(l.teks_tp));
    if (!los.length) errs.los = 'Tambahkan minimal satu Tujuan Pembelajaran.';
    f.los.forEach((l, i) => { const n = stripTags(l.teks_tp).length; if (n && n < 10) errs['lo' + i] = 'TP minimal 10 karakter.'; if (n && !subs.some(s => s.sub_id === l.sub_id)) errs['los' + i] = 'Pilih sub-bab/topik untuk TP ini.'; });
    S.form.errors = errs;
    if (Object.keys(errs).length) { chfRerender(); toast('warning', 'Lengkapi isian wajib', Object.keys(errs).length + ' isian perlu diperbaiki.', { page: 1, id: 'val' }); const first = $('.is-invalid, .field-err'); first && first.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    // ── Optimistic: update state & UI dulu, kirim ke server di latar ──
    const prev = S.form.exist ? clone(chapterById(f.chapter_id)) : null;
    const payload = { chapter_id: f.chapter_id, term_id: f.term_id, unit: f.unit, mata_pelajaran: f.mata_pelajaran, kelas: f.kelas, nama_chapter: f.nama_chapter.trim(), jumlah_period: +f.jumlah_period, subs: subs.map(s => ({ sub_id: s.sub_id, nama_sub: s.nama_sub.trim() })), los: los.map(l => ({ lo_id: l.lo_id, teks_tp: sanitizeRich(l.teks_tp), ranah: l.ranah, taksonomi: l.taksonomi, sub_id: l.sub_id })) };
    const kode = prev ? prev.kode : 'CH-' + String(chaptersInTerm(f.term_id).length + 1).padStart(2, '0'), no = kode.replace(/\D/g, '');
    const oldLo = byKey(prev ? prev.los : [], 'lo_id'); let maxN = 0; (prev ? prev.los : []).forEach(l => { const m = /\.(\d+)$/.exec(l.kode || ''); if (m) maxN = Math.max(maxN, +m[1]); });
    const optimistic = Object.assign({}, prev || { user_id: S.me.user_id, status: 'AKTIF', dibuat_pada: '' }, payload, {
      kode, subs: payload.subs.map((s, i) => ({ sub_id: s.sub_id, kode: no + '.' + (i + 1), nama_sub: s.nama_sub, aktif: true })),
      los: payload.los.map(l => ({ lo_id: l.lo_id, kode: oldLo[l.lo_id] ? oldLo[l.lo_id].kode : 'TP-' + no + '.' + (++maxN), teks_tp: l.teks_tp, ranah: l.ranah, taksonomi: l.taksonomi, sub_id: l.sub_id, aktif: true })),
      diubah_pada: nowIso()
    });
    if (prev) { const keep = (prev.subs || []).filter(s => !payload.subs.some(x => x.sub_id === s.sub_id)); const keepL = (prev.los || []).filter(l => !payload.los.some(x => x.lo_id === l.lo_id)); if (lpsOfChapter(prev.chapter_id).length) { optimistic.subs = optimistic.subs.concat(keep.map(s => Object.assign({}, s, { aktif: false }))); optimistic.los = optimistic.los.concat(keepL.map(l => Object.assign({}, l, { aktif: false }))); } }
    optimistic.jumlah_sub = payload.subs.length; optimistic.jumlah_tp = payload.los.length;
    const i = S.chapters.findIndex(c => c.chapter_id === f.chapter_id);
    if (i >= 0) S.chapters[i] = optimistic; else S.chapters.push(optimistic);
    Outbox.push('chapter.save', payload, { key: 'ch:' + f.chapter_id, prev, label: 'Simpan chapter' });
    LS.del(S.form.key);
    persist();
    toast('success', 'Analisis Chapter tersimpan', kode + ' · ' + payload.nama_chapter + ' — status Tersimpan, tombol Edit aktif.');
    if (el.dataset.next === 'lp') { const lp = lpOfChapter(f.chapter_id); if (lp) go(isEditable(lp) ? 'builder' : 'lp-view', { id: lp.lp_id }); else go('builder', { chapter: f.chapter_id }); } else go('chapters');
  }
});

// ════════════════════════════════════════════════════════════
// BAGIAN 16 · MODUL B — DAFTAR LESSON PLAN (GURU)
// ════════════════════════════════════════════════════════════
PAGES.lps = {
  title: 'Lesson Plan', roles: ['TEACHER'],
  render(p) {
    const t = viewTerm(), u = S.ui.lp = S.ui.lp || { tab: p.tab || 'ALL', q: '', ch: '', page: 1, per: 10 };
    if (p.tab) u.tab = p.tab;
    const all = lpsInTerm(t.term_id);
    const cnt = st => all.filter(l => l.status === st).length;
    const rows = all.filter(l => (u.tab === 'ALL' || l.status === u.tab) && (!u.ch || l.chapter_id === u.ch) && (!u.q || (lpTitle(l) + ' ' + l.sub_label + ' ' + l.catatan_terakhir + ' ' + l.kode_dok).toLowerCase().indexOf(u.q.toLowerCase()) >= 0))
      .sort((a, b) => { const o = { RETURNED: 0, DRAFT: 1, PENDING: 2, APPROVED: 3 }; return (o[a.status] - o[b.status]) || (ts(b.diubah_pada) - ts(a.diubah_pada)); });
    const page = Math.min(u.page, Math.max(1, Math.ceil(rows.length / u.per))), slice = rows.slice((page - 1) * u.per, page * u.per);
    const tab = (k, l, n, warn) => `<button class="tab ${u.tab === k ? 'active' : ''} ${warn && n ? 'warn' : ''}" data-act="lp.tab" data-tab="${k}">${l} <span class="n">${n}</span></button>`;
    const chs = chaptersInTerm(t.term_id);
    return `
    <div class="crumbs"><span>Akademik</span><span>›</span><span class="cur">Lesson Plan</span></div>
    <div class="page-head"><div><h1>Daftar Lesson Plan</h1><div class="desc">Monitoring modul ajar, revisi pimpinan, dan unduhan PDF resmi · ${E(termLabel(t))}</div></div>
      <div class="actions"><button class="btn btn-soft" data-act="t.export">${ic('download')} Ekspor Rekap</button><button class="btn btn-primary" data-act="lp.new">${ic('plus-lg')} Buat Lesson Plan Baru</button></div></div>
    <div class="stat-grid">
      ${statCard({ label: 'Total Modul Ajar', icon: 'journals', value: all.length, unit: 'RPP', cap: chs.length + ' chapter aktif' })}
      ${statCard({ label: 'Memerlukan Revisi', icon: 'pencil-square', tone: 'amber', value: cnt('RETURNED'), unit: 'Berkas', vtone: cnt('RETURNED') ? 'amber' : '', cap: 'Dikembalikan pimpinan' })}
      ${statCard({ label: 'Menunggu Evaluasi', icon: 'hourglass-split', tone: 'sky', value: cnt('PENDING'), unit: 'Berkas', vtone: 'sky', cap: 'Pending approval' })}
      ${statCard({ label: 'Disetujui', icon: 'patch-check', value: cnt('APPROVED'), unit: 'Berkas', vtone: 'primary', cap: 'Siap diajarkan & diunduh' })}
    </div>
    <div class="tabs" role="tablist">${tab('ALL', 'Semua', all.length)}${tab('RETURNED', 'Perlu Revisi', cnt('RETURNED'), true)}${tab('PENDING', 'Menunggu Review', cnt('PENDING'))}${tab('APPROVED', 'Disetujui', cnt('APPROVED'))}${tab('DRAFT', 'Draf', cnt('DRAFT'))}</div>
    <section class="card-x flush pure mb-4">
      <div class="filter-bar"><div class="input-icon search">${ic('search')}<input class="form-control" data-f="lp.q" value="${E(u.q)}" placeholder="Cari chapter, sub-bab, kode, atau catatan revisi…" aria-label="Cari lesson plan"></div>
        <select class="form-select" data-f="lp.ch" aria-label="Filter chapter"><option value="">Semua Chapter</option>${chs.map(c => `<option value="${c.chapter_id}" ${u.ch === c.chapter_id ? 'selected' : ''}>${E(c.kode + ' · ' + c.nama_chapter)}</option>`).join('')}</select></div>
      ${slice.length ? `<div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Chapter</th><th>Sub-bab / Catatan</th><th>Pertemuan & Period</th><th>Versi</th><th>Status</th><th class="text-end">Aksi</th></tr></thead><tbody>
      ${slice.map(l => `<tr class="st-${l.status} clickable" data-act="lp.open" data-id="${E(l.lp_id)}">
        <td class="lb col-main" data-label="Chapter"><div class="t-title">${E(lpTitle(l))} ${unsyncedBadge('lp:' + l.lp_id)}</div><div class="t-sub">${E(l.kode_dok || 'Kode dibuat saat sinkron')} · Term ${E(termById(l.term_id) ? termById(l.term_id).term : '')}</div></td>
        <td data-label="Materi" style="max-width:300px"><div class="fw-6 clamp-1">${E(l.sub_label || '—')}</div>${l.status === 'RETURNED' ? `<div class="t-sub clamp-2" style="color:var(--st-returned)">${ic('chat-square-quote')} Catatan: ${E(l.catatan_terakhir)}</div>` : l.status === 'PENDING' ? `<div class="t-sub">${ic('clock-history')} Menunggu ${E(fmtWait(l.submitted_at))}</div>` : l.status === 'APPROVED' ? `<div class="t-sub">${ic('check-circle')} Siap dicetak & diajarkan</div>` : `<div class="t-sub">${ic('pencil')} Diubah ${E(relTime(l.diubah_pada))}</div>`}</td>
        <td data-label="Pertemuan & Period" class="text-nowrap"><div class="fw-6">${E(lpMeta(l))}</div><div class="t-sub">${(() => { const ch = chapterById(l.chapter_id), tp = ch ? +ch.jumlah_period || 0 : 0, pp = lpPeriods(l); return tp ? (pp === tp ? ic('check2') + ' sesuai chapter (' + tp + ')' : 'chapter ' + tp + ' period') : E(l.durasi_total || 0) + ' menit'; })()}</div></td>
        <td data-label="Versi"><span class="chip ${l.status === 'APPROVED' ? 'green' : 'gray'}">${l.status === 'APPROVED' ? 'Final (v' + E(l.revisi_ke) + ')' : 'Rev. ' + E(l.revisi_ke)}</span></td>
        <td data-label="Status">${pill(l.status)}</td>
        <td class="text-end cell-actions"><div class="d-inline-flex gap-1 align-items-center">${l.status === 'RETURNED' ? `<button class="btn btn-amber btn-sm" data-go="builder" data-p-id="${E(l.lp_id)}">${ic('pencil')} Buka & Revisi</button>` : l.status === 'DRAFT' ? `<button class="btn btn-soft btn-sm" data-go="builder" data-p-id="${E(l.lp_id)}">${ic('pencil')} Lanjutkan</button>` : l.status === 'APPROVED' ? `<button class="btn btn-soft btn-sm" data-act="lp.pdf" data-id="${E(l.lp_id)}" data-mode="final">${ic('download')} Unduh</button>` : `<button class="btn btn-soft btn-sm" data-go="lp-view" data-p-id="${E(l.lp_id)}">${ic('eye')} Lihat</button>`}
          <button class="btn-icon" data-act="lp.more" data-id="${E(l.lp_id)}" aria-label="Aksi lain">${ic('three-dots-vertical')}</button></div></td></tr>`).join('')}
      </tbody></table></div><div class="tbl-foot"><span>Menampilkan ${slice.length} dari ${rows.length} lesson plan</span>${pager(rows.length, page, u.per, 'lp.page')}</div>`
        : emptyState('file-earmark-text', all.length ? 'Tidak ada lesson plan di tab ini' : 'Belum ada lesson plan', all.length ? 'Coba tab atau kata kunci lain.' : (chs.length ? 'Susun lesson plan pertama Anda dari chapter yang sudah dipetakan.' : 'Buat Analisis Chapter terlebih dahulu — TP/LO-nya akan dipanggil otomatis.'), `<button class="btn btn-primary" data-act="lp.new">${ic('plus-lg')} Buat Lesson Plan</button>`)}
    </section>
    <section class="insight" style="background:var(--amber-tint)"><span class="icon-tile amber">${ic('signpost-split')}</span><div><b>Panduan Siklus Revisi</b><div class="fs-sm text-2">Lesson plan berstatus <b>Perlu Revisi</b> sebaiknya diunggah ulang paling lambat ${E(cfg('sla_hari', 2))} hari kerja sebelum jadwal mengajar. Setiap pengajuan ulang menambah nomor revisi dan riwayatnya tetap tersimpan.</div></div></section>`;
  }
};

Object.assign(ACT, {
  'lp.tab': el => { S.ui.lp.tab = el.dataset.tab; S.ui.lp.page = 1; renderRoute(false); },
  'lp.page': el => { S.ui.lp.page = +el.dataset.page; renderRoute(false); },
  'lp.open': el => { const l = lpById(el.dataset.id); if (!l) return; go(isEditable(l) && isRole('TEACHER') ? 'builder' : 'lp-view', { id: l.lp_id }); },
  'lp.new': () => {
    const t = activeTerm();
    if (t && chaptersInTerm(t.term_id).filter(c => c.status === 'AKTIF').length && !chaptersWithoutLp(t.term_id).length) {
      modal({ title: 'Semua chapter sudah punya lesson plan', html: `<div class="mdl-head"><div class="d-flex gap-3"><span class="icon-tile">${ic('check2-all')}</span><div><h3>Semua chapter sudah memiliki lesson plan</h3><p class="text-2 mt-1 mb-0">Lesson plan disusun satu per chapter. Untuk menambah pertemuan, buka lesson plan chapter yang bersangkutan. Untuk materi baru, tambahkan chapter di Analisis Chapter.</p></div></div></div><div class="mdl-foot"><button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-primary" data-close data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button></div>` });
      return;
    }
    if (!t || !chaptersInTerm(t.term_id).filter(c => c.status === 'AKTIF').length) {
      modal({ title: 'Analisis Chapter diperlukan', html: `<div class="mdl-head"><div class="d-flex gap-3"><span class="icon-tile amber">${ic('journal-x')}</span><div><h3>Buat Analisis Chapter dulu</h3><p class="text-2 mt-1 mb-0">Lesson plan hanya dapat dibuat bila Anda sudah memiliki minimal satu Analisis Chapter tersimpan pada term aktif. TP/LO yang Anda pilih nanti diambil dari sana.</p></div></div></div><div class="mdl-foot"><button class="btn btn-ghost" data-close>Nanti</button><button class="btn btn-primary" data-close data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button></div>` });
      return;
    }
    go('builder', {});
  },
  'lp.more': el => {
    const l = lpById(el.dataset.id); if (!l) return;
    popMenu(el, `<button class="mi" data-go="lp-view" data-p-id="${E(l.lp_id)}">${ic('eye')}Lihat dokumen & riwayat</button>
      <button class="mi" data-act="lp.pdf" data-id="${E(l.lp_id)}" data-mode="${l.status === 'APPROVED' ? 'final' : 'draft'}">${ic('filetype-pdf')}Unduh ${l.status === 'APPROVED' ? 'PDF resmi' : 'draf PDF'}</button>
      ${l.status === 'DRAFT' ? `<div class="sep"></div><button class="mi" data-act="lp.del" data-id="${E(l.lp_id)}" style="color:var(--rose)">${ic('trash3')}Hapus draft</button>` : ''}`);
  },
  'lp.del': async el => {
    closeMenu();
    const l = lpById(el.dataset.id); if (!l || l.status !== 'DRAFT') return;
    if (!(await confirmDlg({ title: 'Hapus draft ini?', message: `<b>${E(lpTitle(l))}</b> akan dihapus.`, ok: 'Hapus draft', tone: 'danger', icon: 'trash3', iconTone: 'rose' }))) return;
    const prev = clone(l);
    S.lps = S.lps.filter(x => x.lp_id !== l.lp_id); LS.del('draft:' + l.lp_id);
    if (!l.kode_dok) Outbox.drop('lp:' + l.lp_id); else Outbox.push('lp.delete', { lp_id: l.lp_id }, { key: 'lp:' + l.lp_id, prev });
    persist(); renderRoute(false); toast('success', 'Draft dihapus', lpTitle(l));
  },
  'lp.pdf': (el) => {
    closeMenu();
    const id = el.dataset.id, mode = el.dataset.mode || 'draft';
    setBtnBusy(el.tagName === 'BUTTON' && !el.classList.contains('mi') ? el : null, true, 'Menyiapkan PDF…');
    toast('info', mode === 'final' ? 'Menyiapkan PDF resmi…' : 'Membuat draf PDF…', 'Biasanya 2–5 detik.');
    call('lp.pdf', { lp_id: id, mode }).then(r => { downloadBlob(b64ToBlob(r.b64, r.mime), r.name); toast('success', 'PDF terunduh', r.name); })
      .catch(e => toast('error', 'Gagal membuat PDF', e.message)).finally(() => setBtnBusy(el.tagName === 'BUTTON' && !el.classList.contains('mi') ? el : null, false));
  }
});

// ════════════════════════════════════════════════════════════
// BAGIAN 17 · MODUL B — LESSON PLAN BUILDER (5 LANGKAH)
// ════════════════════════════════════════════════════════════
const STEPS = [
  { t: 'Identitas & Bab', i: 'journal-bookmark' }, { t: 'Tujuan Pembelajaran', i: 'bullseye' }, { t: 'Pertanyaan Esensial', i: 'question-circle' },
  { t: 'Pertemuan & Skenario', i: 'clock-history' }, { t: 'Lampiran & Kirim', i: 'send' }
];
const CONTENT_KEYS = ['chapter_id', 'essential_question', 'sessions'];
const SCEN = [
  { k: 'beginning', key: 'A', t: 'Pendahuluan (Beginning)', s: 'Apersepsi, motivasi, dan orientasi tujuan', ph: 'Pembukaan, salam, apersepsi, pembacaan tujuan pembelajaran & orientasi materi…' },
  { k: 'middle', key: 'B', t: 'Kegiatan Inti (Middle)', s: 'Mini lesson, praktik terbimbing, diskusi kelompok', ph: 'Penyampaian mini lesson / konsep utama, aktivitas diskusi kelompok / praktik mandiri, umpan balik langsung…' },
  { k: 'end', key: 'C', t: 'Penutup (End)', s: 'Refleksi, kesimpulan, dan tindak lanjut', ph: 'Refleksi bersama & kesimpulan, asesmen formatif, penginstruksian tugas / tindak lanjut sesi berikutnya…' }
];
const ALLOWED_ATT = { pdf: 1, docx: 1, pptx: 1 };

/** Susun pertemuan otomatis dari period chapter: 2P bila mapel ≥ 4 period/minggu (atau tidak diatur), sisanya 1P; topik dibagi berurutan. */
function genSessions(ch) {
  if (!ch || !ch.chapter_id) return [];
  const opts = periodOpts(ch.unit), one = opts.find(o => periodCount(o, ch.unit) === 1), two = opts.find(o => periodCount(o, ch.unit) === 2);
  const ppm = subjPeriod(ch.unit, ch.mata_pelajaran, ch.kelas), P = Math.max(1, +ch.jumlah_period || 1), subs = activeSubs(ch);
  const slots = [];
  let left = P;
  while (left > 0 && slots.length < 60) { const use2 = two && left >= 2 && (ppm === 0 || ppm >= 4 || !one); const o = use2 ? two : (one || two || opts[0]); if (!o) break; slots.push(o); left -= Math.max(1, periodCount(o, ch.unit)); }
  const los = activeLos(ch), n = los.length;
  return slots.map((o, i) => {
    const d = defScen(o.menit), st = n ? Math.min(n - 1, Math.floor(i * n / slots.length)) : 0, en = n ? Math.max(st + 1, Math.floor((i + 1) * n / slots.length)) : 0;
    const se = { id: uid(), tanggal: '', lo_ids: los.slice(st, en).map(l => l.lo_id), sub_ids: [], indikator_manual: [], terminology: '', icm: [], seq: [], diff: [], alok_kode: o.kode, scenarios: { beginning: { menit: d.beginning, desc: '' }, middle: { menit: d.middle, desc: '' }, end: { menit: d.end, desc: '' } } };
    syncSesSubs(se, ch); return se;
  });
}
/** Sub-bab sebuah pertemuan mengikuti TP yang dipilih (urutan sub-bab chapter). */
function syncSesSubs(se, ch) {
  const subOf = {}; activeLos(ch).forEach(l => { subOf[l.lo_id] = l.sub_id; });
  se.lo_ids = (se.lo_ids || []).filter(x => subOf[x] !== undefined);
  se.sub_ids = activeSubs(ch).filter(sb => se.lo_ids.some(x => subOf[x] === sb.sub_id)).map(sb => sb.sub_id);
}
/** Lesson plan format lama (pertemuan hanya berisi sub-bab): ambil semua TP pada sub-bab itu. */
function ensureSesLos(lp, ch) {
  (lp.sessions || []).forEach(se => { if (!se.lo_ids || !se.lo_ids.length) { se.lo_ids = (se.sub_ids || []).length ? activeLos(ch).filter(l => se.sub_ids.indexOf(l.sub_id) >= 0).map(l => l.lo_id) : []; } syncSesSubs(se, ch); });
}
/** TP chapter yang belum masuk ke pertemuan mana pun. */
function uncoveredLos(lp, ch) { const c = {}; (lp.sessions || []).forEach(se => (se.lo_ids || []).forEach(x => { c[x] = 1; })); return activeLos(ch).filter(l => !c[l.lo_id]); }
function newSession(ch, kode) {
  const o = periodOpts(ch.unit).find(x => x.kode === kode) || periodOpts(ch.unit)[0], d = defScen(o ? o.menit : 80);
  return { id: uid(), tanggal: '', lo_ids: [], sub_ids: [], indikator_manual: [], terminology: '', icm: [], seq: [], diff: [], alok_kode: o ? o.kode : '', scenarios: { beginning: { menit: d.beginning, desc: '' }, middle: { menit: d.middle, desc: '' }, end: { menit: d.end, desc: '' } } };
}
function emptyLp(chapterId) {
  const ch = chapterById(chapterId) || {};
  return {
    lp_id: uid(), chapter_id: chapterId || '', essential_question: '', sessions: genSessions(ch),
    status: 'DRAFT', revisi_ke: 1, kode_dok: '', catatan_terakhir: '', reviewer_terakhir: '', jumlah_return: 0, full: true, _new: true
  };
}
const scenTotal = sc => (+sc.beginning.menit || 0) + (+sc.middle.menit || 0) + (+sc.end.menit || 0);
const lpTotalMin = lp => sum((lp.sessions || []).map(sesMinutes));
const lpPlannedPeriods = (lp, ch) => sum((lp.sessions || []).map(se => periodCount(sesAlok(se, ch.unit), ch.unit)));
/** Chapter aktif yang belum punya LP (atau milik LP ini). */
const chaptersForLp = (termId, lpId) => chaptersInTerm(termId).filter(c => c.status === 'AKTIF').map(c => ({ c, other: lpsOfChapter(c.chapter_id).find(l => l.lp_id !== lpId) }));

PAGES.builder = {
  title: 'Lesson Plan Builder', roles: ['TEACHER'], noAutoRefresh: true,
  render(p) {
    const tA = activeTerm();
    const activeChs = tA ? chaptersInTerm(tA.term_id).filter(c => c.status === 'AKTIF') : [];
    let lp = null, known = p.id ? S.lps.find(l => l.lp_id === p.id) : null;
    const draft = p.id ? LS.get('draft:' + p.id, null) : null;
    if (known && !isEditable(known)) { S.builder = { redirect: known.lp_id }; return skeletonPage(); }
    if (known && known.full) lp = clone(known);
    if (draft && draft.lp) {
      if (!lp) lp = clone(draft.lp);
      else if (draft.at > ts(known.diubah_pada) - 1000) CONTENT_KEYS.forEach(k => { if (draft.lp[k] !== undefined) lp[k] = clone(draft.lp[k]); });
    }
    if (p.id && !lp) { S.builder = { loading: p.id }; return `<div class="builder-top"><div class="sk sk-title"></div></div><div class="steps">${STEPS.map(() => '<div class="sk" style="height:56px;margin:0 8px"></div>').join('')}</div><div class="bld-card"><div class="sk sk-line"></div><div class="sk sk-block mt-3"></div></div>`; }
    if (!lp) {
      if (!activeChs.length) {
        S.builder = null;
        return emptyState('journal-x', 'Buat Analisis Chapter terlebih dahulu', 'Lesson plan hanya dapat dibuat bila Anda sudah memiliki minimal satu Analisis Chapter tersimpan pada term aktif. TP/LO di Lesson Plan diambil langsung dari sana.', `<button class="btn btn-primary" data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button>`);
      }
      // Satu LP per chapter: bila chapter yang diminta sudah punya LP, buka LP itu
      const want = chapterById(p.chapter), existing = want ? lpOfChapter(want.chapter_id) : null;
      if (existing) { S.builder = { redirect: existing.lp_id, edit: isEditable(existing) }; return skeletonPage(); }
      const free = activeChs.filter(c => !lpOfChapter(c.chapter_id));
      if (!free.length) { S.builder = null; return emptyState('check2-all', 'Semua chapter sudah memiliki lesson plan', 'Lesson plan disusun satu per chapter. Buka lesson plan chapter yang bersangkutan untuk menambah pertemuan, atau tambahkan chapter baru.', `<button class="btn btn-soft" data-go="lps">Daftar Lesson Plan</button> <button class="btn btn-primary" data-go="chapter-form">${ic('plus-lg')} Tambah Analisis Chapter</button>`); }
      const ch = want && want.status === 'AKTIF' ? want : free[0];
      lp = emptyLp(ch.chapter_id);
    }
    if (!lp.sessions) lp.sessions = [];
    { const c0 = chapterById(lp.chapter_id); if (c0) ensureSesLos(lp, c0); }
    S.builder = { lp, step: Math.min(5, Math.max(1, +p.step || 1)), dirty: !!(draft && p.fresh), errs: {}, tried: false, localAt: draft ? draft.at : 0, serverAt: known ? ts(known.diubah_pada) : 0, timer: null, state: 'idle', open: 0 };
    return `<div id="bld">${builderHtml()}</div>`;
  },
  mount(p) {
    const b = S.builder;
    if (b && b.redirect) { go(b.edit ? 'builder' : 'lp-view', { id: b.redirect }, { replace: true }); return; }
    if (b && b.loading) {
      call('lp.get', { lp_id: b.loading }).then(d => { upsertLp(Object.assign({}, d.lp, { full: true })); S.detail[d.lp.lp_id] = d; if (S.route.name === 'builder' && S.route.params.id === d.lp.lp_id) renderRoute(false); })
        .catch(e => { toast('error', 'Gagal memuat lesson plan', e.message); go('lps', {}, { replace: true }); });
      return;
    }
    if (b && b.dirty) scheduleServerSave();
  },
  leave() { if (S.builder && S.builder.lp) builderFlush(); S.builder = null; }
};

function upsertLp(obj) {
  const i = S.lps.findIndex(l => l.lp_id === obj.lp_id);
  if (i >= 0) S.lps[i] = Object.assign({}, S.lps[i], obj); else S.lps.push(obj);
  persist();
}

/** Ringkasan optimistic untuk daftar/dashboard (label dihitung di klien). */
function builderSummary(lp, extra) {
  const ch = chapterById(lp.chapter_id) || {};
  const subMap = byKey(ch.subs || [], 'sub_id'), used = {};
  (lp.sessions || []).forEach(se => (se.sub_ids || []).forEach(x => { used[x] = 1; }));
  const dates = (lp.sessions || []).map(se => se.tanggal).filter(Boolean).sort();
  return Object.assign({}, lp, {
    user_id: S.me.user_id, term_id: ch.term_id, chapter_label: ch.nama_chapter || '', sub_label: (ch.subs || []).filter(x => used[x.sub_id]).map(x => x.kode + ' ' + x.nama_sub).join('; '),
    jumlah_sesi: (lp.sessions || []).length, tanggal_ajar: dates[0] || '', unit: ch.unit, mata_pelajaran: ch.mata_pelajaran, kelas: ch.kelas, durasi_total: lpTotalMin(lp),
    diubah_pada: nowIso(), dibuat_pada: lp.dibuat_pada || nowIso(), full: true
  }, extra || {});
}

/** Kirim draft ke server lewat antrean (dipanggil tiap 30 dtk bila berubah, saat ganti langkah, dan saat keluar). */
function builderFlush() {
  const b = S.builder;
  if (!b || !b.lp || !b.dirty || !b.lp.chapter_id) return;
  clearTimeout(b.timer); b.timer = null;
  b.dirty = false;
  const lp = b.lp, sum = builderSummary(lp);
  delete sum._new;
  upsertLp(sum);
  const payload = {}; CONTENT_KEYS.forEach(k => { payload[k] = lp[k]; }); payload.lp_id = lp.lp_id;
  Outbox.push('lp.save', payload, { key: 'lp:' + lp.lp_id, label: 'Simpan draft', at: Date.now() });
  b.state = 'saving'; paintAutosave();
}
function scheduleServerSave() {
  const b = S.builder; if (!b) return;
  if (!b.timer) b.timer = setTimeout(() => { if (S.builder === b) builderFlush(); }, 30000);
}
const builderLocalSave = debounce(() => {
  const b = S.builder; if (!b || !b.lp) return;
  b.localAt = Date.now();
  LS.set('draft:' + b.lp.lp_id, { lp: b.lp, at: b.localAt });
  paintAutosave();
}, 450);
function markDirty() { const b = S.builder; if (!b) return; b.dirty = true; if (b.state !== 'saving') b.state = 'local'; builderLocalSave(); scheduleServerSave(); }
function paintAutosave() {
  const el = $('#bldSave'), b = S.builder; if (!el || !b) return;
  const st = Outbox.has('lp:' + b.lp.lp_id) ? 'saving' : b.state;
  el.className = 'autosave' + (st === 'saving' ? ' busy' : st === 'error' ? ' err' : '');
  el.innerHTML = st === 'saving' ? `${ic('arrow-repeat')} Menyinkron ke server…` : st === 'local' ? `${ic('device-ssd')} Tersimpan di perangkat ${E(relTime(new Date(b.localAt || Date.now()).toISOString()))}` : st === 'error' ? `${ic('exclamation-triangle')} Gagal sinkron — tersimpan di perangkat` : `${ic('cloud-check')} Tersimpan ${b.serverAt ? E(relTime(new Date(b.serverAt).toISOString())) : 'otomatis'}`;
}

RECON['lp.save'] = {
  ok(data, item) {
    const cur = S.lps.find(l => l.lp_id === data.lp_id);
    const merged = Object.assign({}, cur || {}, data, { full: true });
    if (S.builder && S.builder.lp && S.builder.lp.lp_id === data.lp_id) { CONTENT_KEYS.forEach(k => { merged[k] = S.builder.lp[k]; }); S.builder.lp.kode_dok = data.kode_dok; S.builder.lp.revisi_ke = data.revisi_ke; S.builder.serverAt = Date.now(); S.builder.state = S.builder.dirty ? 'local' : 'idle'; delete S.builder.lp._new; paintAutosave(); const k = $('#bldKode'); if (k) k.textContent = data.kode_dok; }
    upsertLp(merged);
    const d = LS.get('draft:' + data.lp_id, null);
    if (d && d.at <= (item.at || Date.now())) LS.del('draft:' + data.lp_id);
    (data.warnings || []).forEach(w => toast('warning', 'Perhatian', w));
  },
  fail(err, item) {
    if (S.builder && S.builder.lp && S.builder.lp.lp_id === item.payload.lp_id) { S.builder.state = 'error'; paintAutosave(); }
    if (err.code === 'DUPLICATE') toast('error', 'Chapter sudah punya lesson plan', err.message, { action: { label: 'Buka lesson plan', fn: () => go('builder', { id: (err.data && err.data.lp_id) || item.payload.lp_id }) } });
    else if (err.code === 'LOCKED' || err.code === 'STATE') { toast('warning', 'Dokumen terkunci', err.message); syncNow(false); }
    else toast('error', 'Draft gagal disimpan ke server', err.message + ' Isian tetap aman di perangkat.', { action: { label: 'Buka', fn: () => go('builder', { id: item.payload.lp_id }) } });
  }
};
RECON['lp.submit'] = {
  ok(data) {
    upsertLp(Object.assign({}, data, { full: true }));
    LS.del('draft:' + data.lp_id);
    toast('success', 'Terkirim ke pimpinan', `${lpTitle(data)} kini berstatus Pending Approval (Rev. ${data.revisi_ke}).`);
    refreshCurrentQuiet();
  },
  fail(err, item) {
    const l = S.lps.find(x => x.lp_id === item.payload.lp_id);
    if (l && item.prev) Object.assign(l, { status: item.prev.status, revisi_ke: item.prev.revisi_ke, submitted_at: item.prev.submitted_at });
    LS.set('draft:' + item.payload.lp_id, { lp: Object.assign({}, l || {}, item.payload, { status: item.prev ? item.prev.status : 'DRAFT' }), at: Date.now() });
    persist();
    toast('error', 'Pengajuan ditolak server', (err.data && err.data.errors ? err.data.errors.join(' • ') : err.message), { ms: 10000, action: { label: 'Perbaiki sekarang', fn: () => go('builder', { id: item.payload.lp_id, step: 5 }) } });
    refreshCurrentQuiet();
  }
};
RECON['lp.delete'] = { ok() {}, fail(err, item) { if (item.prev) S.lps.push(item.prev); toast('error', 'Draft gagal dihapus', err.message); refreshCurrentQuiet(); } };
RECON['file.delete'] = { ok() {}, fail(err, item) { if (item.prev) S.atts.push(item.prev); toast('error', 'Lampiran gagal dihapus', err.message); if (S.builder) bldRerender(); } };

/** Validasi klien (sama dengan server) → error per langkah. */
function validateBuilder(lp) {
  const e = { 1: [], 2: [], 3: [], 4: [], 5: [] }, ch = chapterById(lp.chapter_id);
  if (!ch) { e[1].push('Pilih chapter.'); return e; }
  if (lpsOfChapter(ch.chapter_id).some(l => l.lp_id !== lp.lp_id)) e[1].push('Chapter ini sudah memiliki lesson plan lain.');
  { const bd = termBudget(termById(ch.term_id), ch.unit, ch.mata_pelajaran, ch.kelas); if (bd.total > 0) { const used = usedPeriods(ch.term_id, ch.mata_pelajaran, ch.kelas, ''); if (used !== bd.total) e[1].push(`Total period semua chapter ${refLabel('SUBJECT', ch.mata_pelajaran)} ${gradeLabel(ch.kelas)} di term ini harus tepat ${bd.total} period (saat ini ${used}). Lengkapi Analisis Chapter terlebih dahulu.`); } }
  if (!activeLos(ch).length) e[2].push('Chapter belum memiliki Tujuan Pembelajaran (TP). Lengkapi Analisis Chapter.');
  if (!String(lp.essential_question).trim()) e[3].push('Isi Essential Question.');
  const ses = lp.sessions || [];
  if (!ses.length) e[4].push('Tambahkan minimal satu pertemuan.');
  ses.forEach((se, i) => {
    const n = 'Pertemuan ' + (i + 1) + ': ', al = sesAlok(se, ch.unit), sc = se.scenarios;
    if (!al) e[4].push(n + 'pilih alokasi period.');
    if (!(se.lo_ids || []).length) e[4].push(n + 'pilih minimal satu TP yang diajarkan.');
    if (!(se.icm || []).length) e[4].push(n + 'pilih minimal satu ICM Value.');
    if (!(se.seq || []).length) e[4].push(n + 'pilih minimal satu tahapan Sequence of Teaching.');
    if (!String(se.terminology || '').trim()) e[4].push(n + 'isi Terminology & Trigger Question.');
    if (SCEN.some(s => !String(sc[s.k].desc).trim() || !(+sc[s.k].menit > 0))) e[4].push(n + 'lengkapi Pendahuluan, Inti, dan Penutup beserta durasinya.');
    if (al && scenTotal(sc) > al.menit) e[4].push(n + 'durasi ' + scenTotal(sc) + ' menit melebihi ' + alokText(al) + '.');
  });
  { const miss = uncoveredLos(lp, ch); if (miss.length) e[4].push(`${miss.length} TP belum masuk ke pertemuan mana pun (${miss.slice(0, 6).map(l => l.kode).join(', ')}${miss.length > 6 ? ', …' : ''}). Setiap TP chapter harus diajarkan di minimal satu pertemuan.`); }
  const per = lpPlannedPeriods(lp, ch), target = +ch.jumlah_period || 0;
  if (ses.length && target && per !== target) e[4].push(`Total period semua pertemuan (${per}) harus sama dengan period chapter (${target}).`);
  if (!S.atts.filter(a => a.lp_id === lp.lp_id).length) e[5].push('Unggah minimal satu lampiran pendukung (PDF, DOCX, atau PPTX).');
  if (Object.keys(S.uploads).some(k => S.uploads[k].lp_id === lp.lp_id)) e[5].push('Tunggu unggahan lampiran selesai.');
  return e;
}

function builderHtml() {
  const b = S.builder, lp = b.lp, ch = chapterById(lp.chapter_id) || {}, t = termById(ch.term_id) || activeTerm();
  const errs = b.tried ? validateBuilder(lp) : {};
  const stepState = i => { const v = validateBuilder(lp)[i]; return i === b.step ? 'cur' : (b.tried && v.length ? 'err' : (i < b.step || !v.length ? 'done' : '')); };
  const planned = lpPlannedPeriods(lp, ch), target = +ch.jumlah_period || 0;
  return `
  <div class="builder-top">
    <div class="min-w-0"><div class="eyebrow">${ic('circle-fill', 'fs-xs')} Tahap perencanaan aktif · ${E(unitShort(ch.unit || ''))} ${E(refLabel('SUBJECT', ch.mata_pelajaran || ''))} ${E(gradeLabel(ch.kelas || ''))}</div>
      <h1 style="font-size:1.5rem;font-weight:800;margin-top:4px">Rancangan Modul Ajar · ${E(ch.kode ? ch.kode + ' ' + ch.nama_chapter : 'Chapter')}</h1><div class="fs-sm text-2 mt-1">${(lp.sessions || []).length} pertemuan · ${planned} dari ${target} period chapter</div></div>
    <div class="d-flex align-items-center gap-2 flex-wrap"><span id="bldSave" class="autosave"></span>${pill(lp.status)}<span class="chip gray mono" id="bldKode">${E(lp.kode_dok || 'DRAFT · belum tersinkron')}</span></div>
  </div>
  ${lp.status === 'RETURNED' ? `<div class="notice amber mb-3"><span class="ic">${ic('arrow-counterclockwise')}</span><div class="flex-grow-1"><b>Dikembalikan untuk revisi oleh ${E(lp.reviewer_terakhir || 'pimpinan')}</b><div class="mt-1">“${E(lp.catatan_terakhir || '')}”</div><div class="mt-2 d-flex gap-3 flex-wrap"><button class="link-btn" data-act="bld.annots">${ic('pencil-square')} Lihat coretan & anotasi pada dokumen</button><span class="text-2 fs-sm">Pengajuan ulang akan menjadi revisi ke-${(+lp.revisi_ke || 1) + 1}.</span></div></div></div>` : ''}
  <nav class="steps" aria-label="Langkah penyusunan">${STEPS.map((s, i) => { const n = i + 1, st = stepState(n); return `<button class="step ${st}" data-act="bld.step" data-step="${n}" aria-current="${n === b.step ? 'step' : 'false'}"><span class="c">${st === 'done' ? ic('check-lg') : st === 'err' ? ic('exclamation') : n}</span><span class="t">${n}. ${E(s.t)}</span><span class="s">${st === 'done' ? 'Selesai' : st === 'cur' ? 'Sedang diisi' : st === 'err' ? 'Perlu dilengkapi' : 'Menunggu'}</span></button>`; }).join('')}</nav>
  ${b.tried && errs[b.step] && errs[b.step].length ? `<div class="notice rose mb-3"><span class="ic">${ic('exclamation-triangle-fill')}</span><div><b>${errs[b.step].length} isian wajib belum lengkap pada langkah ini:</b><ul>${errs[b.step].map(x => `<li>${E(x)}</li>`).join('')}</ul></div></div>` : ''}
  <div id="bldStep">${[stepIdentitas, stepTujuan, stepEssential, stepPertemuan, stepLampiran][b.step - 1](lp, ch, t)}</div>
  <div class="sticky-bar bld-bar">
    <button class="btn btn-outline" data-act="bld.preview" aria-label="Pratinjau PDF" title="Pratinjau PDF">${ic('eye')}<span class="hide-mobile">Pratinjau PDF</span></button>
    ${b.step === 5 ? `<button class="btn btn-outline hide-mobile" data-act="bld.pdf">${ic('download')} Unduh Draf PDF</button>` : ''}
    <span class="grow"></span><span class="fs-sm hide-mobile fw-6" id="bldPer" style="color:${planned === target ? 'var(--green)' : 'var(--text-2)'}">${ic('hourglass-split')} ${planned}/${target} period</span>
    <button class="btn btn-ghost" data-act="bld.exit" aria-label="Batal dan kembali" title="Batal & kembali">${ic('x-lg')}<span class="hide-mobile">Batal &amp; Kembali</span></button>
    <button class="btn btn-soft" data-act="bld.save" aria-label="Simpan draft" title="Simpan draft">${ic('floppy')}<span class="hide-mobile">Simpan Draft</span></button>
    ${b.step < 5 ? `<button class="btn btn-primary" data-act="bld.step" data-step="${b.step + 1}"><span class="hide-mobile">Lanjut: ${E(STEPS[b.step].t)}</span><span class="show-mobile">Lanjut</span> ${ic('arrow-right')}</button>` : `<button class="btn btn-primary" data-act="bld.submit">${ic('send')}<span class="hide-mobile">Simpan & Kirim ke Pimpinan</span><span class="show-mobile">Kirim ke Pimpinan</span></button>`}
  </div>`;
}
function bldRerender() { const y = window.scrollY; const el = $('#bld'); if (!el || !S.builder) return; el.innerHTML = builderHtml(); window.scrollTo(0, y); paintAutosave(); if (!$('#bld .notice.rose') && !$('#bld .field-err')) dismissToast('val'); }

function stepIdentitas(lp, ch, t) {
  const rows = chaptersForLp(t.term_id, lp.lp_id);
  const bud = ch.chapter_id ? termBudget(t, ch.unit, ch.mata_pelajaran, ch.kelas) : null;
  const losBySub = sid => activeLos(ch).filter(l => l.sub_id === sid);
  return `<section class="bld-card">
    <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="sec-num">1</span><div><h3>Pilih Chapter</h3><div class="sub">Satu lesson plan disusun untuk satu chapter dan berisi beberapa pertemuan.</div></div></div>
      ${ch.chapter_id ? `<button class="btn btn-soft btn-sm" data-go="chapter-form" data-p-id="${E(lp.chapter_id)}">${ic('pencil-square')} Ubah Analisis Chapter</button>` : ''}</div>
    <div class="tree" role="radiogroup" aria-label="Pilih chapter">${rows.map(({ c, other }) => { const on = c.chapter_id === lp.chapter_id; return `<div class="tree-ch">
      <div class="tree-row ${on ? 'on' : ''} ${other ? 'disabled' : ''}" ${other ? '' : `data-act="bld.chapter" data-id="${E(c.chapter_id)}"`} role="radio" aria-checked="${on}" aria-disabled="${!!other}" tabindex="${other ? -1 : 0}"><input type="radio" class="form-check-input m-0" tabindex="-1" ${on ? 'checked' : ''} ${other ? 'disabled' : ''} aria-hidden="true">${ic('folder2-open', 'text-2')}<b class="flex-grow-1 clamp-1">${E(c.kode)} · ${E(c.nama_chapter)}</b>
        <span class="fs-xs text-2 text-nowrap">${+c.jumlah_period || 0} period · ${activeSubs(c).length} sub-bab · ${activeLos(c).length} TP</span>${other ? `<button class="btn btn-soft btn-sm ms-2" data-go="${isEditable(other) ? 'builder' : 'lp-view'}" data-p-id="${E(other.lp_id)}">Sudah ada LP ${ic('arrow-right')}</button>` : ''}</div></div>`; }).join('')}</div>
  </section>
  ${ch.chapter_id ? `<section class="bld-card">
    <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="icon-tile sm">${ic('journal-bookmark')}</span><div><h3>${E(ch.kode)} · ${E(ch.nama_chapter)}</h3><div class="sub">${E(refLabel('SUBJECT', ch.mata_pelajaran))} · ${E(gradeLabel(ch.kelas))} · ${E(termLabel(t))}</div></div></div>
      <div class="text-end"><div class="fw-8" style="font-size:1.4rem;color:var(--primary-strong)">${+ch.jumlah_period || 0} period</div><div class="fs-xs text-2">${bud && bud.total ? 'dari anggaran term ' + bud.total + ' period' : 'period chapter'}</div></div></div>
    <div class="fs-xs fw-7 text-3 mb-2" style="letter-spacing:.08em">SUB-BAB / TOPIK & TP</div>
    <div class="d-grid gap-2">${activeSubs(ch).map(sb => { const ls = losBySub(sb.sub_id); return `<div class="tree-sub on" style="cursor:default"><span class="chip">${E(sb.kode)}</span><div class="min-w-0 flex-grow-1"><div class="fw-6">${E(sb.nama_sub)}</div><div class="fs-xs text-2">${ls.length ? ls.map(l => E(l.kode)).join(', ') : '<span style="color:var(--amber-ink)">Belum ada TP</span>'}</div></div></div>`; }).join('')}</div>
    <div class="fs-sm text-2 mt-3">${ic('info-circle')} Pertemuan, topik per pertemuan, dan alokasi 1P/2P disusun di langkah 4. Total period semua pertemuan harus ${+ch.jumlah_period || 0}.</div>
  </section>` : ''}`;
}

function stepTujuan(lp, ch) {
  const los = activeLos(ch), subs = activeSubs(ch), noSub = los.filter(l => !subs.some(s => s.sub_id === l.sub_id));
  const loRow = l => `<div class="lo-row on" style="cursor:default"><span class="k chip">${E(l.kode)}</span><div class="tx flex-grow-1">${sanitizeRich(l.teks_tp)}<div class="fs-xs text-3 mt-1">${E(l.ranah || '')}${l.taksonomi ? ' · ' + E(l.taksonomi) : ''}</div></div></div>`;
  return `<section class="bld-card">
    <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="sec-num">2</span><div><h3>Tujuan Pembelajaran chapter</h3><div class="sub">Seluruh TP chapter ${E(ch.kode || '')} dikelompokkan per sub-bab. Pada langkah 4, tiap pertemuan memilih TP yang diajarkan, lalu mengisi Learning Indicator, ICM Value, Sequence, dan Diferensiasi.</div></div></div><span class="chip sky">${ic('arrow-repeat')} ${los.length} TP dari Analisis Chapter</span></div>
    ${los.length ? subs.map(sb => { const ls = los.filter(l => l.sub_id === sb.sub_id); return `<div class="mb-3"><div class="fs-sm fw-7 mb-1" style="color:var(--primary-strong)">${E(sb.kode)} · ${E(sb.nama_sub)}</div>${ls.length ? ls.map(loRow).join('') : `<div class="fs-sm text-2 ps-1">Belum ada TP untuk sub-bab ini.</div>`}</div>`; }).join('') + (noSub.length ? `<div class="mb-3"><div class="fs-sm fw-7 mb-1 text-2">Tanpa sub-bab</div>${noSub.map(loRow).join('')}</div>` : '')
      : `<div class="notice amber">${ic('info-circle')} Chapter ini belum memiliki TP. <button class="link-btn" data-go="chapter-form" data-p-id="${E(ch.chapter_id)}">Tambahkan TP</button></div>`}
  </section>`;
}

function stepEssential(lp) {
  return `<div class="mb-3"><div class="eyebrow">Langkah 3</div><h2 style="font-size:1.35rem;font-weight:800;margin-top:4px">Pertanyaan Esensial</h2><div class="text-2 fs-md">Satu Essential Question untuk seluruh bab. Terminology & Trigger Question, Learning Indicator, ICM Value, Sequence of Teaching, dan Diferensiasi diisi per pertemuan di langkah 4.</div></div>
  <section class="bld-card"><div class="d-flex gap-3 align-items-center mb-2"><span class="icon-tile sm amber">${ic('question-lg')}</span><div><b>Essential Question <span style="color:var(--rose)">*</span></b><div class="fs-xs text-2">Pertanyaan esensial bab ini — memantik rasa ingin tahu peserta didik</div></div></div>
    <textarea class="form-control" rows="5" maxlength="4000" data-b="essential_question" placeholder="Contoh: Mengapa hidrogen peroksida yang beracun dapat diuraikan oleh enzim katalase?">${E(lp.essential_question)}</textarea><div class="text-end counter mt-1" data-cnt="essential_question">${String(lp.essential_question).length} karakter</div></section>`;
}

function sesStripHtml(se, ch) {
  const sc = se.scenarios, total = scenTotal(sc), al = sesAlok(se, ch.unit), alok = al ? al.menit : 0, over = alok && total > alok, under = alok && total < alok;
  const w = k => (total ? (+sc[k].menit / total) * 100 : 33.3);
  const chip = over ? `<span class="chip amber">${ic('exclamation-triangle')} Lebih ${total - alok} menit</span>` : under ? `<span class="chip sky">${ic('hourglass-split')} Sisa ${alok - total} menit</span>` : `<span class="chip green">${ic('check-circle')} Pas ${alok} menit</span>`;
  return `<div class="dur-strip ${over ? 'warn' : ''}"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2"><b>${ic('stopwatch')} ${total} dari ${alok} menit</b><div class="d-flex align-items-center gap-2 flex-wrap">${chip}${over || under ? `<button class="btn btn-soft btn-sm" data-act="bld.sesFit" data-i="${E(se.id)}">${ic('magic')} Sesuaikan ke ${alok} menit</button>` : ''}</div></div>
    <div class="dur-bar"><span style="width:${w('beginning')}%;background:var(--sky)"></span><span style="width:${w('middle')}%;background:var(--primary)"></span><span style="width:${w('end')}%;background:var(--amber)"></span></div>
    <div class="dur-legend"><span><span class="dot sky"></span> Pendahuluan ${sc.beginning.menit}m</span><span><span class="dot"></span> Inti ${sc.middle.menit}m</span><span><span class="dot amber"></span> Penutup ${sc.end.menit}m</span></div></div>`;
}
function sesSummaryHtml(lp, ch) {
  const ses = lp.sessions || [], per = lpPlannedPeriods(lp, ch), target = +ch.jumlah_period || 0, diff = target - per, pp = target ? Math.min(100, Math.round(pct(per, target))) : 0;
  const opts = periodOpts(ch.unit);
  return `<div class="d-flex flex-wrap gap-3 justify-content-between align-items-center"><div style="flex:1 1 260px"><b style="font-size:1.05rem">${per} dari ${target} period terencana</b> <span class="text-2 fs-sm">· ${ses.length} pertemuan · ${lpTotalMin(lp)} menit</span>
      <div class="bar-mini mt-2 ${diff === 0 ? 'green' : diff < 0 ? 'rose' : ''}" style="height:8px"><span style="width:${pp}%"></span></div>
      <div class="fs-sm mt-1" style="color:${diff === 0 ? 'var(--green)' : diff < 0 ? 'var(--rose)' : 'var(--amber-ink)'}">${diff === 0 ? ic('check-circle') + ' Total period sudah sama dengan period chapter.' : diff > 0 ? ic('hourglass-split') + ' Kurang ' + diff + ' period — tambahkan pertemuan atau ubah 1P menjadi 2P.' : ic('exclamation-triangle') + ' Lebih ' + (-diff) + ' period — hapus pertemuan atau ubah 2P menjadi 1P.'}</div></div>
    ${(() => { const miss = uncoveredLos(lp, ch), tot = activeLos(ch).length; return `<div class="w-100 fs-sm" style="color:${miss.length ? 'var(--rose)' : 'var(--green)'}">${miss.length ? ic('exclamation-triangle') + ' ' + miss.length + ' dari ' + tot + ' TP belum masuk ke pertemuan mana pun: ' + E(miss.slice(0, 8).map(l => l.kode).join(', ')) + (miss.length > 8 ? ', …' : '') : ic('check-circle') + ' Semua ' + tot + ' TP chapter sudah terpetakan ke pertemuan.'}</div>`; })()}
    <div class="d-flex gap-2 flex-wrap">${opts.map(o => `<button class="btn btn-outline btn-sm" data-act="bld.sesAdd" data-k="${E(o.kode)}">${ic('plus-lg')} Pertemuan ${E(o.label)}</button>`).join('')}<button class="btn btn-soft btn-sm" data-act="bld.sesAuto" title="Susun ulang pertemuan otomatis dari period chapter">${ic('magic')} Susun otomatis</button></div></div>`;
}
/** Matriks diferensiasi 3×3 per pertemuan (opsional; satu pilihan saja bila aturan SATU). */
function sesDiffHtml(se, i) {
  const A = refsOf('DIFF_ASPECT'), P = refsOf('DIFF_PROFILE'), one = diffMode() === 'SATU', cur = se.diff || [];
  return `<div class="mb-3"><div class="fs-xs fw-7 text-3 mb-1" style="letter-spacing:.06em">DIFERENSIASI <span class="fw-6" style="letter-spacing:0;text-transform:none">· opsional · ${one ? 'pilih satu dari 9 kotak' : 'satu pilihan per baris'}</span></div>
    <div class="sdiff"><div class="sd-h"></div>${P.map(p => `<div class="sd-h" title="${E(p.deskripsi || '')}">${E(p.label)}</div>`).join('')}
      ${A.map(a => `<div class="sd-r" title="${E(a.deskripsi || '')}">${E(a.label)}</div>${P.map(p => { const on = cur.some(d => d.a === a.kode && d.p === p.kode); return `<button type="button" role="checkbox" aria-checked="${on}" class="sd-c ${on ? 'on' : ''}" data-act="bld.sesDiff" data-i="${i}" data-a="${E(a.kode)}" data-p="${E(p.kode)}" aria-label="${E(a.label)} × ${E(p.label)}">${on ? ic('check-lg') : ''}</button>`; }).join('')}`).join('')}</div>
    ${cur.map(d => { const a = A.find(x => x.kode === d.a), p = P.find(x => x.kode === d.p); return `<div class="d-flex align-items-center gap-2 mt-2"><span class="chip sky">${E(a ? a.label : d.a)} · ${E(p ? p.label : d.p)}</span><input class="form-control form-control-sm" data-sdiffnote="${i}|${E(d.a)}|${E(d.p)}" value="${E(d.note || '')}" placeholder="Strategi (mis. LKPD bertingkat)" maxlength="140" aria-label="Strategi diferensiasi"></div>`; }).join('')}</div>`;
}
/** Learning Indicator (Micro TP) = TP terpilih di pertemuan ini + indikator manual tambahan. */
function sesIndList(se, ch) {
  return activeLos(ch).filter(l => (se.lo_ids || []).indexOf(l.lo_id) >= 0).map(l => stripTags(l.teks_tp).replace(/\s+/g, ' ').trim()).concat((se.indikator_manual || []).map(x => String(x || '').trim()).filter(Boolean));
}
function sesIndHtml(se, i, ch) {
  const los = activeLos(ch).filter(l => (se.lo_ids || []).indexOf(l.lo_id) >= 0), man = se.indikator_manual || [];
  return `<div class="mb-3"><div class="fs-xs fw-7 text-3 mb-1" style="letter-spacing:.06em">LEARNING INDICATOR (MICRO TP) <span class="fw-6" style="letter-spacing:0;text-transform:none">· otomatis dari TP terpilih, bisa ditambah manual</span></div>
    <div class="ind-list">${los.length ? los.map(l => `<div class="ind-row"><span class="chip sky mono">${E(l.kode)}</span><span class="min-w-0">${E(stripTags(l.teks_tp))}</span></div>`).join('') : `<div class="fs-sm text-2 p-2">Centang TP di atas — Micro TP pertemuan ini terisi otomatis.</div>`}
      ${man.map((t, j) => `<div class="ind-row manual"><span class="chip amber">Manual</span><input class="form-control form-control-sm" maxlength="500" data-b="sessions.${i}.indikator_manual.${j}" value="${E(t)}" placeholder="Tuliskan indikator tambahan di luar TP chapter" aria-label="Indikator manual ${j + 1} pertemuan ${i + 1}"><button type="button" class="btn-icon" data-act="bld.indDel" data-i="${i}" data-j="${j}" aria-label="Hapus indikator manual" title="Hapus">${ic('x-lg')}</button></div>`).join('')}</div>
    <button type="button" class="btn btn-soft btn-sm mt-2" data-act="bld.indAdd" data-i="${i}">${ic('plus-lg')} Tambah indikator manual</button></div>`;
}
function sesCardHtml(se, i, lp, ch) {
  const b = S.builder, open = b.open === i, al = sesAlok(se, ch.unit), subs = activeSubs(ch), n = (lp.sessions || []).length;
  const durs = refsOf('DURATION'), topik = subs.filter(x => (se.sub_ids || []).indexOf(x.sub_id) >= 0);
  const ok = al && topik.length && (se.icm || []).length && (se.seq || []).length && String(se.terminology || '').trim() && SCEN.every(s => String(se.scenarios[s.k].desc).trim() && +se.scenarios[s.k].menit > 0) && scenTotal(se.scenarios) <= al.menit;
  return `<section class="ses-card ${open ? 'open' : ''}" id="ses-${E(se.id)}">
    <div class="ses-head">
      <button class="ses-toggle" data-act="bld.sesOpen" data-i="${i}" aria-expanded="${open}"><span class="ses-no ${ok ? 'ok' : ''}">${ok ? ic('check-lg') : i + 1}</span><span class="min-w-0 text-start"><b class="d-block">Pertemuan ${i + 1} <span class="chip ms-1">${E(al ? al.label : '—')}</span>${se.tanggal ? ` <span class="fs-xs text-2 fw-6">${E(fmtTanggal(se.tanggal))}</span>` : ''}</b><span class="fs-xs text-2 clamp-1">${topik.length ? E(topik.map(x => x.kode + ' ' + x.nama_sub).join(' · ')) : 'Topik belum dipilih'}</span></span>${ic(open ? 'chevron-up' : 'chevron-down', 'ms-auto text-3')}</button>
      <div class="ses-tools"><button class="btn-icon" data-act="bld.sesMove" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan" title="Naikkan">${ic('arrow-up')}</button><button class="btn-icon" data-act="bld.sesMove" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Turunkan" title="Turunkan">${ic('arrow-down')}</button><button class="btn-icon" data-act="bld.sesDup" data-i="${i}" aria-label="Duplikat pertemuan" title="Duplikat">${ic('copy')}</button><button class="btn-icon danger" data-act="bld.sesDel" data-i="${i}" aria-label="Hapus pertemuan" title="Hapus">${ic('trash3')}</button></div>
    </div>
    ${open ? `<div class="ses-body">
      <div class="row g-3 mb-2">
        <div class="col-lg-7"><div class="fs-xs fw-7 text-3 mb-1" style="letter-spacing:.06em">ALOKASI PERIOD <span style="color:var(--rose)">*</span></div><div class="period-pick" role="radiogroup" aria-label="Alokasi period pertemuan ${i + 1}">${periodOpts(ch.unit).map(o => `<button type="button" role="radio" aria-checked="${al && al.kode === o.kode}" class="${al && al.kode === o.kode ? 'on' : ''}" data-act="bld.sesAlok" data-i="${i}" data-k="${E(o.kode)}"><b>${E(o.label)}</b><span>${o.menit} menit</span></button>`).join('')}</div></div>
        <div class="col-lg-5"><label class="fs-xs fw-7 text-3 mb-1 d-block" style="letter-spacing:.06em" for="sesTgl${i}">TANGGAL (OPSIONAL)</label><input id="sesTgl${i}" type="date" class="form-control" data-b="sessions.${i}.tanggal" value="${E(se.tanggal || '')}"></div>
      </div>
      <div class="fs-xs fw-7 text-3 mb-1" style="letter-spacing:.06em">TP YANG DIAJARKAN DI PERTEMUAN INI <span style="color:var(--rose)">*</span> <span class="fw-6" style="letter-spacing:0;text-transform:none">· sub-bab mengikuti otomatis</span></div>
      <div class="tp-pick mb-3">${subs.map(sb => { const ls = activeLos(ch).filter(l => l.sub_id === sb.sub_id); if (!ls.length) return ''; const nOn = ls.filter(l => (se.lo_ids || []).indexOf(l.lo_id) >= 0).length;
        return `<div class="tp-grp"><div class="tp-grp-h"><b>${E(sb.kode)} ${E(sb.nama_sub)}</b><span class="chip ${nOn ? 'sky' : ''}">${nOn}/${ls.length} TP</span><button class="link-btn" data-act="bld.sesLoSub" data-i="${i}" data-id="${E(sb.sub_id)}">${nOn === ls.length ? 'Kosongkan' : 'Pilih semua'}</button></div>
        ${ls.map(l => { const on = (se.lo_ids || []).indexOf(l.lo_id) >= 0; return `<button type="button" role="checkbox" aria-checked="${on}" class="tp-opt ${on ? 'on' : ''}" data-act="bld.sesLo" data-i="${i}" data-id="${E(l.lo_id)}"><span class="ck">${on ? ic('check-lg') : ''}</span><span class="min-w-0"><b>${E(l.kode)}</b> ${E(stripTags(l.teks_tp).slice(0, 140))}</span></button>`; }).join('')}</div>`; }).join('')}</div>
      ${sesIndHtml(se, i, ch)}
      <div class="row g-3 mb-3">
        <div class="col-lg-6"><div class="fs-xs fw-7 text-3 mb-1" style="letter-spacing:.06em">ICM VALUE <span style="color:var(--rose)">*</span> <span class="fw-6" style="letter-spacing:0;text-transform:none">· minimal satu</span></div>
          <div class="chipcards">${refsOf('ICM_VALUE').map(r => { const on = (se.icm || []).indexOf(r.kode) >= 0; return `<button class="chipcard sm ${on ? 'on' : ''}" data-act="bld.sesIcm" data-i="${i}" data-k="${E(r.kode)}" aria-pressed="${on}">${ic(on ? 'check-circle-fill' : 'plus-circle')} ${E(r.label)}</button>`; }).join('')}</div></div>
        <div class="col-lg-6"><div class="fs-xs fw-7 text-3 mb-1" style="letter-spacing:.06em">SEQUENCE OF TEACHING <span style="color:var(--rose)">*</span> <span class="fw-6" style="letter-spacing:0;text-transform:none">· minimal satu, nomor mengikuti urutan memilih</span></div>
          <div class="chipcards">${refsOf('SEQUENCE').map(r => { const idx = (se.seq || []).indexOf(r.kode); return `<button class="chipcard sm ${idx >= 0 ? 'on' : ''}" data-act="bld.sesSeq" data-i="${i}" data-k="${E(r.kode)}" aria-pressed="${idx >= 0}">${idx >= 0 ? `<span class="code-chip" style="min-width:20px;height:20px;font-size:.7rem">${idx + 1}</span>` : ic('plus-circle')} ${E(r.label)}</button>`; }).join('')}</div></div>
      </div>
      <div class="mb-3"><label class="fs-xs fw-7 text-3 mb-1 d-block" style="letter-spacing:.06em" for="sesTerm${i}">TERMINOLOGY & TRIGGER QUESTION <span style="color:var(--rose)">*</span></label>
        <div class="fs-xs text-2 mb-1">Istilah kunci yang dikenalkan dan pertanyaan pemantik khusus pertemuan ini.</div>
        <textarea id="sesTerm${i}" class="form-control" rows="3" maxlength="4000" data-b="sessions.${i}.terminology" placeholder="Istilah: katalase, substrat, sisi aktif…&#10;Pertanyaan pemantik: Apa yang terjadi bila suhu dinaikkan?">${E(se.terminology || '')}</textarea></div>
      ${sesDiffHtml(se, i)}
      ${SCEN.map(s => { const v = se.scenarios[s.k]; return `<section class="scen ${s.key}"><div class="scen-head"><span class="scen-tile">${s.key}</span><div class="min-w-0"><b>${E(s.t)}</b><div class="fs-xs text-2">${E(s.s)}</div></div>
        <select class="form-select" data-b="sessions.${i}.scenarios.${s.k}.menit" data-num="1" aria-label="Durasi ${E(s.t)} pertemuan ${i + 1}">${(durs.some(d => +d.kode === +v.menit) ? durs : durs.concat([{ kode: String(v.menit), label: v.menit + ' Menit' }])).map(d => `<option value="${E(d.kode)}" ${+d.kode === +v.menit ? 'selected' : ''}>${E(d.label)}</option>`).join('')}</select></div>
        <textarea class="form-control" rows="3" maxlength="4000" data-b="sessions.${i}.scenarios.${s.k}.desc" placeholder="${E(s.ph)}" aria-label="Uraian ${E(s.t)} pertemuan ${i + 1}">${E(v.desc)}</textarea></section>`; }).join('')}
      <div id="sesStrip-${E(se.id)}">${sesStripHtml(se, ch)}</div>
    </div>` : ''}
  </section>`;
}
function stepPertemuan(lp, ch) {
  const ses = lp.sessions || [];
  return `<div class="mb-3"><div class="eyebrow">Rencana pertemuan · ${E(refLabel('SUBJECT', ch.mata_pelajaran || ''))} ${E(gradeLabel(ch.kelas || ''))} · ${E(ch.nama_chapter || '')}</div><h2 style="font-size:1.35rem;font-weight:800;margin-top:4px">Pertemuan & Skenario Pembelajaran</h2><div class="text-2 fs-md">Setiap pertemuan berdurasi 1 atau 2 period dan memiliki Pendahuluan, Inti, dan Penutup. Total period semua pertemuan harus sama dengan period chapter.</div></div>
  <section class="bld-card" id="sesSum">${sesSummaryHtml(lp, ch)}</section>
  ${ses.length ? ses.map((se, i) => sesCardHtml(se, i, lp, ch)).join('') : emptyState('calendar-plus', 'Belum ada pertemuan', 'Klik "Susun otomatis" untuk membuat pertemuan dari period chapter, atau tambahkan satu per satu.', '')}`;
}

function stepLampiran(lp, ch, t) {
  const atts = S.atts.filter(a => a.lp_id === lp.lp_id), ups = Object.keys(S.uploads).map(k => S.uploads[k]).filter(u => u.lp_id === lp.lp_id);
  const leaders = Object.keys(S.people).map(k => S.people[k]).filter(p => p.r === 'LEADER' && String(p.u).split(',').indexOf(ch.unit) >= 0);
  const v = validateBuilder(lp), allErr = [1, 2, 3, 4, 5].reduce((a, i) => a.concat(v[i].map(x => ({ i, x }))), []);
  const fname = `${safeName(lp.kode_dok || 'LP-' + (ch.kode || ''))}_${safeName(ch.nama_chapter)}_<<Timestamp>>.pdf`;
  return `<section class="bld-card">
    <div class="card-head"><div><h3>Lampiran Pembelajaran & Media Ajar</h3><div class="sub">Sertakan LKPD, slide paparan, dan instrumen rubrik penilaian.</div></div><span class="chip">${atts.length} Berkas Terunggah</span></div>
    <div class="dropzone" data-act="bld.pick" id="dropZone" role="button" tabindex="0" aria-label="Unggah lampiran"><div class="ill">${ic('cloud-arrow-up')}</div><b>Seret berkas ke sini atau klik untuk memilih</b><div class="fs-sm text-2">Format PDF, DOCX, PPTX · maksimal 10 MB per dokumen</div></div>
    <div class="mt-3">${ups.map(u => `<div class="file-row"><span class="file-ic ${E(u.ext)}">${ic('file-earmark-arrow-up')}</span><div class="flex-grow-1 min-w-0"><div class="nm clamp-1">${E(u.name)}</div><div class="mt">${fmtSize(u.size)} · Mengunggah…</div><div class="prog"><span></span></div></div></div>`).join('')}
      ${atts.map(a => `<div class="file-row"><span class="file-ic ${E(a.tipe)}">${ic(a.tipe === 'pdf' ? 'filetype-pdf' : a.tipe === 'docx' ? 'filetype-docx' : 'filetype-pptx')}</span><div class="flex-grow-1 min-w-0"><div class="nm clamp-1">${E(a.nama_file)}</div><div class="mt">${fmtSize(a.ukuran)} · Diunggah ${E(relTime(a.diunggah_pada))}</div></div><button class="btn-icon" data-act="att.preview" data-id="${E(a.att_id)}" aria-label="Pratinjau">${ic('eye')}</button><button class="btn-icon danger" data-act="att.del" data-id="${E(a.att_id)}" aria-label="Hapus lampiran">${ic('trash3')}</button></div>`).join('')}</div>
  </section>
  ${allErr.length ? `<div class="notice rose mb-3"><span class="ic">${ic('exclamation-triangle-fill')}</span><div><b>${allErr.length} data wajib belum lengkap sebelum dapat diajukan ke pimpinan:</b><ul>${allErr.map(e => `<li><button class="link-btn" data-act="bld.step" data-step="${e.i}">${E(e.x)} ${ic('arrow-right')}</button></li>`).join('')}</ul></div></div>` : `<div class="notice green mb-3"><span class="ic">${ic('check-circle-fill')}</span><div><b>Semua isian wajib lengkap.</b> Dokumen siap diajukan ke pimpinan.</div></div>`}
  <section class="confirm-card mb-2"><div class="hd"><span class="icon-tile sm">${ic('clipboard-check')}</span><div><b>Konfirmasi Pengajuan Lesson Plan ke Pimpinan</b><div class="fs-xs text-2">Pastikan parameter dokumen sudah sesuai standar baku sekolah.</div></div></div>
    <div class="p-3"><div class="kv-grid">
      <div class="kv"><div class="k">Chapter & Pertemuan</div><div class="v">${E((ch.kode ? ch.kode + ' · ' : '') + (ch.nama_chapter || '—'))} · ${(lp.sessions || []).length} pertemuan · ${lpPlannedPeriods(lp, ch)} period</div></div>
      <div class="kv"><div class="k">Guru Pengampu</div><div class="v">${E(S.me.nama)} (NIP ${E(S.me.nip || '—')})</div></div>
      <div class="kv"><div class="k">Target Reviewer</div><div class="v">${E(leaders.map(l => l.n).join(', ') || 'Pimpinan unit ' + unitShort(ch.unit))}</div></div>
      <div class="kv"><div class="k">Berkas Terlampir</div><div class="v">${atts.length} berkas</div></div>
    </div><div class="kv mt-2"><div class="k">${ic('file-earmark-pdf')} Standarisasi tata nama berkas</div><div class="v mono" style="color:var(--primary-strong)">${E(fname)}</div></div>
    <div class="d-flex justify-content-end gap-2 mt-3 flex-wrap"><button class="btn btn-outline" data-act="bld.step" data-step="1">Periksa Kembali</button><button class="btn btn-primary" data-act="bld.submit">${ic('send')} Ya, Kirim ke Pimpinan</button></div></div></section>`;
}
function safeName(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'NA'; }

/** Binding input builder: data-b="jalur.properti" */
document.addEventListener('input', e => {
  const b = S.builder; if (!b || !b.lp) return;
  const el = e.target;
  if (el.dataset.b) {
    const path = el.dataset.b.split('.'); let o = b.lp;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = el.dataset.num ? +el.value : el.value;
    const cnt = $(`[data-cnt="${path[path.length - 1]}"]`);
    if (cnt) cnt.textContent = el.value.length + (path[path.length - 1] === 'atp_micro_lo' ? '/4000' : ' karakter');
    if (path[0] === 'sessions' && path[path.length - 1] === 'menit') { const ch = chapterById(b.lp.chapter_id) || {}, se = b.lp.sessions[+path[1]]; const st = se && $('#sesStrip-' + se.id); if (st) st.innerHTML = sesStripHtml(se, ch); }
    markDirty();
  } else if (el.dataset.sdiffnote) {
    const [si, a, p] = el.dataset.sdiffnote.split('|'), se = b.lp.sessions[+si], d = se && (se.diff || []).find(x => x.a === a && x.p === p);
    if (d) { d.note = el.value; markDirty(); }
  }
});
document.addEventListener('click', e => { if (e.target.closest('[data-sdiffnote]')) e.stopPropagation(); }, true);
document.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && e.target.matches('[role=checkbox][data-act], [role=radio][data-act], .dropzone')) { e.preventDefault(); e.target.click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.builder && S.builder.lp) { e.preventDefault(); ACT['bld.save'](); }
});

const toggleIn = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
Object.assign(ACT, {
  'bld.step': el => { const b = S.builder, n = +el.dataset.step; if (!b || n < 1 || n > 5) return; builderFlush(); b.step = n; bldRerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'bld.chapter': el => {
    const b = S.builder, lp = b.lp; if (lp.chapter_id === el.dataset.id) return;
    const typed = (lp.sessions || []).some(se => SCEN.some(x => String(se.scenarios[x.k].desc).trim()));
    lp.chapter_id = el.dataset.id;
    const ch = chapterById(lp.chapter_id) || {};
    if (!typed) lp.sessions = genSessions(ch); else lp.sessions.forEach(se => syncSesSubs(se, ch));
    b.open = 0; markDirty(); bldRerender();
  },
  'bld.sesIcm': el => { const se = S.builder.lp.sessions[+el.dataset.i]; if (!se) return; se.icm = se.icm || []; toggleIn(se.icm, el.dataset.k); markDirty(); bldRerender(); },
  'bld.sesSeq': el => { const se = S.builder.lp.sessions[+el.dataset.i]; if (!se) return; se.seq = se.seq || []; toggleIn(se.seq, el.dataset.k); markDirty(); bldRerender(); },
  'bld.sesDiff': el => {
    const se = S.builder.lp.sessions[+el.dataset.i]; if (!se) return;
    const a = el.dataset.a, p = el.dataset.p; se.diff = se.diff || [];
    const k = se.diff.findIndex(d => d.a === a && d.p === p);
    if (k >= 0) se.diff.splice(k, 1);
    else {
      // Aturan: satu pilihan di seluruh matriks (SATU) atau satu per baris (BARIS) — pilihan lama diganti
      const keepNote = (se.diff.find(d => d.a === a) || {}).note || '';
      se.diff = diffMode() === 'SATU' ? [] : se.diff.filter(d => d.a !== a);
      se.diff.push({ a, p, note: keepNote });
    }
    markDirty(); bldRerender();
    if (k < 0) { const n = $(`[data-sdiffnote="${+el.dataset.i}|${a}|${p}"]`); n && n.focus(); }
  },
  'bld.indAdd': el => { const se = S.builder.lp.sessions[+el.dataset.i]; if (!se) return; se.indikator_manual = se.indikator_manual || []; if (se.indikator_manual.length >= 20) { toast('warning', 'Maksimal 20 indikator manual', ''); return; } se.indikator_manual.push(''); markDirty(); bldRerender(); const f = $$(`[data-b="sessions.${+el.dataset.i}.indikator_manual.${se.indikator_manual.length - 1}"]`)[0]; f && f.focus(); },
  'bld.indDel': el => { const se = S.builder.lp.sessions[+el.dataset.i]; if (!se) return; (se.indikator_manual || []).splice(+el.dataset.j, 1); markDirty(); bldRerender(); },
  'bld.save': () => { const b = S.builder; if (!b) return; b.dirty = true; LS.set('draft:' + b.lp.lp_id, { lp: b.lp, at: Date.now() }); builderFlush(); toast('success', 'Draft disimpan', 'Tersimpan di perangkat dan sedang dikirim ke server.'); },
  'bld.exit': () => { builderFlush(); back('lps'); },
  'bld.preview': () => openDocPreview(builderDocData()),
  'bld.annots': () => {
    const lp = S.builder.lp, d = S.detail[lp.lp_id];
    const show = det => { const last = (det.approvals || []).filter(a => a.keputusan === 'RETURNED').pop(); openDocPreview(builderDocData(), last ? last.annotations : [], last); };
    if (d) show(d); else { toast('info', 'Memuat anotasi pimpinan…', ''); call('lp.get', { lp_id: lp.lp_id }).then(x => { S.detail[lp.lp_id] = x; show(x); }).catch(e => toast('error', 'Gagal memuat', e.message)); }
  },
  'bld.pdf': el => {
    const b = S.builder; if (!b) return;
    b.dirty = true; builderFlush();
    setBtnBusy(el, true, 'Menyiapkan…');
    const id = b.lp.lp_id, t0 = Date.now();
    const wait = () => { if (Outbox.has('lp:' + id) && Date.now() - t0 < 25000) { setTimeout(wait, 400); return; }
      call('lp.pdf', { lp_id: id, mode: 'draft' }).then(r => { downloadBlob(b64ToBlob(r.b64, r.mime), r.name); toast('success', 'Draf PDF terunduh', r.name); }).catch(e => toast('error', 'Gagal membuat PDF', e.message)).finally(() => setBtnBusy(el, false)); };
    wait();
  },
  'bld.pick': () => pickFile('.pdf,.docx,.pptx').then(f => f && uploadAttachment(f)),
  'att.del': async el => {
    const a = S.atts.find(x => x.att_id === el.dataset.id); if (!a) return;
    if (!(await confirmDlg({ title: 'Hapus lampiran?', message: E(a.nama_file), ok: 'Hapus', tone: 'danger', icon: 'trash3', iconTone: 'rose' }))) return;
    S.atts = S.atts.filter(x => x.att_id !== a.att_id); persist(); bldRerender();
    Outbox.push('file.delete', { att_id: a.att_id }, { key: 'att:' + a.att_id, prev: a });
  },
  'att.preview': el => previewAttachment(el.dataset.id),
  'bld.sesOpen': el => { const b = S.builder, i = +el.dataset.i; b.open = b.open === i ? -1 : i; bldRerender(); const c = $$('.ses-card')[i]; if (c && b.open === i) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'bld.sesAdd': el => { const b = S.builder, ch = chapterById(b.lp.chapter_id) || {}; const se = newSession(ch, el.dataset.k); b.lp.sessions.push(se); b.open = b.lp.sessions.length - 1; markDirty(); bldRerender(); const c = $$('.ses-card')[b.open]; c && c.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'bld.sesDup': el => { const b = S.builder, i = +el.dataset.i, src = b.lp.sessions[i]; if (!src) return; const cp = clone(src); cp.id = uid(); cp.tanggal = ''; b.lp.sessions.splice(i + 1, 0, cp); b.open = i + 1; markDirty(); bldRerender(); },
  'bld.sesDel': async el => {
    const b = S.builder, i = +el.dataset.i, se = b.lp.sessions[i]; if (!se) return;
    if (SCEN.some(x => String(se.scenarios[x.k].desc).trim()) && !(await confirmDlg({ title: 'Hapus pertemuan ' + (i + 1) + '?', message: 'Skenario yang sudah ditulis pada pertemuan ini akan dihapus.', ok: 'Hapus', tone: 'danger', icon: 'trash3', iconTone: 'rose' }))) return;
    b.lp.sessions.splice(i, 1); b.open = Math.min(b.open, b.lp.sessions.length - 1); markDirty(); bldRerender();
  },
  'bld.sesMove': el => { const a = S.builder.lp.sessions, i = +el.dataset.i, j = i + (+el.dataset.d); if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; if (S.builder.open === i) S.builder.open = j; else if (S.builder.open === j) S.builder.open = i; markDirty(); bldRerender(); },
  'bld.sesLo': el => { const se = S.builder.lp.sessions[+el.dataset.i]; if (!se) return; se.lo_ids = se.lo_ids || []; toggleIn(se.lo_ids, el.dataset.id); syncSesSubs(se, chapterById(S.builder.lp.chapter_id) || {}); markDirty(); bldRerender(); },
  'bld.sesLoSub': el => { const b = S.builder, se = b.lp.sessions[+el.dataset.i], ch = chapterById(b.lp.chapter_id) || {}; if (!se) return; const ids = activeLos(ch).filter(l => l.sub_id === el.dataset.id).map(l => l.lo_id), all = ids.every(x => (se.lo_ids || []).indexOf(x) >= 0); se.lo_ids = (se.lo_ids || []).filter(x => ids.indexOf(x) < 0).concat(all ? [] : ids); syncSesSubs(se, ch); markDirty(); bldRerender(); },
  'bld.sesAlok': el => {
    const b = S.builder, ch = chapterById(b.lp.chapter_id) || {}, se = b.lp.sessions[+el.dataset.i]; if (!se) return;
    const before = sesAlok(se, ch.unit), next = periodOpts(ch.unit).find(o => o.kode === el.dataset.k), tot = scenTotal(se.scenarios);
    if (!next || (before && before.kode === next.kode && se.alok_kode)) return;
    se.alok_kode = next.kode;
    // Bila durasi lama tepat memenuhi alokasi lama (atau kosong), skalakan otomatis ke alokasi baru
    if ((!before || tot === before.menit || !tot) && tot !== next.menit) fitScen(se.scenarios, next.menit);
    markDirty(); bldRerender();
  },
  'bld.sesFit': el => { const b = S.builder, ch = chapterById(b.lp.chapter_id) || {}, se = b.lp.sessions.find(x => x.id === el.dataset.i); if (!se) return; const al = sesAlok(se, ch.unit); if (!al) return; if (!se.alok_kode) se.alok_kode = al.kode; fitScen(se.scenarios, al.menit); markDirty(); bldRerender(); toast('success', 'Durasi disesuaikan', `${se.scenarios.beginning.menit} + ${se.scenarios.middle.menit} + ${se.scenarios.end.menit} = ${al.menit} menit.`, { page: 1, id: 'alok' }); },
  'bld.sesAuto': async () => {
    const b = S.builder, ch = chapterById(b.lp.chapter_id) || {};
    if ((b.lp.sessions || []).some(se => SCEN.some(x => String(se.scenarios[x.k].desc).trim())) && !(await confirmDlg({ title: 'Susun ulang pertemuan?', message: `Daftar pertemuan akan dibuat ulang dari ${+ch.jumlah_period || 0} period chapter. <b>Skenario yang sudah ditulis akan hilang.</b>`, ok: 'Susun ulang', tone: 'danger', icon: 'magic', iconTone: 'amber' }))) return;
    b.lp.sessions = genSessions(ch); b.open = 0; markDirty(); bldRerender();
    toast('success', 'Pertemuan disusun', `${b.lp.sessions.length} pertemuan · ${lpPlannedPeriods(b.lp, ch)} period.`, { page: 1, id: 'alok' });
  },
  'bld.submit': async () => {
    const b = S.builder; if (!b) return;
    b.tried = true;
    const v = validateBuilder(b.lp), bad = [1, 2, 3, 4, 5].filter(i => v[i].length);
    if (bad.length) { b.step = bad.indexOf(b.step) >= 0 ? b.step : bad[0]; bldRerender(); toast('warning', 'Belum bisa diajukan', sum(bad.map(i => v[i].length)) + ' isian wajib belum lengkap.', { page: 1, id: 'val' }); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const lp = b.lp, ch = chapterById(lp.chapter_id);
    const okk = await confirmDlg({ title: 'Kirim ke pimpinan?', icon: 'send', message: `<b>${E(ch.kode)} · ${E(ch.nama_chapter)}</b> (${lp.sessions.length} pertemuan · ${lpPlannedPeriods(lp, ch)} period) akan berstatus <b>Pending Approval</b> dan tidak dapat disunting sampai diputuskan.${lp.status === 'RETURNED' ? `<br>Ini akan menjadi <b>revisi ke-${(+lp.revisi_ke || 1) + 1}</b>.` : ''}`, ok: 'Ya, Kirim ke Pimpinan' });
    if (!okk) return;
    const known = S.lps.find(l => l.lp_id === lp.lp_id);
    const prev = known ? { status: known.status, revisi_ke: known.revisi_ke, submitted_at: known.submitted_at } : { status: 'DRAFT', revisi_ke: 1, submitted_at: '' };
    const newRev = lp.status === 'RETURNED' ? (+lp.revisi_ke || 1) + 1 : Math.max(1, +lp.revisi_ke || 1);
    clearTimeout(b.timer);
    upsertLp(builderSummary(lp, { status: 'PENDING', revisi_ke: newRev, submitted_at: nowIso() }));
    const payload = {}; CONTENT_KEYS.forEach(k => { payload[k] = lp[k]; }); payload.lp_id = lp.lp_id;
    Outbox.push('lp.submit', payload, { key: 'lp:' + lp.lp_id, prev, label: 'Kirim ke pimpinan' });
    LS.del('draft:' + lp.lp_id);
    S.builder = null;
    toast('info', 'Mengirim ke pimpinan…', 'Status sudah berubah menjadi Pending Approval. Anda bisa lanjut bekerja.');
    S.ui.lp = Object.assign(S.ui.lp || {}, { tab: 'PENDING', page: 1 });
    go('lps', { tab: 'PENDING' }, { replace: true });
  }
});

/** Unggah lampiran: validasi klien (format & 10 MB) → RPC langsung (berkas tidak masuk antrean). */
async function uploadAttachment(file) {
  const b = S.builder; if (!b) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_ATT[ext]) { toast('error', 'Format berkas tidak didukung', 'Gunakan PDF, DOCX, atau PPTX.'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('error', 'Berkas terlalu besar', `${file.name} berukuran ${fmtSize(file.size)} — maksimal 10 MB.`); return; }
  const lpId = b.lp.lp_id, key = uid();
  if (b.lp._new || !S.lps.find(l => l.lp_id === lpId)) { b.dirty = true; builderFlush(); }
  S.uploads[key] = { lp_id: lpId, name: file.name, size: file.size, ext };
  bldRerender();
  try {
    const b64 = await fileToB64(file);
    const att = await call('file.upload', { lp_id: lpId, name: file.name, b64, att_id: uid() });
    S.atts.push(att); persist();
    toast('success', 'Lampiran terunggah', att.nama_file);
  } catch (e) { toast('error', 'Unggahan gagal', e.message); }
  delete S.uploads[key];
  if (S.builder && S.builder.lp.lp_id === lpId) bldRerender();
}
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#dropZone'); if (z) { e.preventDefault(); z.classList.add('drag'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#dropZone'); if (z) z.classList.remove('drag'); });
document.addEventListener('drop', e => { const z = e.target.closest && e.target.closest('#dropZone'); if (!z) return; e.preventDefault(); z.classList.remove('drag'); Array.from(e.dataTransfer.files || []).slice(0, 5).forEach(uploadAttachment); });

/** Pratinjau lampiran dalam modal (bukan tab baru). */
function previewAttachment(attId) {
  const a = S.atts.find(x => x.att_id === attId) || Object.values(S.detail).reduce((f, d) => f || (d.attachments || []).find(x => x.att_id === attId), null);
  const m = modal({ title: 'Pratinjau lampiran', size: 'wide', html: `<div class="mdl-head"><div class="d-flex gap-3 align-items-center"><span class="file-ic ${E(a ? a.tipe : '')}">${ic('file-earmark')}</span><div><h3 style="font-size:1.1rem">${E(a ? a.nama_file : 'Lampiran')}</h3><div class="fs-sm text-2">${a ? fmtSize(a.ukuran) : ''}</div></div></div><button class="btn-icon" data-close aria-label="Tutup">${ic('x-lg')}</button></div><div id="attBody"><div class="sk" style="height:60vh"></div></div><div class="mdl-foot"><button class="btn btn-ghost" data-close>${ic('x-lg')} Tutup</button><button class="btn btn-primary" id="attDl" disabled>${ic('download')} Unduh</button></div>` });
  call('file.get', { att_id: attId }).then(r => {
    const blob = b64ToBlob(r.b64, r.mime), url = URL.createObjectURL(blob), body = $('#attBody', m.el);
    if (!body) return;
    body.innerHTML = /pdf/.test(r.mime) ? `<iframe class="preview-frame" src="${url}" title="${E(r.name)}"></iframe>` : /^image\//.test(r.mime) ? `<img src="${url}" alt="${E(r.name)}" class="img-fluid rounded">` : emptyState('file-earmark-richtext', 'Pratinjau tidak tersedia', 'Berkas ' + E(r.name.split('.').pop().toUpperCase()) + ' perlu dibuka dengan aplikasi Office. Silakan unduh.');
    const dl = $('#attDl', m.el); dl.disabled = false; dl.onclick = () => downloadBlob(blob, r.name);
  }).catch(e => { const body = $('#attBody', m.el); if (body) body.innerHTML = emptyState('exclamation-triangle', 'Gagal memuat lampiran', E(e.message)); });
}

// ════════════════════════════════════════════════════════════
// BAGIAN 18 · DOKUMEN: data renderer, kanvas A4, mesin anotasi
// ════════════════════════════════════════════════════════════
const PAGE_W = 794, PAGE_H = 1123;   // A4 @96 dpi

function docDataClient(lp, ch, x) {
  x = x || {}; ch = ch || { subs: [], los: [] };
  const subMap = byKey(ch.subs || [], 'sub_id'), loMap = byKey(ch.los || [], 'lo_id'), unit = ch.unit || lp.unit;
  const unitRef = S.refs.find(r => r.kategori === 'UNIT' && r.kode === unit) || {};
  const loIds = (lp.lo_ids && lp.lo_ids.length ? lp.lo_ids : activeLos(ch).map(l => l.lo_id));
  return {
    mode: x.mode || 'view', school: { name: cfg('schoolName', ''), sub: cfg('schoolSub', '') }, kode_dok: lp.kode_dok || 'DRAFT (kode dibuat saat sinkron)', status: lp.status, revisi_ke: lp.revisi_ke || 1, verif_code: lp.verif_code,
    chapter_nama: ch.nama_chapter || lp.chapter_label, subs: activeSubs(ch).map(s => s.kode + ' ' + s.nama_sub),
    unit_label: unitRef.label || unit, kelas: gradeLabel(ch.kelas || lp.kelas), mapel: refLabel('SUBJECT', ch.mata_pelajaran || lp.mata_pelajaran),
    durasi_total: lpTotalMin(lp), chapter_period: +ch.jumlah_period || 0, teacher: x.teacher || { nama: S.me.nama, nip: S.me.nip },
    los: loIds.map(id => { const l = loMap[id]; return l ? { kode: l.kode, teks: l.teks_tp, sub: subMap[l.sub_id] ? subMap[l.sub_id].kode : '' } : null; }).filter(Boolean),
        eq: lp.essential_question,
    sessions: (lp.sessions || []).map((se, i) => { const al = sesAlok(se, unit); return { no: i + 1, alokasi: alokText(al), period: periodCount(al, unit), menit: sesMinutes(se), tanggal: se.tanggal, indikator: sesIndList(se, ch).map((t, n) => (n + 1) + '. ' + t).join('\n'), terminology: se.terminology || '', icm: (se.icm || []).map(k => refLabel('ICM_VALUE', k)), seq: (se.seq || []).map(k => refLabel('SEQUENCE', k)), diff: (se.diff || []).map(d => ({ a: refLabel('DIFF_ASPECT', d.a), p: refLabel('DIFF_PROFILE', d.p), note: d.note })), tps: (se.lo_ids || []).map(x => loMap[x] ? loMap[x].kode : '').filter(Boolean), topik: (se.sub_ids || []).map(s => subMap[s] ? subMap[s].kode + ' ' + subMap[s].nama_sub : '').filter(Boolean), scen: SCEN.map(sc => ({ key: sc.key, label: sc.key === 'A' ? 'Pendahuluan' : sc.key === 'B' ? 'Kegiatan Inti' : 'Penutup', menit: se.scenarios[sc.k].menit, desc: se.scenarios[sc.k].desc })) }; }),
    attachments: x.attachments || S.atts.filter(a => a.lp_id === lp.lp_id).map(a => a.nama_file), approval: x.approval || null
  };
}
function builderDocData() { const lp = S.builder.lp; return docDataClient(lp, chapterById(lp.chapter_id), { mode: 'draft' }); }
function detailDocData(det) {
  const lp = det.lp, dec = det.decider;
  return docDataClient(lp, det.chapter, { teacher: det.teacher, attachments: (det.attachments || []).map(a => a.nama_file), approval: lp.status === 'APPROVED' && dec ? { nama: dec.nama, jabatan: dec.jabatan, waktu: lp.decided_at, verif_code: lp.verif_code } : null });
}

/** Kanvas dokumen A4 + lapisan anotasi SVG (editable untuk pimpinan, baca-saja untuk guru). */
const Doc = {
  html() {
    return `<div class="doc-pane" id="docPane"><div class="doc-tools" role="toolbar" aria-label="Alat dokumen">
      <div class="grp"><button class="btn-icon" data-act="doc.page" data-d="-1" aria-label="Halaman sebelumnya">${ic('chevron-left')}</button><span id="docPg">Hal 1/1</span><button class="btn-icon" data-act="doc.page" data-d="1" aria-label="Halaman berikutnya">${ic('chevron-right')}</button></div>
      <div class="grp"><button class="btn-icon" data-act="doc.zoom" data-d="-1" aria-label="Perkecil">${ic('zoom-out')}</button><span id="docZm">100%</span><button class="btn-icon" data-act="doc.zoom" data-d="1" aria-label="Perbesar">${ic('zoom-in')}</button></div>
      <button class="btn-icon" data-act="doc.fit" aria-label="Sesuaikan lebar" title="Sesuaikan lebar">${ic('arrows-angle-expand')}</button>
      <span class="flex-grow-1"></span><span id="docAttBtn"></span></div>
      <div class="doc-scroll" id="docScroll"><div id="docSizer" style="position:relative;margin:0 auto"><div class="doc-stage" id="docStage" style="position:absolute;left:0;top:0;width:${PAGE_W}px"><div class="doc-paper" id="docPaper"></div><svg class="ann-svg" id="annSvg" xmlns="http://www.w3.org/2000/svg"></svg><div id="annPop"></div></div></div></div>
      <div class="att-strip" id="docAtts" hidden></div></div>`;
  },
  st: null,
  mount(data, anns, opt) {
    opt = opt || {};
    const paper = $('#docPaper'); if (!paper) return;
    paper.innerHTML = renderLpDoc(data, {});
    this.st = { anns: clone(anns || []), editable: !!opt.editable, tool: null, z: 1, H: 0, onChange: opt.onChange || (() => {}), drawing: null };
    requestAnimationFrame(() => { this.measure(); this.fit(); this.draw(); });
    const sc = $('#docScroll');
    sc.onscroll = () => this.pageLabel();
    const svg = $('#annSvg');
    if (this.st.editable) {
      svg.onpointerdown = e => this.down(e); svg.onpointermove = e => this.move(e); svg.onpointerup = e => this.up(e); svg.onpointercancel = e => this.up(e);
    }
    window.onresize = debounce(() => { if (this.st && $('#docScroll')) this.fit(); }, 150);
  },
  measure() {
    const paper = $('#docPaper'), st = this.st; if (!paper || !st) return;
    st.H = Math.max(PAGE_H, paper.offsetHeight);
    const pages = Math.ceil(st.H / PAGE_H);
    paper.querySelectorAll('.page-break').forEach(x => x.remove());
    for (let p = 1; p < pages; p++) { const d = document.createElement('div'); d.className = 'page-break'; d.style.top = (p * PAGE_H) + 'px'; d.innerHTML = `<span>Halaman ${p + 1}</span>`; paper.appendChild(d); }
    const svg = $('#annSvg'); svg.setAttribute('viewBox', `0 0 ${PAGE_W} ${st.H}`); svg.setAttribute('width', PAGE_W); svg.setAttribute('height', st.H);
  },
  setZoom(z) {
    const st = this.st; if (!st) return;
    st.z = Math.max(0.35, Math.min(2, z));
    $('#docStage').style.transform = `scale(${st.z})`;
    const sz = $('#docSizer'); sz.style.width = (PAGE_W * st.z) + 'px'; sz.style.height = (st.H * st.z) + 'px';
    $('#docZm').textContent = Math.round(st.z * 100) + '%';
    this.pageLabel();
  },
  fit() { const sc = $('#docScroll'); if (!sc) return; this.setZoom(Math.min(1.2, (sc.clientWidth - 32) / PAGE_W)); },
  pages() { return Math.max(1, Math.ceil((this.st ? this.st.H : PAGE_H) / PAGE_H)); },
  pageLabel() { const sc = $('#docScroll'), st = this.st; if (!sc || !st) return; const p = Math.min(this.pages(), Math.floor(sc.scrollTop / (PAGE_H * st.z) + 0.35) + 1); const el = $('#docPg'); if (el) el.textContent = `Halaman ${p} dari ${this.pages()}`; },
  gotoPage(d) { const sc = $('#docScroll'), st = this.st; const cur = Math.floor(sc.scrollTop / (PAGE_H * st.z) + 0.35) + 1; const n = Math.max(1, Math.min(this.pages(), cur + d)); sc.scrollTo({ top: (n - 1) * PAGE_H * st.z, behavior: 'smooth' }); },
  setTool(t) { const st = this.st; st.tool = st.tool === t ? null : t; const svg = $('#annSvg'); svg.classList.toggle('drawing', st.tool === 'pen' || st.tool === 'hl'); svg.classList.toggle('noting', st.tool === 'note'); },
  pt(e) { const r = $('#annSvg').getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / this.st.z) * 10) / 10, Math.round(((e.clientY - r.top) / this.st.z) * 10) / 10]; },
  down(e) {
    const st = this.st; if (!st.tool) return;
    if (e.target.closest('.note-pin')) return;
    e.preventDefault();
    const p = this.pt(e);
    if (st.tool === 'note') { this.addNote(p); return; }
    $('#annSvg').setPointerCapture(e.pointerId);
    st.drawing = st.tool === 'pen' ? { id: 'a' + Date.now(), t: 'pen', pts: [p], page: Math.floor(p[1] / PAGE_H) + 1 } : { id: 'a' + Date.now(), t: 'hl', o: p, r: [p[0], p[1], 0, 0], page: Math.floor(p[1] / PAGE_H) + 1 };
  },
  move(e) {
    const st = this.st, d = st && st.drawing; if (!d) return;
    const p = this.pt(e);
    if (d.t === 'pen') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= 2.5) d.pts.push(p); }
    else d.r = [Math.min(d.o[0], p[0]), Math.min(d.o[1], p[1]), Math.abs(p[0] - d.o[0]), Math.abs(p[1] - d.o[1])];
    this.draw();
  },
  up() {
    const st = this.st, d = st && st.drawing; if (!d) return;
    st.drawing = null;
    if ((d.t === 'pen' && d.pts.length > 2) || (d.t === 'hl' && d.r[2] > 6 && d.r[3] > 6)) { delete d.o; st.anns.push(d); st.onChange(st.anns); }
    this.draw();
  },
  addNote(p) {
    const st = this.st, n = st.anns.filter(a => a.t === 'note').length + 1;
    const pop = $('#annPop');
    pop.innerHTML = `<div class="ann-pop" style="left:${Math.min(p[0] + 18, PAGE_W - 270)}px;top:${p[1] - 10}px"><div class="fs-xs fw-7 text-3 mb-1">CATATAN #${n} · HALAMAN ${Math.floor(p[1] / PAGE_H) + 1}</div><textarea class="form-control" rows="3" id="notePopTx" placeholder="Tulis catatan untuk guru…" style="min-height:76px"></textarea><div class="d-flex justify-content-end gap-2 mt-2"><button class="btn btn-ghost btn-sm" id="notePopX">Batal</button><button class="btn btn-primary btn-sm" id="notePopOk">Simpan</button></div></div>`;
    pop.querySelector('.ann-pop').style.transform = `scale(${1 / Math.max(this.st.z, 0.6)})`;
    pop.querySelector('.ann-pop').style.transformOrigin = '0 0';
    const tx = $('#notePopTx'); tx.focus();
    $('#notePopX').onclick = () => { pop.innerHTML = ''; };
    $('#notePopOk').onclick = () => { const v = tx.value.trim(); pop.innerHTML = ''; if (!v) return; st.anns.push({ id: 'a' + Date.now(), t: 'note', p, n, text: v, page: Math.floor(p[1] / PAGE_H) + 1 }); st.onChange(st.anns); this.draw(); };
    tx.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#notePopOk').click(); if (e.key === 'Escape') { e.stopPropagation(); pop.innerHTML = ''; } };
  },
  draw() {
    const st = this.st, svg = $('#annSvg'); if (!st || !svg) return;
    const list = st.drawing ? st.anns.concat([st.drawing]) : st.anns;
    svg.innerHTML = list.map(a => {
      if (a.t === 'pen') return `<path d="${a.pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ')}" fill="none" stroke="#6B5FD6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
      if (a.t === 'hl') return `<rect x="${a.r[0]}" y="${a.r[1]}" width="${a.r[2]}" height="${a.r[3]}" rx="6" fill="#F2A93B" fill-opacity=".28" stroke="#F2A93B" stroke-width="1.5" stroke-dasharray="6 4"/>`;
      if (a.t === 'note') return `<g class="note-pin" data-note="${E(a.id)}"><title>${E(a.text)}</title><circle cx="${a.p[0]}" cy="${a.p[1]}" r="13" fill="#F2A93B" stroke="#fff" stroke-width="2.5"/><text x="${a.p[0]}" y="${a.p[1] + 4.5}" text-anchor="middle" font-size="12.5" font-weight="800" fill="#2B2A3D" font-family="Arial">${E(a.n)}</text></g>`;
      return '';
    }).join('');
  },
  setAnns(list) { if (!this.st) return; this.st.anns = clone(list || []); this.draw(); },
  undo() { const st = this.st; if (st && st.anns.length) { st.anns.pop(); st.onChange(st.anns); this.draw(); } },
  clear() { const st = this.st; if (st) { st.anns = []; st.onChange(st.anns); this.draw(); } },
  remove(id) { const st = this.st; if (!st) return; st.anns = st.anns.filter(a => a.id !== id); let n = 0; st.anns.forEach(a => { if (a.t === 'note') a.n = ++n; }); st.onChange(st.anns); this.draw(); },
  scrollTo(id) { const a = this.st && this.st.anns.find(x => x.id === id); if (!a) return; const y = a.t === 'note' ? a.p[1] : a.t === 'hl' ? a.r[1] : a.pts[0][1]; $('#docScroll').scrollTo({ top: Math.max(0, y * this.st.z - 120), behavior: 'smooth' }); }
};
Object.assign(ACT, {
  'doc.page': el => Doc.gotoPage(+el.dataset.d),
  'doc.zoom': el => Doc.setZoom(Doc.st.z + (+el.dataset.d) * 0.1),
  'doc.fit': () => Doc.fit(),
  'doc.atts': () => { const s = $('#docAtts'); if (s) s.hidden = !s.hidden; }
});
document.addEventListener('click', e => { const pin = e.target.closest && e.target.closest('.note-pin'); if (pin && Doc.st) { const a = Doc.st.anns.find(x => x.id === pin.dataset.note); if (a) toast('info', 'Catatan #' + a.n + ' · Hal. ' + a.page, a.text, { ms: 6000 }); } });

function annLabel(a) { return a.t === 'note' ? a.text : a.t === 'hl' ? 'Bagian ditandai stabilo' : 'Coretan pena'; }

/** Pratinjau dokumen (B-12) dalam modal — dirender instan di klien, identik dengan PDF server. */
function openDocPreview(data, anns, approval) {
  modal({ title: 'Pratinjau dokumen', size: 'xl', html: `<div class="d-flex align-items-center gap-3 p-3" style="border-bottom:1px solid var(--border)"><span class="icon-tile sm">${ic('file-earmark-richtext')}</span><div class="flex-grow-1 min-w-0"><b class="d-block clamp-1">${E(data.chapter_nama)} · ${(data.sessions || []).length} pertemuan</b><span class="fs-xs text-2">${approval ? 'Anotasi ' + E(approval.approver_nama) + ' · ' + E(relTime(approval.waktu)) : 'Pratinjau ' + (data.mode === 'draft' ? 'draf' : 'dokumen') + ' — tampilan sama dengan PDF'}</span></div><button class="btn-icon" data-close aria-label="Tutup">${ic('x-lg')}</button></div>
    ${approval && approval.resume_feedback ? `<div class="notice amber m-3 mb-0"><span class="ic">${ic('chat-square-quote')}</span><div><b>Resume feedback:</b> ${E(approval.resume_feedback)}${(anns || []).filter(a => a.t === 'note').length ? `<ul class="mb-0">${anns.filter(a => a.t === 'note').map(a => `<li><b>#${a.n} · Hal. ${a.page}</b> — ${E(a.text)}</li>`).join('')}</ul>` : ''}</div></div>` : ''}
    <div class="p-3">${Doc.html()}</div>`, onMount: () => { Doc.mount(data, anns || [], { editable: false }); $('#docScroll').style.height = '68vh'; } });
}

// ════════════════════════════════════════════════════════════
// BAGIAN 19 · HALAMAN DETAIL LESSON PLAN (baca-saja, semua peran)
// ════════════════════════════════════════════════════════════
function loadDetail(id, force) {
  if (S.detail[id] && !force) return Promise.resolve(S.detail[id]);
  return call('lp.get', { lp_id: id }).then(d => { S.detail[id] = d; return d; });
}
function timelineHtml(apr) {
  if (!apr || !apr.length) return '<div class="text-2 fs-sm">Belum ada riwayat persetujuan.</div>';
  let seenReturn = false;
  return `<div class="tl">${apr.slice().reverse().map(a => {
    const resub = a.keputusan === 'SUBMITTED' && a.revisi_ke > 1;
    const lbl = a.keputusan === 'APPROVED' ? 'Disetujui & Ditandatangani' : a.keputusan === 'RETURNED' ? 'Catatan Revisi Diberikan' : resub ? 'Revisi Diunggah Guru' : 'Pengajuan Draf Awal';
    if (a.keputusan === 'RETURNED') seenReturn = true;
    return `<div class="tl-i ${resub ? 'RESUBMIT' : a.keputusan}"><div class="h"><span>Rev. ${E(a.revisi_ke)} · ${E(lbl)}</span><small>${E(fmtTanggal(a.waktu, true))}</small></div><div class="b">${a.keputusan === 'SUBMITTED' ? 'Diajukan ke antrean persetujuan' : 'Oleh ' + E(a.approver_nama || '') + (a.resume_feedback ? ': “' + E(a.resume_feedback) + '”' : '')}${(a.annotations || []).length ? ` · ${a.annotations.length} anotasi` : ''}</div></div>`;
  }).join('')}</div>`;
}

PAGES['lp-view'] = {
  title: 'Detail Lesson Plan',
  render(p) {
    const d = S.detail[p.id];
    if (!d) return `<div class="review-head"><div class="sk sk-title" style="margin:0;width:50%"></div></div><div class="review-grid"><div class="doc-pane"><div class="sk" style="height:70vh;border-radius:0"></div></div><div class="side-stack">${'<div class="card-x"><div class="sk sk-line"></div><div class="sk sk-block mt-2"></div></div>'.repeat(3)}</div></div>`;
    const lp = d.lp, ch = d.chapter || {}, t = d.teacher || {}, apr = d.approvals || [];
    const lastDec = apr.filter(a => a.keputusan === 'RETURNED' || a.keputusan === 'APPROVED').pop();
    const mine = isRole('TEACHER');
    const notes = lastDec ? (lastDec.annotations || []) : [];
    return `
    ${lp.status === 'APPROVED' ? `<div class="notice green mb-3"><span class="ic">${ic('lock-fill')}</span><div class="flex-grow-1"><b>Dokumen Terkunci & Telah Disahkan</b><div class="fs-sm">Perubahan substansi memerlukan pengajuan versi baru melalui siklus telaah kurikulum.</div></div><span class="chip green">SIKLUS TERTUTUP</span></div>` : ''}
    <div class="review-head"><button class="link-btn" data-act="lpv.back">${ic('arrow-left')} Kembali</button><span class="mono fw-7">${E(lp.kode_dok)}</span><span class="text-2 fs-sm d-none d-md-inline">${E(ch.nama_chapter || lp.chapter_label)}</span>${pill(lp.status)}<span class="chip gray">${lp.status === 'APPROVED' ? 'Final v' + E(lp.revisi_ke) + ' · ' + E(fmtTanggal(lp.decided_at)) : 'Rev. ' + E(lp.revisi_ke)}</span>
      <span class="flex-grow-1"></span>
      ${mine && lp.status === 'RETURNED' ? `<button class="btn btn-amber" data-go="builder" data-p-id="${E(lp.lp_id)}">${ic('pencil')} Buka & Revisi</button>` : ''}
      ${isRole('LEADER', 'SUPERADMIN') && lp.status === 'PENDING' ? `<button class="btn btn-primary" data-go="review" data-p-id="${E(lp.lp_id)}">${ic('patch-check')} Tinjau Sekarang</button>` : ''}
      <button class="btn ${lp.status === 'APPROVED' ? 'btn-primary' : 'btn-soft'}" data-act="lp.pdf" data-id="${E(lp.lp_id)}" data-mode="${lp.status === 'APPROVED' ? 'final' : 'draft'}">${ic('download')} ${lp.status === 'APPROVED' ? 'Unduh PDF Resmi' : 'Unduh Draf PDF'}</button></div>
    <div class="review-grid">
      <div>${Doc.html()}</div>
      <div class="side-stack">
        <section class="card-x"><div class="card-head"><h3>${ic('info-circle', 'text-2 me-1')} Metadata Pembelajaran</h3><span class="chip">${lp.status === 'APPROVED' ? 'Arsip Aktif' : STATUS_LABEL[lp.status]}</span></div>
          <div class="kv-grid"><div class="kv"><div class="k">Guru Pengampu</div><div class="v d-flex gap-2 align-items-center"><span class="avatar" style="width:26px;height:26px;flex-basis:26px;font-size:.64rem">${E(initials(t.nama))}</span>${E(t.nama)}</div></div><div class="kv"><div class="k">Unit Pendidikan</div><div class="v">${E(unitShort(lp.unit))} (${E(unitLabel(lp.unit))})</div></div>
          <div class="kv"><div class="k">Tanggal Diajukan</div><div class="v">${ic('calendar-check', 'text-3')} ${E(fmtTanggal(lp.submitted_at))}</div></div><div class="kv"><div class="k">${lp.status === 'APPROVED' ? 'Tanggal Disetujui' : 'Tanggal Mengajar'}</div><div class="v" style="${lp.status === 'APPROVED' ? 'color:var(--green)' : ''}">${E(lp.status === 'APPROVED' ? fmtTanggal(lp.decided_at) : (lp.tanggal_ajar ? fmtTanggal(lp.tanggal_ajar) : '—'))}</div></div></div></section>
        <section class="card-x"><div class="card-head"><h3>${ic('chat-square-text', 'text-2 me-1')} Catatan & Anotasi Pimpinan</h3><span class="chip">${notes.length} Anotasi</span></div>
          ${lastDec ? `<div class="inset"><div class="d-flex justify-content-between fs-xs mb-2"><span class="chip sky">Rev. ${E(lastDec.revisi_ke)} · ${lastDec.keputusan === 'APPROVED' ? 'Disetujui' : 'Dikembalikan'}</span><span class="text-2">${E(relTime(lastDec.waktu))}</span></div><div class="d-flex gap-2 align-items-center mb-2"><span class="avatar sky" style="width:30px;height:30px;flex-basis:30px;font-size:.68rem">${E(initials(lastDec.approver_nama))}</span><div><b class="fs-sm d-block">${E(lastDec.approver_nama)}</b><span class="fs-xs text-2">${E(lastDec.approver_jabatan)}</span></div></div><div class="card-x pure fs-sm" style="padding:12px;font-style:italic">“${E(lastDec.resume_feedback || 'Tanpa catatan tambahan.')}”</div></div>
            ${notes.map(a => `<div class="ann-item mt-2" data-act="ann.goto" data-id="${E(a.id)}" style="cursor:pointer"><span class="pg">${a.t === 'note' ? '[' + a.n + '] ' : ''}Hal. ${E(a.page)}</span><span class="tx">${E(annLabel(a))}</span></div>`).join('')}` : '<div class="text-2 fs-sm">Belum ada keputusan pimpinan.</div>'}</section>
        <section class="card-x"><div class="card-head"><h3>${ic('graph-up-arrow', 'text-2 me-1')} Riwayat Alur Persetujuan</h3><span class="fs-xs text-2">${apr.length} aktivitas</span></div>${timelineHtml(apr)}</section>
        ${lp.status === 'APPROVED' ? `<section class="card-x"><div class="card-head"><h3>${ic('qr-code', 'text-2 me-1')} Verifikasi Tanda Tangan Digital</h3><span class="chip green">Tervalidasi</span></div>
          <div class="fs-xs fw-7 text-3 mb-1">KODE VERIFIKASI ICM</div><div class="verify-code"><span class="flex-grow-1">${E(lp.verif_code)}</span><button class="btn-icon" data-act="copy" data-text="${E(lp.verif_code)}" aria-label="Salin kode">${ic('copy')}</button></div>
          <div class="inset mt-2 fs-sm d-flex gap-2"><span style="color:var(--green)">${ic('shield-check')}</span><div><b>Integritas terjamin</b><div class="text-2 fs-xs">Disahkan oleh ${E(d.decider ? d.decider.nama : '')} · ${E(fmtTanggal(lp.decided_at, true))} WIB. Spesimen TTD dilekatkan oleh server.</div></div></div>
          <button class="btn btn-primary w-100 mt-3" data-act="lp.pdf" data-id="${E(lp.lp_id)}" data-mode="final">${ic('download')} Unduh PDF Final (Dengan Tanda Tangan Digital)</button></section>` : ''}
        <section class="card-x"><div class="card-head"><h3>${ic('paperclip', 'text-2 me-1')} Lampiran</h3><span class="chip">${(d.attachments || []).length}</span></div>${(d.attachments || []).map(a => `<div class="file-row"><span class="file-ic ${E(a.tipe)}">${ic('file-earmark')}</span><div class="flex-grow-1 min-w-0"><div class="nm clamp-1">${E(a.nama_file)}</div><div class="mt">${fmtSize(a.ukuran)}</div></div><button class="btn-icon" data-act="att.preview" data-id="${E(a.att_id)}" aria-label="Pratinjau">${ic('eye')}</button></div>`).join('') || '<div class="text-2 fs-sm">Tidak ada lampiran.</div>'}</section>
      </div></div>`;
  },
  mount(p) {
    const d = S.detail[p.id];
    if (!d) { loadDetail(p.id).then(() => { if (S.route.name === 'lp-view' && S.route.params.id === p.id) renderRoute(false); }).catch(e => { toast('error', 'Gagal memuat dokumen', e.message); back(); }); return; }
    const apr = d.approvals || [], lastDec = apr.filter(a => a.keputusan === 'RETURNED' || a.keputusan === 'APPROVED').pop();
    Doc.mount(detailDocData(d), lastDec ? lastDec.annotations : [], { editable: false });
    loadDetail(p.id, true).then(n => { if (S.route.name === 'lp-view' && S.route.params.id === p.id && JSON.stringify(n.lp) !== JSON.stringify(d.lp)) renderRoute(false); }).catch(() => {});
  }
};
Object.assign(ACT, {
  'lpv.back': () => back(isRole('TEACHER') ? 'lps' : HOME[S.me.peran]),
  'ann.goto': el => Doc.scrollTo(el.dataset.id),
  'copy': el => copyText(el.dataset.text || '')
});

// ════════════════════════════════════════════════════════════
// BAGIAN 20 · DATA TURUNAN PIMPINAN / QA
// ════════════════════════════════════════════════════════════
const leaderLps = () => S.lpsAll.filter(l => l.status !== 'DELETED');
const termLps = tid => leaderLps().filter(l => l.term_id === tid);
const pendingQueue = tid => termLps(tid).filter(l => l.status === 'PENDING').sort((a, b) => ts(a.submitted_at) - ts(b.submitted_at));
function weekBuckets(t, n) {
  const start = ts((t ? t.tanggal_mulai : todayYmd()) + 'T00:00:00'), wk = 7 * 864e5;
  const cur = Math.max(1, Math.floor((Date.now() - start) / wk) + 1), count = Math.max(n || 8, Math.min(cur, 14));
  return Array.from({ length: Math.min(count, 14) }, (_, i) => ({ i: i + 1, from: start + i * wk, to: start + (i + 1) * wk, cur: i + 1 === cur })).slice(0, Math.max(cur, n || 8));
}
function waitPill(iso) {
  const d = waitDays(iso), sla = cfg('sla_hari', 2);
  const cls = d > sla * 2 ? 'urgent' : d > sla ? 'PENDING' : 'DRAFT';
  return `<span class="pill pill-${cls} plain">${ic(d > sla ? 'exclamation-triangle' : 'clock')} ${E(fmtWait(iso))}${d > sla * 2 ? ' (Mendesak)' : ''}</span>`;
}
function teacherCell(uid) {
  const p = person(uid);
  return `<div class="d-flex gap-2 align-items-center"><span class="avatar">${E(initials(p.n))}</span><div class="min-w-0"><div class="t-title clamp-1">${E(p.n || '—')}</div><div class="t-sub">${E(refLabel('SUBJECT', String(p.m || '').split(',')[0]))} · ${E(gradeLabel(String(p.k || '').split(',')[0]))}</div></div></div>`;
}
function prefetchDetails(ids) { ids.slice(0, 3).forEach((id, i) => { if (!S.detail[id]) setTimeout(() => loadDetail(id).catch(() => {}), 400 + i * 700); }); }

// ════════════════════════════════════════════════════════════
// BAGIAN 21 · DASHBOARD PIMPINAN
// ════════════════════════════════════════════════════════════
PAGES.lead = {
  title: 'Dashboard Pimpinan', roles: ['LEADER'],
  render() {
    const t = viewTerm(), lps = termLps(t.term_id), q = pendingQueue(t.term_id), sla = cfg('sla_hari', 2);
    const urgent = q.filter(l => waitDays(l.submitted_at) > sla).length;
    const wk = 7 * 864e5, now = Date.now();
    const apThis = lps.filter(l => l.status === 'APPROVED' && ts(l.decided_at) > now - wk).length, apPrev = lps.filter(l => l.status === 'APPROVED' && ts(l.decided_at) <= now - wk && ts(l.decided_at) > now - 2 * wk).length;
    const ret = lps.filter(l => l.status === 'RETURNED').length, submitted = lps.length;
    const revRate = pct(lps.filter(l => l.jumlah_return > 0).length, submitted);
    const teachers = Object.keys(S.people).filter(k => S.people[k].r === 'TEACHER' && S.people[k].a);
    const activeT = uniq(lps.filter(l => ts(l.submitted_at) > now - wk).map(l => l.user_id)).length;
    const comp = teachers.length ? Math.round(pct(activeT, teachers.length) * 10) / 10 : 0;
    const drafts = sum(Object.keys(S.draftCounts).map(k => S.draftCounts[k]));
    const attention = teachers.map(id => {
      const mine = lps.filter(l => l.user_id === id), returns = sum(mine.map(l => l.jumlah_return)), overdue = mine.filter(l => l.status !== 'APPROVED' && l.tanggal_ajar && l.tanggal_ajar < todayYmd()).length;
      // Catatan yang ditampilkan harus catatan REVISI yang masih berlaku, bukan catatan persetujuan.
      const lastRet = mine.filter(l => l.status === 'RETURNED').sort((a, b) => ts(b.decided_at) - ts(a.decided_at))[0];
      const pastRet = lastRet ? null : mine.filter(l => l.jumlah_return > 0).sort((a, b) => b.jumlah_return - a.jumlah_return || ts(b.decided_at) - ts(a.decided_at))[0];
      return { id, returns, overdue, lastRet, pastRet, score: returns * 2 + overdue * 3 };
    }).filter(x => x.returns >= 2 || x.overdue > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    const unit = myUnits().map(unitShort).join(' & ');
    prefetchDetails(q.map(l => l.lp_id));
    return `
    <div class="page-head"><div><div class="eyebrow">Dasbor Tata Kelola Akademik · <span class="text-2">Siklus Verifikasi Pekanan</span></div><h1 class="mt-1">Kepemimpinan Kurikulum ${E(unit)}</h1><div class="desc">Pemantauan kepatuhan perencanaan ajar, antrean verifikasi mendesak, serta intervensi pedagogis.</div></div>
      <div class="actions"><span class="tb-pill">${ic('clock-history')} Pembaruan: ${E(relTime(new Date(S.lastSync || Date.now()).toISOString()))}</span><button class="btn btn-soft" data-act="sync.full">${ic('arrow-repeat')} Segarkan</button><button class="btn btn-primary" data-act="lead.export">${ic('download')} Unduh Rekap</button></div></div>
    <div class="stat-grid">
      ${statCard({ ey: 'Antrean Utama', label: 'Menunggu Keputusan', icon: 'hourglass-split', tone: 'amber', value: q.length, unit: 'Berkas', cap: urgent ? `<span class="pill pill-urgent plain">${ic('circle-fill', 'fs-xs')} ${urgent} Mendesak (> ${sla} hari)</span>` : '<span class="dot green"></span> Semua dalam SLA' })}
      ${statCard({ ey: 'Kemajuan Ajar', label: 'Disetujui Pekan Ini', icon: 'patch-check', value: apThis, unit: 'Berkas', cap: `<span class="chip ${apThis >= apPrev ? 'sky' : 'amber'}">${ic(apThis >= apPrev ? 'graph-up-arrow' : 'graph-down-arrow')} ${apPrev ? (apThis >= apPrev ? '+' : '') + Math.round(pct(apThis - apPrev, apPrev)) + '%' : apThis ? 'baru' : '0'}</span> vs pekan lalu` })}
      ${statCard({ ey: 'Catatan Mutu', label: 'Perlu Revisi (Dikembalikan)', icon: 'arrow-counterclockwise', tone: 'rose', value: ret, unit: 'Berkas', cap: `<span class="chip rose">Tingkat revisi ${fmtPct(revRate)}</span>` })}
      ${statCard({ ey: 'Indikator KPI', label: 'Kepatuhan Guru Pekan Ini', icon: 'speedometer2', tone: 'sky', value: fmtPct(comp).replace('%', ''), unit: '%', cap: `<div class="w-100"><div class="bar-mini sky" style="height:7px"><span style="width:${Math.min(100, comp)}%"></span></div><div class="d-flex justify-content-between mt-1"><span>${activeT}/${teachers.length} guru mengajukan</span><span>Target 90%</span></div></div>` })}
    </div>
    <div class="row g-4 mb-4">
      <div class="col-xl-5"><section class="card-x pure h-100"><div class="card-head"><div><div class="eyebrow text-3">Sebaran Keseluruhan</div><h3>Status Distribusi Lesson Plan</h3></div><span class="chip gray">Total: ${submitted + drafts} RPP</span></div>
        <div class="d-flex flex-wrap gap-3 align-items-center"><div style="position:relative;width:180px;height:180px;margin:auto"><canvas id="chDonut" aria-label="Diagram donat status"></canvas><div style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;text-align:center"><div><div class="fw-8" style="font-size:1.8rem">${submitted + drafts}</div><div class="fs-xs text-2">RPP Aktif</div></div></div></div>
          <div class="flex-grow-1 d-grid gap-2" style="min-width:180px">${[['APPROVED', 'Disetujui', 'var(--primary)'], ['PENDING', 'Pending Approval', 'var(--amber)'], ['RETURNED', 'Returned (Revisi)', '#C2410C'], ['DRAFT', 'Draft Guru', 'var(--text-3)']].map(x => { const n = x[0] === 'DRAFT' ? drafts : lps.filter(l => l.status === x[0]).length; return `<div class="inset d-flex align-items-center gap-2" style="padding:8px 12px"><span class="dot" style="background:${x[2]}"></span><span class="flex-grow-1 fs-sm">${x[1]}</span><b>${n}</b><span class="fs-xs text-2">(${Math.round(pct(n, submitted + drafts))}%)</span></div>`; }).join('')}</div></div></section></div>
      <div class="col-xl-7"><section class="card-x pure h-100"><div class="card-head"><div><div class="eyebrow text-3">Laju Validasi</div><h3>Lesson Plan Disetujui per Pekan (${E(termLabel(t))})</h3><div class="sub">Akselerasi penyelesaian modul ajar per minggu akademik</div></div></div><div style="height:300px"><canvas id="chLine" aria-label="Grafik garis persetujuan per pekan"></canvas></div></section></div>
    </div>
    <section class="card-x flush pure mb-4">
      <div class="d-flex flex-wrap gap-3 justify-content-between align-items-start p-4 pb-3"><div><h3 class="fs-5 fw-8">Antrean Persetujuan Lesson Plan <span class="chip amber ms-1">${q.length} Menunggu</span></h3><div class="fs-sm text-2">Daftar perencanaan guru yang memerlukan keputusan Anda — terlama di atas.</div></div><button class="btn btn-soft btn-sm" data-go="queue">Buka Semua Antrean ${ic('arrow-right')}</button></div>
      ${q.length ? `<div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Guru & Mata Pelajaran</th><th>Chapter & Pertemuan</th><th>Waktu Menunggu</th><th>Status Berkas</th><th class="text-end">Aksi</th></tr></thead><tbody>${q.slice(0, 6).map(queueRow).join('')}</tbody></table></div>`
        : emptyState('inbox', 'Antrean kosong', 'Tidak ada lesson plan yang menunggu keputusan Anda saat ini.')}
    </section>
    <section class="card-x">
      <div class="card-head"><div class="d-flex gap-3 align-items-center"><span class="icon-tile sm rose">${ic('person-exclamation')}</span><div><h3>Guru Perlu Perhatian & Bimbingan <span class="chip rose ms-1">${attention.length} Guru Terdeteksi</span></h3><div class="sub">Guru dengan revisi berulang atau sesi tertunda — bahan pendampingan pedagogis.</div></div></div></div>
      ${attention.length ? `<div class="row g-3">${attention.map(a => { const p = person(a.id); return `<div class="col-lg-6"><div class="inset h-100"><div class="d-flex gap-2 align-items-center mb-2"><span class="avatar">${E(initials(p.n))}</span><div class="flex-grow-1 min-w-0"><b class="d-block clamp-1">${E(p.n)}</b><span class="fs-xs text-2">${E(refLabel('SUBJECT', p.m))} · ${E(gradeLabel(p.k))}</span></div>${a.returns >= 2 ? `<span class="chip rose">${ic('arrow-repeat')} ${a.returns}x Revisi</span>` : ''}${a.overdue ? `<span class="chip amber">${ic('calendar-x')} ${a.overdue} Sesi Tertunda</span>` : ''}</div>
        <div class="card-x pure fs-sm" style="padding:10px 12px">${a.lastRet ? `${ic('chat-square-quote', 'text-2')} <b>${E(a.lastRet.chapter_label)}</b> — catatan revisi: <span style="color:var(--st-returned)">${E(a.lastRet.catatan_terakhir || '')}</span>` : a.pastRet ? `${ic('arrow-repeat', 'text-2')} <b>${E(a.pastRet.chapter_label)}</b> dikembalikan ${a.pastRet.jumlah_return}x sebelum ${E(STATUS_LABEL[a.pastRet.status].toLowerCase())}.${a.overdue ? ' Ada sesi yang tanggal mengajarnya sudah lewat namun belum disetujui.' : ''}` : `${ic('calendar-x', 'text-2')} Ada sesi yang tanggal mengajarnya sudah lewat namun belum disetujui.`}</div>
        <div class="d-flex gap-2 mt-2 justify-content-end"><button class="btn btn-soft btn-sm" data-act="lead.history" data-id="${E(a.id)}">Lihat Riwayat Review</button><button class="btn btn-primary btn-sm" data-act="lead.remind" data-id="${E(a.id)}">${ic('chat-dots')} Pesan Mentoring</button></div></div></div>`; }).join('')}</div>`
        : `<div class="text-2 fs-sm">${ic('emoji-smile')} Tidak ada guru dengan revisi berulang atau sesi tertunda.</div>`}
    </section>`;
  },
  mount() {
    const t = viewTerm(), lps = termLps(t.term_id), drafts = sum(Object.keys(S.draftCounts).map(k => S.draftCounts[k]));
    whenChart(() => {
      if (!$('#chDonut')) return;
      const vals = ['APPROVED', 'PENDING', 'RETURNED'].map(s => lps.filter(l => l.status === s).length).concat([drafts]);
      S.charts.donut = new Chart($('#chDonut'), { type: 'doughnut', data: { labels: ['Disetujui', 'Pending', 'Returned', 'Draft'], datasets: [{ data: vals, backgroundColor: [cssVar('--btn-bg'), cssVar('--amber'), '#C2410C', cssVar('--border-strong')], borderWidth: 0, hoverOffset: 6 }] }, options: { cutout: '72%', plugins: { legend: { display: false } }, maintainAspectRatio: false } });
      // Pekan yang belum berjalan = null (tidak digambar), agar grafik tidak tampak "anjlok ke nol".
      const wk = weekBuckets(t, 8), now = Date.now(), data = wk.map(w => w.from > now ? null : lps.filter(l => l.status === 'APPROVED' && ts(l.decided_at) >= w.from && ts(l.decided_at) < w.to).length);
      lineChart('chLine', wk.map(w => 'W' + w.i + (w.cur ? ' (Aktif)' : '')), [{ label: 'Disetujui', data, color: cssVar('--btn-bg') }]);
    });
  }
};
function queueRow(l) {
  const resub = l.revisi_ke > 1;
  return `<tr class="clickable" data-go="review" data-p-id="${E(l.lp_id)}" onmouseenter="prefetchDetails(['${E(l.lp_id)}'])">
    <td data-label="Guru">${teacherCell(l.user_id)}</td>
    <td data-label="Chapter"><div class="t-title clamp-1">${E(l.chapter_label)}</div><div class="t-sub">${E(lpMeta(l))}</div></td>
    <td data-label="Waktu Menunggu">${waitPill(l.submitted_at)}</td>
    <td data-label="Status">${resub ? `<span class="pill pill-RETURNED plain">Revisi Ulang · Rev. ${E(l.revisi_ke)}</span>` : pill('PENDING')}</td>
    <td class="text-end cell-actions">${isRole('LEADER', 'SUPERADMIN') ? `<button class="btn btn-primary btn-sm">Tinjau Berkas ${ic('arrow-right')}</button>` : `<button class="btn btn-soft btn-sm" data-go="lp-view" data-p-id="${E(l.lp_id)}">Lihat</button>`}</td></tr>`;
}
function lineChart(id, labels, series) {
  const el = $('#' + id); if (!el || !window.Chart) return;
  const grid = cssVar('--border'), txt = cssVar('--text-2');
  S.charts[id] = new Chart(el, { type: 'line', data: { labels, datasets: series.map(s => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: ctx => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height); g.addColorStop(0, s.color + '33'); g.addColorStop(1, s.color + '00'); return g; }, fill: true, tension: .32, cubicInterpolationMode: 'monotone', spanGaps: false, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: s.color, pointBorderWidth: 2 })) },
    options: { maintainAspectRatio: false, plugins: { legend: { display: series.length > 1, labels: { color: txt } }, tooltip: { intersect: false, mode: 'index' } }, scales: { x: { grid: { display: false }, ticks: { color: txt, font: { family: 'Plus Jakarta Sans' } } }, y: { beginAtZero: true, ticks: { precision: 0, color: txt }, grid: { color: grid } } } } });
}
Object.assign(ACT, {
  'lead.export': () => {
    const t = viewTerm();
    downloadCsv('Rekap_Unit_' + myUnits().join('-') + '_' + t.kode.replace(/\W+/g, '_') + '.csv', ['Guru', 'Mapel', 'Kelas', 'Chapter', 'Pertemuan', 'Period', 'Status', 'Revisi', 'Diajukan', 'Diputuskan', 'Catatan Terakhir'],
      termLps(t.term_id).map(l => [person(l.user_id).n, refLabel('SUBJECT', l.mata_pelajaran), l.kelas, l.chapter_label, l.jumlah_sesi, lpPeriods(l), STATUS_LABEL[l.status], l.revisi_ke, l.submitted_at, l.decided_at, l.catatan_terakhir]));
  },
  'lead.history': el => { S.ui.arc = Object.assign(S.ui.arc || {}, { teacher: el.dataset.id, status: '', page: 1 }); go(isRole('LEADER') ? 'archive' : 'all'); },
  'lead.remind': el => {
    const p = person(el.dataset.id), lps = termLps(viewTerm().term_id).filter(l => l.user_id === el.dataset.id && l.status !== 'APPROVED');
    const msg = `Assalamu'alaikum ${firstName(p.n)},\n\nTerima kasih atas perencanaan pembelajarannya. Berikut lesson plan yang perlu diperhatikan:\n${lps.slice(0, 6).map(l => `• ${l.chapter_label} — ${STATUS_LABEL[l.status]}${l.catatan_terakhir ? ' (catatan: ' + l.catatan_terakhir + ')' : ''}`).join('\n')}\n\nMari kita jadwalkan sesi pendampingan singkat pekan ini. Silakan buka LMS ICM untuk menindaklanjuti.\n\nSalam,\n${S.me.nama}`;
    modal({ title: 'Pesan mentoring', html: `<div class="mdl-head"><div><h3>Pesan mentoring untuk ${E(p.n)}</h3><div class="text-2 fs-sm">Salin dan kirim melalui WhatsApp/email sekolah.</div></div><button class="btn-icon" data-close aria-label="Tutup">${ic('x-lg')}</button></div><textarea class="form-control" rows="11" id="mentorMsg">${E(msg)}</textarea><div class="mdl-foot"><button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-primary" data-act="copy.field" data-field="mentorMsg">${ic('copy')} Salin Pesan</button></div>` });
  },
  'copy.field': el => { const f = document.getElementById(el.dataset.field); if (f) copyText(f.value); }
});

// ════════════════════════════════════════════════════════════
// BAGIAN 22 · ANTREAN PERSETUJUAN & ARSIP
// ════════════════════════════════════════════════════════════
PAGES.queue = {
  title: 'Antrean Persetujuan', roles: ['LEADER', 'SUPERADMIN'],
  render() {
    const t = viewTerm(), u = S.ui.q = S.ui.q || { tab: 'PENDING', q: '', mapel: '', sort: 'old', page: 1, per: 15 };
    const lps = termLps(t.term_id);
    const base = u.tab === 'PENDING' ? lps.filter(l => l.status === 'PENDING') : u.tab === 'DECIDED' ? lps.filter(l => l.status === 'RETURNED' || l.status === 'APPROVED').sort((a, b) => ts(b.decided_at) - ts(a.decided_at)) : lps;
    let rows = base.filter(l => (!u.mapel || l.mata_pelajaran === u.mapel) && (!u.q || ((person(l.user_id).n || '') + ' ' + l.chapter_label + ' ' + l.sub_label + ' ' + l.kode_dok).toLowerCase().indexOf(u.q.toLowerCase()) >= 0));
    if (u.tab === 'PENDING') rows.sort((a, b) => u.sort === 'old' ? ts(a.submitted_at) - ts(b.submitted_at) : u.sort === 'date' ? ((a.tanggal_ajar || '9') < (b.tanggal_ajar || '9') ? -1 : 1) : ts(b.submitted_at) - ts(a.submitted_at));
    const page = Math.min(u.page, Math.max(1, Math.ceil(rows.length / u.per))), slice = rows.slice((page - 1) * u.per, page * u.per);
    const mapels = uniq(lps.map(l => l.mata_pelajaran));
    prefetchDetails(u.tab === 'PENDING' ? rows.map(l => l.lp_id) : []);
    return `<div class="page-head"><div><div class="eyebrow">Verifikasi & Approval</div><h1 class="mt-1">Antrean Persetujuan</h1><div class="desc">${E(termLabel(t))} · unit ${E(myUnits().map(unitShort).join(', '))}. Buka berkas untuk memberi anotasi langsung di dokumen, lalu kembalikan atau setujui.</div></div></div>
    <div class="tabs">${[['PENDING', 'Menunggu Keputusan', lps.filter(l => l.status === 'PENDING').length], ['DECIDED', 'Sudah Diputuskan', lps.filter(l => l.status === 'RETURNED' || l.status === 'APPROVED').length], ['ALL', 'Semua', lps.length]].map(x => `<button class="tab ${u.tab === x[0] ? 'active' : ''}" data-act="q.tab" data-tab="${x[0]}">${x[1]} <span class="n">${x[2]}</span></button>`).join('')}</div>
    <section class="card-x flush pure"><div class="filter-bar"><div class="input-icon search">${ic('search')}<input class="form-control" data-f="q.q" value="${E(u.q)}" placeholder="Cari nama guru, chapter, atau kode dokumen…"></div>
      <select class="form-select" data-f="q.mapel"><option value="">Semua Mapel</option>${mapels.map(m => `<option value="${m}" ${u.mapel === m ? 'selected' : ''}>${E(refLabel('SUBJECT', m))}</option>`).join('')}</select>
      ${u.tab === 'PENDING' ? `<select class="form-select" data-f="q.sort"><option value="old" ${u.sort === 'old' ? 'selected' : ''}>Urutkan: Menunggu Paling Lama</option><option value="date" ${u.sort === 'date' ? 'selected' : ''}>Tanggal Mengajar Terdekat</option><option value="new" ${u.sort === 'new' ? 'selected' : ''}>Pengajuan Terbaru</option></select>` : ''}</div>
      ${slice.length ? `<div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Guru & Mata Pelajaran</th><th>Chapter & Pertemuan</th><th>${u.tab === 'PENDING' ? 'Waktu Menunggu' : 'Keputusan'}</th><th>Status</th><th class="text-end">Aksi</th></tr></thead><tbody>
        ${u.tab === 'PENDING' ? slice.map(queueRow).join('') : slice.map(l => `<tr class="clickable st-${l.status}" data-go="${l.status === 'PENDING' && isRole('LEADER', 'SUPERADMIN') ? 'review' : 'lp-view'}" data-p-id="${E(l.lp_id)}"><td data-label="Guru">${teacherCell(l.user_id)}</td><td data-label="Chapter"><div class="t-title clamp-1">${E(l.chapter_label)}</div><div class="t-sub">${E(lpMeta(l))} · Rev. ${E(l.revisi_ke)}</div></td><td data-label="Keputusan"><div class="fs-sm">${E(l.decided_at ? relTime(l.decided_at) : '—')}</div><div class="t-sub">${E(l.reviewer_terakhir || '')}</div></td><td data-label="Status">${pill(l.status)}</td><td class="text-end cell-actions"><button class="btn btn-soft btn-sm">${ic('eye')} Lihat</button></td></tr>`).join('')}
      </tbody></table></div><div class="tbl-foot"><span>Menampilkan ${slice.length} dari ${rows.length}</span>${pager(rows.length, page, u.per, 'q.page')}</div>` : emptyState('inbox', 'Tidak ada data', u.tab === 'PENDING' ? 'Semua pengajuan sudah Anda putuskan. Kerja bagus!' : 'Belum ada keputusan pada term ini.')}</section>`;
  }
};
Object.assign(ACT, { 'q.tab': el => { S.ui.q.tab = el.dataset.tab; S.ui.q.page = 1; renderRoute(false); }, 'q.page': el => { S.ui.q.page = +el.dataset.page; renderRoute(false); } });

/** Tabel arsip lintas guru — dipakai pimpinan (Arsip) dan QA/Super (Semua Lesson Plan). */
function archiveHtml(key, title, desc) {
  const t = viewTerm(), u = S.ui[key] = S.ui[key] || { q: '', unit: '', mapel: '', status: '', teacher: '', page: 1, per: 20 };
  if (S.ui.arc && S.ui.arc.teacher && key !== 'arc') { u.teacher = S.ui.arc.teacher; S.ui.arc.teacher = ''; }
  const lps = termLps(t.term_id);
  const rows = lps.filter(l => (!u.unit || l.unit === u.unit) && (!u.mapel || l.mata_pelajaran === u.mapel) && (!u.status || l.status === u.status) && (!u.teacher || l.user_id === u.teacher) && (!u.q || ((person(l.user_id).n || '') + ' ' + l.chapter_label + ' ' + l.sub_label + ' ' + l.kode_dok).toLowerCase().indexOf(u.q.toLowerCase()) >= 0))
    .sort((a, b) => ts(b.diubah_pada || b.submitted_at) - ts(a.diubah_pada || a.submitted_at));
  const page = Math.min(u.page, Math.max(1, Math.ceil(rows.length / u.per))), slice = rows.slice((page - 1) * u.per, page * u.per);
  const units = uniq(lps.map(l => l.unit)), mapels = uniq(lps.map(l => l.mata_pelajaran)), teachers = uniq(lps.map(l => l.user_id));
  return `<div class="page-head"><div><div class="eyebrow">${E(termLabel(t))}</div><h1 class="mt-1">${E(title)}</h1><div class="desc">${E(desc)}</div></div>
    <div class="actions"><button class="btn btn-soft" data-act="arc.csv" data-key="${key}">${ic('file-earmark-spreadsheet')} Ekspor Excel (.csv)</button><button class="btn btn-primary" data-act="arc.pdf" data-key="${key}">${ic('file-earmark-pdf')} Ekspor PDF Rekap</button></div></div>
  <section class="card-x flush pure"><div class="filter-bar"><div class="input-icon search">${ic('search')}<input class="form-control" data-f="${key}.q" value="${E(u.q)}" placeholder="Cari guru, chapter, kode dokumen…"></div>
    ${units.length > 1 ? `<select class="form-select" data-f="${key}.unit"><option value="">Semua Unit</option>${units.map(x => `<option value="${x}" ${u.unit === x ? 'selected' : ''}>${E(unitShort(x))} · ${E(unitLabel(x))}</option>`).join('')}</select>` : ''}
    <select class="form-select" data-f="${key}.mapel"><option value="">Semua Mapel</option>${mapels.map(x => `<option value="${x}" ${u.mapel === x ? 'selected' : ''}>${E(refLabel('SUBJECT', x))}</option>`).join('')}</select>
    <select class="form-select" data-f="${key}.teacher"><option value="">Semua Guru</option>${teachers.map(x => `<option value="${x}" ${u.teacher === x ? 'selected' : ''}>${E(person(x).n || x)}</option>`).join('')}</select>
    <select class="form-select" data-f="${key}.status"><option value="">Semua Status</option>${['PENDING', 'RETURNED', 'APPROVED'].map(x => `<option value="${x}" ${u.status === x ? 'selected' : ''}>${STATUS_LABEL[x]}</option>`).join('')}</select></div>
    ${slice.length ? `<div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Unit</th><th>Guru</th><th>Chapter</th><th>Status</th><th class="text-center">Rev.</th><th>Diajukan / Diputuskan</th><th class="text-end">Aksi</th></tr></thead><tbody>
      ${slice.map(l => `<tr class="clickable st-${l.status}" data-go="${l.status === 'PENDING' && isRole('LEADER', 'SUPERADMIN') ? 'review' : 'lp-view'}" data-p-id="${E(l.lp_id)}"><td data-label="Unit"><span class="chip ${l.unit === 'ECP' ? 'amber' : l.unit === 'MS' ? 'sky' : l.unit === 'PS' ? 'green' : ''}">${E(l.unit)}</span></td><td data-label="Guru">${teacherCell(l.user_id)}</td><td data-label="Chapter" class="col-main"><div class="t-title clamp-1">${E(l.chapter_label)}</div><div class="t-sub text-nowrap">${E(lpMeta(l))} · <span class="mono fs-xs">${E(l.kode_dok)}</span></div></td><td data-label="Status" class="text-nowrap">${pill(l.status)}</td><td data-label="Revisi" class="text-md-center">${E(l.revisi_ke)}</td><td data-label="Tanggal" class="text-nowrap fs-sm"><div>${E(fmtTanggal(l.submitted_at))}</div><div class="t-sub">${l.decided_at && l.status !== 'PENDING' ? ic('check2-circle') + ' ' + E(fmtTanggal(l.decided_at)) : 'Belum diputuskan'}</div></td><td class="text-end cell-actions"><button class="btn btn-soft btn-sm text-nowrap">${ic('eye')} Lihat</button></td></tr>`).join('')}
    </tbody></table></div><div class="tbl-foot"><span>Menampilkan ${slice.length} dari ${rows.length} lesson plan</span>${pager(rows.length, page, u.per, 'arc.page')}</div>` : emptyState('archive', 'Tidak ada lesson plan', 'Ubah filter untuk melihat data lain.')}</section>`;
}
function archiveRows(key) { const u = S.ui[key] || {}, t = viewTerm(); return termLps(t.term_id).filter(l => (!u.unit || l.unit === u.unit) && (!u.mapel || l.mata_pelajaran === u.mapel) && (!u.status || l.status === u.status) && (!u.teacher || l.user_id === u.teacher)); }
PAGES.archive = { title: 'Arsip Lesson Plan', roles: ['LEADER'], render: () => archiveHtml('arc', 'Arsip Lesson Plan', 'Seluruh lesson plan yang sudah diajukan di unit Anda, termasuk yang sudah disetujui dan dikembalikan.') };
PAGES.all = { title: 'Semua Lesson Plan', roles: ['QA', 'SUPERADMIN'], render: () => archiveHtml('all', 'Semua Lesson Plan', 'Data lintas unit ECP, PS, MS, dan HS untuk audit mutu dan akreditasi.') };
Object.assign(ACT, {
  'arc.page': el => { const k = S.route.name === 'archive' ? 'arc' : 'all'; S.ui[k].page = +el.dataset.page; renderRoute(false); },
  'arc.csv': el => { const rows = archiveRows(el.dataset.key); downloadCsv('Rekap_LessonPlan_' + viewTerm().kode.replace(/\W+/g, '_') + '.csv', ['Unit', 'Guru', 'Mapel', 'Kelas', 'Chapter', 'Pertemuan', 'Period', 'Kode Dokumen', 'Status', 'Revisi', 'Jumlah Return', 'Diajukan', 'Diputuskan', 'Reviewer', 'Catatan Terakhir'], rows.map(l => [l.unit, person(l.user_id).n, refLabel('SUBJECT', l.mata_pelajaran), l.kelas, l.chapter_label, l.jumlah_sesi, lpPeriods(l), l.kode_dok, STATUS_LABEL[l.status], l.revisi_ke, l.jumlah_return, l.submitted_at, l.decided_at, l.reviewer_terakhir, l.catatan_terakhir])); },
  'arc.pdf': el => { const rows = archiveRows(el.dataset.key); reportPdf(el, 'Rekap Lesson Plan ' + viewTerm().kode, rows.length + ' dokumen', ['Unit', 'Guru', 'Mapel', 'Chapter', 'Status', 'Rev', 'Diajukan', 'Diputuskan'], rows.map(l => [l.unit, person(l.user_id).n, refLabel('SUBJECT', l.mata_pelajaran), l.chapter_label + ' · ' + (l.jumlah_sesi || 0) + ' pert.', STATUS_LABEL[l.status], l.revisi_ke, fmtTanggal(l.submitted_at), l.status !== 'PENDING' ? fmtTanggal(l.decided_at) : '—'])); }
});
function reportPdf(btn, title, subtitle, cols, rows) {
  setBtnBusy(btn, true, 'Membuat PDF…');
  call('report.pdf', { title, subtitle, cols, rows: rows.map(r => r.map(v => String(v == null ? '' : v))) }).then(r => { downloadBlob(b64ToBlob(r.b64, r.mime), r.name); toast('success', 'PDF rekap terunduh', r.name); })
    .catch(e => toast('error', 'Gagal membuat PDF', e.message)).finally(() => setBtnBusy(btn, false));
}

// ════════════════════════════════════════════════════════════
// BAGIAN 23 · MODUL C — RUANG TINJAU (PDF CANVAS + ANOTASI + KEPUTUSAN)
// ════════════════════════════════════════════════════════════
const FEEDBACK_TEMPLATES = [
  'Mohon lengkapi rubrik penilaian dan instrumen asesmen formatif yang selaras dengan TP.',
  'Strategi diferensiasi proses untuk siswa berkebutuhan khusus belum terlihat; mohon dilengkapi.',
  'Alokasi waktu kegiatan penutup perlu disesuaikan agar refleksi dan kesimpulan berjalan utuh.',
  'Prosedur keselamatan (K3/SOP) dan penggunaan APD belum eksplisit di LKPD.',
  'Integrasi nilai karakter ICM pada kegiatan inti mohon dibuat lebih konkret.',
  'Lampiran LKPD/slide belum lengkap. Mohon unggah versi terbaru.'
];
PAGES.review = {
  title: 'Tinjau Lesson Plan', roles: ['LEADER', 'SUPERADMIN'], noAutoRefresh: true,
  render(p) {
    const d = S.detail[p.id];
    if (!d) return PAGES['lp-view'].render({ id: '__none__' });
    const lp = d.lp, t = d.teacher || {}, ch = d.chapter || {};
    if (lp.status !== 'PENDING') { S.review = { redirect: lp.lp_id }; return ''; }
    const saved = LS.get('ann:' + S.me.user_id + ':' + lp.lp_id, null);
    S.review = { lp_id: lp.lp_id, anns: saved ? saved.anns : [], fb: saved ? saved.fb : '', tool: null };
    const q = pendingQueue(lp.term_id).filter(x => x.lp_id !== lp.lp_id), next = q[0];
    const prevRounds = (d.approvals || []).filter(a => a.keputusan === 'RETURNED');
    return `
    <div class="review-head">
      <button class="link-btn" data-act="rv.back">${ic('arrow-left')} Antrean Persetujuan</button>
      <span class="avatar lg">${E(initials(t.nama))}</span><div class="min-w-0"><b class="d-block">${E(t.nama)}</b><span class="fs-xs text-2">NIP ${E(t.nip || '—')} · ${E(t.jabatan || 'Guru')}</span></div>
      <span class="chip gray">${E(refLabel('SUBJECT', lp.mata_pelajaran))}</span><span class="chip gray">${E(gradeLabel(lp.kelas))}</span><span class="chip sky">${E(ch.kode || '')} · ${E(lpMeta(lp))}</span><span class="chip">Rev. ${E(lp.revisi_ke)}</span>
      <div class="ms-auto d-flex align-items-center gap-2">${pill('PENDING')}
      ${next ? `<button class="btn btn-soft btn-sm text-nowrap" data-go="review" data-p-id="${E(next.lp_id)}" title="Buka berkas berikutnya di antrean">Berikutnya ${ic('arrow-right')}</button>` : ''}</div>
    </div>
    <div class="review-grid">
      <div>${Doc.html()}</div>
      <div class="side-stack">
        <section class="card-x"><div class="card-head"><h3>${ic('pencil-square', 'me-1')} Peralatan Anotasi Dokumen</h3><span class="fs-xs text-2">Mode Reviewer</span></div>
          <div class="tool-grid" role="toolbar" aria-label="Alat anotasi">
            <button class="tool" data-act="rv.tool" data-t="pen" aria-pressed="false">${ic('pen')}Pena</button><button class="tool" data-act="rv.tool" data-t="hl" aria-pressed="false">${ic('highlighter')}Stabilo</button><button class="tool" data-act="rv.tool" data-t="note" aria-pressed="false">${ic('pin-angle')}Catatan</button><button class="tool clear" data-act="rv.clear">${ic('eraser')}Hapus</button></div>
          <div class="d-flex justify-content-between align-items-center mt-2 fs-xs text-2"><span id="rvToolHint">Pilih alat, lalu coret/tandai langsung pada dokumen.</span><button class="link-btn fs-xs" data-act="rv.undo">${ic('arrow-counterclockwise')} Urungkan</button></div></section>
        <section class="card-x"><div class="card-head"><h3>${ic('chat-square-text', 'me-1')} Catatan & Resume Feedback Pimpinan</h3><span class="chip sky">Wajib bila Return</span></div>
          <textarea class="form-control" id="rvFb" rows="5" maxlength="1500" placeholder="Ringkas catatan revisi untuk guru (minimal 20 karakter)…">${E(S.review.fb)}</textarea>
          <div class="d-flex justify-content-between align-items-center mt-2"><span class="counter" id="rvCnt"></span><button class="link-btn fs-sm" data-act="rv.tpl">${ic('lightning-charge')} Gunakan Templat</button></div></section>
        <section class="card-x"><div class="card-head"><h3>${ic('list-check', 'me-1')} Daftar Catatan Aktif <span id="rvAnnN" class="text-2 fw-6"></span></h3></div><div id="rvAnnList"></div></section>
        <section class="card-x"><details ${prevRounds.length ? '' : ''}><summary class="d-flex justify-content-between align-items-center" style="cursor:pointer;list-style:none"><h3 class="fs-6 fw-7 m-0">${ic('clock-history', 'me-1')} Riwayat Revisi Dokumen (${(d.approvals || []).length} aktivitas)</h3>${ic('chevron-down', 'text-3')}</summary><div class="mt-3">${timelineHtml(d.approvals)}</div></details></section>
        <section><div class="decision-bar"><button class="btn btn-amber btn-lg" id="rvReturn" data-act="rv.return">${ic('arrow-counterclockwise')} Kembalikan untuk Revisi</button>${isRole('LEADER') ? `<button class="btn btn-primary btn-lg" data-act="rv.approve">${ic('pen')} Setujui & Lekatkan TTD</button>` : `<button class="btn btn-outline btn-lg" disabled title="Hanya pimpinan unit yang dapat menyetujui">${ic('lock')} Approve khusus pimpinan</button>`}</div>
          <div class="fs-xs text-2 mt-2 text-center">${ic('shield-check')} Tanda tangan elektronik dilekatkan oleh server pada lembar pengesahan resmi.</div></section>
      </div></div>`;
  },
  mount(p) {
    if (!S.detail[p.id]) { loadDetail(p.id).then(() => { if (S.route.name === 'review' && S.route.params.id === p.id) renderRoute(false); }).catch(e => { toast('error', 'Gagal memuat dokumen', e.message); back('queue'); }); return; }
    if (S.review && S.review.redirect) { toast('info', 'Dokumen sudah diputuskan', 'Menampilkan detail dokumen.'); go('lp-view', { id: S.review.redirect }, { replace: true }); return; }
    const d = S.detail[p.id];
    const atts = d.attachments || [];
    $('#docAttBtn').innerHTML = `<button class="btn btn-soft btn-sm" data-act="doc.atts">${ic('paperclip')} Lampiran (${atts.length} berkas) ${ic('chevron-down')}</button>`;
    const strip = $('#docAtts'); strip.hidden = !atts.length;
    strip.innerHTML = `<span class="fs-xs fw-7 text-3 text-nowrap">${ic('folder2-open')} BERKAS LAMPIRAN:</span>` + atts.map(a => `<button class="att-chip" data-act="att.preview" data-id="${E(a.att_id)}"><span class="tp ${E(a.tipe)}">${E(String(a.tipe).toUpperCase())}</span><span><b class="d-block fs-sm">${E(a.nama_file)}</b><span class="fs-xs text-2">${fmtSize(a.ukuran)}</span></span>${ic('eye', 'text-2')}</button>`).join('');
    Doc.mount(detailDocData(d), S.review.anns, { editable: true, onChange: anns => { S.review.anns = anns; rvSave(); paintAnnList(); } });
    $('#rvFb').addEventListener('input', e => { S.review.fb = e.target.value; rvSave(); paintFb(); });
    paintAnnList(); paintFb();
  },
  leave() { Doc.st = null; S.review = null; window.onresize = null; }
};
const rvSave = debounce(() => { if (S.review && S.review.lp_id) LS.set('ann:' + S.me.user_id + ':' + S.review.lp_id, { anns: S.review.anns, fb: S.review.fb, at: Date.now() }); }, 300);
function paintFb() { const n = (S.review.fb || '').trim().length, c = $('#rvCnt'); if (!c) return; c.className = 'counter ' + (n >= 20 ? 'ok' : n ? 'bad' : ''); c.innerHTML = `${ic(n >= 20 ? 'check-circle' : 'info-circle')} ${n} / 20 karakter minimum${n >= 20 ? ' (Terpenuhi)' : ''}`; const r = $('#rvReturn'); if (r) { r.disabled = n < 20; r.title = n < 20 ? 'Isi resume feedback minimal 20 karakter untuk mengembalikan dokumen' : ''; } }
function paintAnnList() {
  const el = $('#rvAnnList'); if (!el || !S.review) return;
  const a = S.review.anns;
  $('#rvAnnN').textContent = `(${a.length} Anotasi)`;
  el.innerHTML = a.length ? a.map(x => `<div class="ann-item"><span class="pg" data-act="ann.goto" data-id="${E(x.id)}" style="cursor:pointer">${x.t === 'note' ? '[' + x.n + '] ' : ''}Hal. ${E(x.page)}</span><span class="tx" data-act="ann.goto" data-id="${E(x.id)}" style="cursor:pointer">${E(annLabel(x))}</span><button class="btn-icon danger" data-act="rv.annDel" data-id="${E(x.id)}" aria-label="Hapus anotasi">${ic('trash3')}</button></div>`).join('')
    : `<div class="text-2 fs-sm">${ic('hand-index')} Belum ada anotasi. Gunakan Pena, Stabilo, atau Catatan pada dokumen.</div>`;
}
Object.assign(ACT, {
  'rv.back': () => back('queue'),
  'rv.tool': el => { Doc.setTool(el.dataset.t); $$('.tool[data-t]').forEach(b => { const on = Doc.st.tool === b.dataset.t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); const h = $('#rvToolHint'); if (h) h.textContent = { pen: 'Tarik untuk mencoret bebas di dokumen.', hl: 'Tarik kotak untuk menandai bagian dengan stabilo.', note: 'Klik pada dokumen untuk menaruh catatan bernomor.' }[Doc.st.tool] || 'Pilih alat, lalu coret/tandai langsung pada dokumen.'; },
  'rv.undo': () => Doc.undo(),
  'rv.clear': async () => { if (!S.review.anns.length) return; if (await confirmDlg({ title: 'Hapus semua anotasi?', message: S.review.anns.length + ' coretan & catatan pada dokumen ini akan dihapus.', ok: 'Hapus semua', tone: 'danger', icon: 'eraser', iconTone: 'rose' })) Doc.clear(); },
  'rv.annDel': el => Doc.remove(el.dataset.id),
  'rv.tpl': el => popMenu(el, `<div class="px-2 py-1 fs-xs text-3 fw-7">TEMPLAT CATATAN</div>${FEEDBACK_TEMPLATES.map((t, i) => `<button class="mi" data-act="rv.tplUse" data-i="${i}" style="white-space:normal">${ic('plus')} ${E(t)}</button>`).join('')}`),
  'rv.tplUse': el => { closeMenu(); const f = $('#rvFb'); const add = FEEDBACK_TEMPLATES[+el.dataset.i]; f.value = (f.value.trim() ? f.value.trim() + '\n' : '') + add; S.review.fb = f.value; rvSave(); paintFb(); f.focus(); },
  'rv.return': () => decisionModal('RETURNED'),
  'rv.approve': () => decisionModal('APPROVED')
});

/** Modal keputusan (Return / Approve) sesuai rancangan, lalu optimistic update. */
function decisionModal(kind) {
  const d = S.detail[S.review.lp_id], lp = d.lp, t = d.teacher || {}, ch = d.chapter || {};
  const ret = kind === 'RETURNED', fb = (S.review.fb || '').trim();
  if (ret && fb.length < 20) { toast('warning', 'Resume feedback wajib', 'Tuliskan catatan revisi minimal 20 karakter.', { page: 1 }); $('#rvFb').focus(); return; }
  const stamp = new Date(), fname = `APPROVED_${safeName(lp.kode_dok)}_${safeName(ch.nama_chapter)}_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-…pdf`;
  const summary = `<div class="inset d-flex gap-3 align-items-center mb-3"><span class="icon-tile sm ${ret ? '' : 'sky'}">${ic(ret ? 'journal-text' : 'clipboard-check')}</span><div class="min-w-0"><b>${E(t.nama)}</b> <span class="text-2 fs-sm">· ${E(refLabel('SUBJECT', lp.mata_pelajaran))} ${E(gradeLabel(lp.kelas))}</span><div class="fs-sm">${E(ch.kode || '')} · ${E(lpMeta(lp))} <span class="chip ms-1">${ret ? 'Rev. ' + E(lp.revisi_ke) : 'Final Rev'}</span></div></div></div>`;
  const html = ret
    ? `<div class="mdl-head"><span class="icon-tile amber" style="width:52px;height:52px;flex-basis:52px;font-size:1.4rem">${ic('arrow-counterclockwise')}</span><span class="chip">${ic('circle-fill', 'fs-xs')} Catatan Koreksi</span></div><h3 style="font-size:1.4rem;font-weight:800">Kembalikan lesson plan ini?</h3><p class="text-2">Berkas akan dikembalikan ke status revisi guru beserta catatan dan ${S.review.anns.length} anotasi peninjauan Anda.</p>${summary}
      <label class="form-label" for="dmFb"><span>Catatan Perbaikan Pimpinan <span class="req">*</span></span><span class="hint" id="dmCnt">${fb.length}/1500</span></label><textarea class="form-control" id="dmFb" rows="5" maxlength="1500">${E(fb)}</textarea>
      <label class="d-flex gap-2 align-items-center mt-3 fs-md"><input type="checkbox" class="form-check-input m-0" id="dmNotify" checked> Kirim notifikasi email ke guru</label>
      <div class="mdl-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-amber-solid" id="dmOk">${ic('send')} Konfirmasi Kembalikan</button></div>`
    : `<div class="mdl-head"><span class="icon-tile sky" style="width:52px;height:52px;flex-basis:52px;font-size:1.4rem">${ic('patch-check')}</span><span class="chip sky">${ic('circle-fill', 'fs-xs')} Siap Diterbitkan</span></div><h3 style="font-size:1.4rem;font-weight:800">Setujui dan lekatkan tanda tangan?</h3><p class="text-2">Dokumen akan disahkan secara digital dan diterbitkan sebagai versi final.</p>${summary}
      <div class="sig-box mb-3"><div class="d-flex justify-content-between fs-xs mb-2"><span class="fw-7" style="color:var(--primary-strong);letter-spacing:.06em">${ic('pen')} TANDA TANGAN ELEKTRONIK</span><span class="chip ${S.me.has_ttd ? 'sky' : 'amber'}">${S.me.has_ttd ? ic('shield-check') + ' Spesimen tersimpan' : ic('exclamation-triangle') + ' Spesimen belum diunggah'}</span></div>
        <svg viewBox="0 0 200 52" aria-hidden="true"><path d="M8 34c14-20 22-22 20-6s8 4 16-6 10 10 18 6 12-18 20-10 6 18 16 10 14-14 22-6 10 10 22 4" fill="none" stroke="var(--primary)" stroke-width="2.4" stroke-linecap="round"/></svg>
        <div class="fw-7">${E(S.me.nama)}</div><div class="fs-xs text-2">${E(S.me.jabatan || 'Pimpinan')} · ${E(fmtTanggal(nowIso()))}</div>${S.me.has_ttd ? '' : `<div class="fs-xs mt-1" style="color:var(--amber-ink)">Tanpa spesimen, PDF memuat nama tercetak + kode verifikasi. <button class="link-btn fs-xs" data-close data-go="profile">Unggah TTD</button></div>`}</div>
      <div class="inset d-grid gap-2 fs-sm mb-3" style="grid-template-columns:minmax(0,1fr)"><div class="d-flex justify-content-between gap-2"><span class="text-2">${ic('clock')} Tanggal Pengesahan:</span><b>${E(fmtTanggal(nowIso(), true))} WIB</b></div><div class="d-flex justify-content-between gap-2"><span class="text-2">${ic('key')} Kode Kredensial:</span><span class="mono" style="color:var(--primary-strong)">ICM-VERIF-••••-••••</span></div><div class="d-flex justify-content-between gap-2"><span class="text-2 text-nowrap">${ic('file-earmark')} Nama Berkas Final:</span><span class="mono clamp-1 min-w-0" title="${E(fname)}">${E(fname)}</span></div></div>
      <label class="form-label" for="dmFb"><span>Catatan persetujuan (opsional)</span></label><textarea class="form-control" id="dmFb" rows="2" maxlength="1500" style="min-height:64px">${E(fb)}</textarea>
      <div class="notice amber mt-3"><span class="ic">${ic('lock')}</span><div>Dokumen yang disetujui akan terkunci. Perubahan substansi memerlukan pengajuan revisi baru (Rev. ${(+lp.revisi_ke || 1) + 1}).</div></div>
      <div class="mdl-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-sky-solid" id="dmOk">${ic('patch-check')} Konfirmasi Persetujuan & Sahkan</button></div>`;
  modal({
    title: ret ? 'Kembalikan untuk revisi' : 'Setujui dokumen', html, onMount: (el, m) => {
      const f = $('#dmFb', el), c = $('#dmCnt', el), okb = $('#dmOk', el);
      const sync = () => { if (c) c.textContent = f.value.length + '/1500'; if (ret) okb.disabled = f.value.trim().length < 20; };
      f.addEventListener('input', sync); sync();
      okb.onclick = () => { const feedback = f.value.trim(); if (ret && feedback.length < 20) return; m.close(); commitDecision(kind, feedback, ret ? $('#dmNotify', el).checked : true); };
    }
  });
}
function commitDecision(kind, feedback, notify) {
  const id = S.review.lp_id, d = S.detail[id], lp = d.lp, anns = clone(S.review.anns || []);
  const sumRow = S.lpsAll.find(l => l.lp_id === id), prev = sumRow ? clone(sumRow) : null;
  const patch = { status: kind, decided_at: nowIso(), decided_by: S.me.user_id, reviewer_terakhir: S.me.nama, catatan_terakhir: feedback || (sumRow ? sumRow.catatan_terakhir : ''), jumlah_return: (sumRow ? sumRow.jumlah_return : 0) + (kind === 'RETURNED' ? 1 : 0) };
  if (sumRow) Object.assign(sumRow, patch);
  S._decided = S._decided || {}; S._decided[id] = patch;
  Object.assign(lp, patch);
  d.approvals = (d.approvals || []).concat([{ approval_id: 'local', revisi_ke: lp.revisi_ke, approver_nama: S.me.nama, approver_jabatan: S.me.jabatan, keputusan: kind, resume_feedback: feedback, waktu: nowIso(), annotations: anns }]);
  if (kind === 'APPROVED') d.decider = { nama: S.me.nama, jabatan: S.me.jabatan };
  LS.del('ann:' + S.me.user_id + ':' + id);
  Outbox.push(kind === 'RETURNED' ? 'approval.return' : 'approval.approve', { lp_id: id, feedback, annotations: anns, notify }, { key: 'dec:' + id, prev, label: kind === 'RETURNED' ? 'Kembalikan' : 'Setujui' });
  persist();
  const next = pendingQueue(lp.term_id).filter(x => x.lp_id !== id)[0];
  toast('success', kind === 'RETURNED' ? 'Dikembalikan ke guru' : 'Disetujui & disahkan', `${person(lp.user_id).n || ''} · ${lp.chapter_label}${next ? ' — membuka berkas berikutnya.' : '.'}`);
  S.review = null;
  if (next) go('review', { id: next.lp_id }, { replace: true }); else go(isRole('LEADER') ? 'lead' : 'queue', {}, { replace: true });
}
function decisionRecon(kind) {
  return {
    ok(data) { const i = S.lpsAll.findIndex(l => l.lp_id === data.lp_id); if (i >= 0) S.lpsAll[i] = Object.assign({}, S.lpsAll[i], data); if (S._decided) delete S._decided[data.lp_id]; delete S.detail[data.lp_id]; if (data.warning) toast('warning', 'Perhatian', data.warning); refreshCurrentQuiet(); },
    fail(err, item) {
      const id = item.payload.lp_id, i = S.lpsAll.findIndex(l => l.lp_id === id);
      if (S._decided) delete S._decided[id];
      if (err.code === 'STATE') { toast('warning', 'Sudah diputuskan pimpinan lain', err.message); delete S.detail[id]; syncNow(false); return; }
      if (i >= 0 && item.prev) S.lpsAll[i] = item.prev;
      delete S.detail[id];
      LS.set('ann:' + S.me.user_id + ':' + id, { anns: item.payload.annotations, fb: item.payload.feedback, at: Date.now() });
      toast('error', (kind === 'RETURNED' ? 'Pengembalian' : 'Persetujuan') + ' gagal', err.message, { action: { label: 'Buka lagi', fn: () => go('review', { id }) } });
      refreshCurrentQuiet();
    }
  };
}
RECON['approval.return'] = decisionRecon('RETURNED');
RECON['approval.approve'] = decisionRecon('APPROVED');

// ════════════════════════════════════════════════════════════
// BAGIAN 24 · DASHBOARD QUALITY ASSURANCE (lintas unit)
// ════════════════════════════════════════════════════════════
const UNIT_ORDER = ['ECP', 'PS', 'MS', 'HS'];
PAGES.qa = {
  title: 'Laporan QA', roles: ['QA', 'SUPERADMIN'],
  render() {
    const t = viewTerm(), u = S.ui.qa = S.ui.qa || { units: UNIT_ORDER.slice() };
    const lps = termLps(t.term_id).filter(l => u.units.indexOf(l.unit) >= 0);
    const drafts = sum(Object.keys(S.draftCounts).filter(k => u.units.indexOf((S.people[k] || {}).u) >= 0).map(k => S.draftCounts[k]));
    const stats = S.chapterStats.filter(c => c.term_id === t.term_id && u.units.indexOf(c.unit) >= 0);
    const target = sum(stats.map(s => s.target));
    const due = lps.filter(l => l.tanggal_ajar && l.tanggal_ajar <= todayYmd());
    const onTime = due.filter(l => l.submitted_at && String(l.submitted_at).slice(0, 10) <= l.tanggal_ajar).length;
    const onTimeRate = pct(onTime, due.length);
    const pend = lps.filter(l => l.status === 'PENDING'), sla = cfg('sla_hari', 2), late = pend.filter(l => waitDays(l.submitted_at) > sla).length;
    const revRate = pct(lps.filter(l => l.jumlah_return > 0).length, lps.length);
    const wk = weekBuckets(t, 8), perWeek = f => wk.map(w => lps.filter(l => f(l, w)).length);
    const subW = perWeek((l, w) => ts(l.submitted_at) >= w.from && ts(l.submitted_at) < w.to);
    const apW = perWeek((l, w) => l.status === 'APPROVED' && ts(l.decided_at) >= w.from && ts(l.decided_at) < w.to);
    const retW = perWeek((l, w) => l.jumlah_return > 0 && ts(l.submitted_at) >= w.from && ts(l.submitted_at) < w.to);
    const pendW = wk.map(w => lps.filter(l => ts(l.submitted_at) < w.to && (!l.decided_at || ts(l.decided_at) >= w.to || l.status === 'PENDING')).length);
    // Tabel per rumpun (unit × mapel)
    const groups = {};
    lps.forEach(l => { const k = l.unit + '|' + l.mata_pelajaran; (groups[k] = groups[k] || { unit: l.unit, mapel: l.mata_pelajaran, lps: [], guru: {} }).lps.push(l); groups[k].guru[l.user_id] = 1; });
    stats.forEach(s => { const k = s.unit + '|' + s.mapel; groups[k] = groups[k] || { unit: s.unit, mapel: s.mapel, lps: [], guru: {} }; groups[k].target = (groups[k].target || 0) + s.target; groups[k].guruN = Math.max(groups[k].guruN || 0, s.guru); });
    const rumpun = Object.keys(groups).map(k => { const g = groups[k], ap = g.lps.filter(l => l.status === 'APPROVED').length, tg = g.target || g.lps.length; return { unit: g.unit, mapel: g.mapel, guru: Math.max(g.guruN || 0, Object.keys(g.guru).length), target: tg, ap, rev: g.lps.filter(l => l.status === 'PENDING').length, ret: g.lps.filter(l => l.status === 'RETURNED').length, ratio: pct(ap, tg) }; })
      .sort((a, b) => UNIT_ORDER.indexOf(b.unit) - UNIT_ORDER.indexOf(a.unit) || b.ratio - a.ratio);
    S.ui.qaRumpun = rumpun;
    const themes = S.themes.slice(0, 5), tMax = Math.max(1, ...themes.map(x => x.count));
    const best = UNIT_ORDER.filter(x => u.units.indexOf(x) >= 0).map(x => { const L = lps.filter(l => l.unit === x), d = L.filter(l => l.tanggal_ajar && l.tanggal_ajar <= todayYmd()); return { x, r: pct(d.filter(l => l.submitted_at && String(l.submitted_at).slice(0, 10) <= l.tanggal_ajar).length, d.length) }; }).sort((a, b) => b.r - a.r)[0];
    const insights = [];
    if (themes[0]) insights.push(`Tema revisi terbanyak: “${themes[0].label}” (${themes[0].count} catatan) — kandidat topik workshop guru.`);
    if (late) insights.push(`${late} dokumen menunggu lebih dari ${sla} hari; ingatkan pimpinan unit terkait.`);
    if (best && best.r) insights.push(`${unitLabel(best.x)} memimpin kepatuhan tepat waktu (${fmtPct(best.r)}).`);
    insights.push(`Rasio revisi ${fmtPct(revRate)} — ${revRate < 10 ? 'di bawah' : 'di atas'} target < 10%.`);
    return `
    <div class="page-head"><div><span class="chip">QA MONITORING</span> <span class="fs-sm text-2">· Siklus Evaluasi Berkelanjutan</span><h1 class="mt-2">Quality Assurance & Kepatuhan Kurikulum</h1><div class="desc">Pemantauan administrasi ajar lintas unit ICM · real-time kinerja RPP · ${E(termLabel(t))}</div></div>
      <div class="actions"><div class="seg" role="group" aria-label="Filter unit">${UNIT_ORDER.map(x => `<button class="${u.units.indexOf(x) >= 0 ? 'on' : ''}" data-act="qa.unit" data-u="${x}" aria-pressed="${u.units.indexOf(x) >= 0}">${x}</button>`).join('')}</div></div></div>
    <div class="stat-grid">
      ${statCard({ ey: 'Total RPP Term ' + (t ? t.term : ''), label: '', icon: 'journal-text', tone: 'sky', value: lps.length + drafts, unit: 'Berkas', spark: sparkline(subW, cssVar('--sky')), cap: `<span class="chip sky">${ic('graph-up-arrow')} ${subW[subW.length - 1] || 0} pekan ini</span> target ${target}` })}
      ${statCard({ ey: 'Kepatuhan Tepat Waktu', label: '', icon: 'send-check', value: fmtPct(onTimeRate).replace('%', ''), unit: '%', vtone: onTimeRate >= 90 ? 'primary' : 'amber', spark: sparkline(apW, cssVar('--btn-bg')), cap: `${onTime}/${due.length} diajukan sebelum tanggal ajar · target 90%` })}
      ${statCard({ ey: 'Dalam Antrean Review', label: '', icon: 'hourglass-split', tone: 'amber', value: pend.length, unit: 'Berkas', spark: sparkline(pendW, cssVar('--amber')), cap: late ? `<span class="pill pill-PENDING plain">${late} melewati SLA ${sla} hari</span>` : '<span class="dot green"></span> Semua dalam SLA' })}
      ${statCard({ ey: 'Tingkat Revisi RPP', label: '', icon: 'arrow-repeat', tone: 'rose', value: fmtPct(revRate).replace('%', ''), unit: '%', vtone: revRate < 10 ? 'primary' : 'rose', spark: sparkline(retW, cssVar('--rose')), cap: `(Target &lt; 10%) <span class="chip ${revRate < 10 ? 'green' : 'rose'}">${revRate < 10 ? 'Kualitas baik' : 'Perlu perhatian'}</span>` })}
    </div>
    <section class="card-x pure mb-4"><div class="card-head flex-wrap"><div><h3>Kepatuhan Penyerahan per Unit ICM <span class="chip sky ms-1">Tepat Waktu vs Keterlambatan</span></h3><div class="sub">Persentase RPP disetujui/diajukan tepat waktu dibandingkan RPP terlambat atau direvisi per jenjang.</div></div>${best && best.r ? `<span class="chip">${ic('trophy')} ${E(unitLabel(best.x))}: ${fmtPct(best.r)} kepatuhan tertinggi</span>` : ''}</div><div style="height:280px"><canvas id="chUnits" aria-label="Grafik kepatuhan per unit"></canvas></div></section>
    <div class="row g-4">
      <div class="col-xl-8"><section class="card-x flush pure h-100"><div class="d-flex flex-wrap gap-2 justify-content-between align-items-start p-4 pb-3"><div><h3 class="fs-5 fw-8">Data Kepatuhan RPP per Rumpun</h3><div class="fs-sm text-2">Rincian administrasi per mata pelajaran · ${E(termLabel(t))}</div></div><div class="d-flex gap-2 flex-wrap"><button class="btn btn-soft btn-sm" data-act="qa.csv">${ic('file-earmark-spreadsheet')} Ekspor Excel (.csv)</button><button class="btn btn-primary btn-sm" data-act="qa.pdf">${ic('file-earmark-pdf')} Ekspor PDF Rekap QA</button></div></div>
        ${rumpun.length ? `<div class="tbl-wrap"><table class="tbl rtable compact"><thead><tr><th>Unit</th><th>Mata Pelajaran</th><th class="text-center">Guru</th><th class="text-center">Target</th><th class="text-center">Disetujui</th><th class="text-center">Review</th><th class="text-center">Revisi</th><th>Kepatuhan</th></tr></thead><tbody>
          ${rumpun.map(r => `<tr><td data-label="Unit"><span class="chip ${r.unit === 'ECP' ? 'amber' : r.unit === 'MS' ? 'sky' : r.unit === 'PS' ? 'green' : ''}">${E(r.unit)}</span></td><td data-label="Mapel" class="fw-6">${E(refLabel('SUBJECT', r.mapel))}</td><td data-label="Guru" class="text-md-center">${r.guru}</td><td data-label="Target" class="text-md-center">${r.target}</td><td data-label="Disetujui" class="fw-7 text-md-center" style="color:var(--primary-strong)">${r.ap}</td><td data-label="Review" class="text-md-center">${r.rev}</td><td data-label="Revisi" class="text-md-center" style="color:${r.ret ? 'var(--rose)' : 'inherit'}">${r.ret}</td><td data-label="Rasio"><div class="d-flex align-items-center gap-2"><div class="bar-mini ${r.ratio >= 90 ? '' : r.ratio >= 60 ? 'sky' : 'amber'}" style="width:64px;flex:none"><span style="width:${Math.min(100, r.ratio)}%"></span></div><b class="fs-sm">${fmtPct(r.ratio)}</b></div></td></tr>`).join('')}</tbody></table></div>`
          : emptyState('table', 'Belum ada data', 'Data muncul setelah guru mengajukan lesson plan.')}</section></div>
      <div class="col-xl-4"><section class="card-x h-100"><div class="card-head"><div><div class="eyebrow">Insight Supervisi</div><h3>Tema Revisi & Catatan Kurikulum</h3><div class="sub">Prioritas pembinaan pedagogis dari catatan pimpinan unit.</div></div><span class="icon-tile sm">${ic('lightbulb')}</span></div>
        ${themes.length ? themes.map((x, i) => `<div class="inset mb-2"><div class="d-flex gap-2 align-items-center"><span class="code-chip" style="min-width:24px;height:24px;font-size:.74rem;border-radius:7px">${i + 1}</span><b class="flex-grow-1 fs-sm">${E(x.label)}</b><span class="chip ${i === 0 ? 'amber' : ''}">${x.count} catatan</span></div><div class="bar-mini ${i === 0 ? '' : i === 1 ? 'sky' : 'amber'} my-2"><span style="width:${(x.count / tMax) * 100}%"></span></div><div class="fs-xs text-2 clamp-2">${E(x.contoh)}</div><div class="fs-xs text-3 mt-1">${Object.keys(x.units).map(k => k + ': ' + x.units[k]).join(' · ')}</div></div>`).join('') : '<div class="text-2 fs-sm">Belum ada catatan revisi.</div>'}
        <div class="insight mt-3" style="padding:14px 16px;align-items:flex-start"><span class="icon-tile sm">${ic('stars')}</span><div><b class="fs-sm">Insight Otomatis</b><ul class="fs-xs">${insights.map(i => `<li>${E(i)}</li>`).join('')}</ul></div></div></section></div>
    </div>`;
  },
  mount() {
    const t = viewTerm(), u = S.ui.qa, lps = termLps(t.term_id);
    whenChart(() => {
      const el = $('#chUnits'); if (!el) return;
      const units = UNIT_ORDER.filter(x => u.units.indexOf(x) >= 0);
      const ok = units.map(x => { const L = lps.filter(l => l.unit === x); return Math.round(pct(L.filter(l => l.status === 'APPROVED' && (!l.tanggal_ajar || String(l.submitted_at).slice(0, 10) <= l.tanggal_ajar)).length, L.length)); });
      const bad = units.map(x => { const L = lps.filter(l => l.unit === x); return Math.round(pct(L.filter(l => l.jumlah_return > 0 || (l.tanggal_ajar && String(l.submitted_at).slice(0, 10) > l.tanggal_ajar)).length, L.length)); });
      const txt = cssVar('--text-2'), grid = cssVar('--border');
      S.charts.units = new Chart(el, { type: 'bar', data: { labels: units.map(x => [unitLabel(x), `${x} (${uniq(lps.filter(l => l.unit === x).map(l => l.user_id)).length} Guru)`]), datasets: [{ label: 'Disetujui tepat waktu', data: ok, backgroundColor: cssVar('--btn-bg'), borderRadius: 8, maxBarThickness: 44 }, { label: 'Revisi / terlambat', data: bad, backgroundColor: cssVar('--sky'), borderRadius: 8, maxBarThickness: 44 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end', labels: { color: txt, usePointStyle: true, pointStyle: 'rectRounded' } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y}%` } } }, scales: { x: { grid: { display: false }, ticks: { color: txt, font: { family: 'Plus Jakarta Sans', weight: 600 } } }, y: { beginAtZero: true, max: 100, ticks: { color: txt, callback: v => v + '%', stepSize: 25 }, grid: { color: grid } } } } });
    });
  }
};
Object.assign(ACT, {
  'qa.unit': el => { const u = S.ui.qa.units, x = el.dataset.u, i = u.indexOf(x); if (i >= 0 && u.length > 1) u.splice(i, 1); else if (i < 0) u.push(x); renderRoute(false); },
  'qa.csv': () => downloadCsv('Kepatuhan_RPP_per_Rumpun_' + viewTerm().kode.replace(/\W+/g, '_') + '.csv', ['Unit', 'Mata Pelajaran', 'Total Guru', 'Target RPP', 'Disetujui', 'Dalam Review', 'Perlu Revisi', 'Rasio Kepatuhan (%)'], (S.ui.qaRumpun || []).map(r => [r.unit, refLabel('SUBJECT', r.mapel), r.guru, r.target, r.ap, r.rev, r.ret, String(r.ratio).replace('.', ',')])),
  'qa.pdf': el => reportPdf(el, 'Rekap Kepatuhan RPP per Rumpun', termLabel(viewTerm()) + ' · Unit ' + S.ui.qa.units.join(', '), ['Unit', 'Mata Pelajaran', 'Guru', 'Target', 'Disetujui', 'Review', 'Revisi', 'Rasio'], (S.ui.qaRumpun || []).map(r => [r.unit, refLabel('SUBJECT', r.mapel), r.guru, r.target, r.ap, r.rev, r.ret, fmtPct(r.ratio)]))
});

// ════════════════════════════════════════════════════════════
// BAGIAN 25 · MASTER DATA (Term, Unit, Mapel, Kelas, ICM, Sequence, Diferensiasi, Durasi)
// ════════════════════════════════════════════════════════════
const MASTER_TABS = [
  { k: 'TERM', l: 'Tahun & Term', i: 'calendar3' }, { k: 'SUBJ_PERIOD', l: 'Period per Mapel', i: 'calendar-week' }, { k: 'UNIT', l: 'Unit & Jenjang', i: 'bank', nilai: 'Alokasi cadangan (menit)' }, { k: 'SUBJECT', l: 'Mata Pelajaran', i: 'book' },
  { k: 'GRADE', l: 'Tingkat Kelas', i: 'mortarboard', desk: 'Kode unit (ECP/PS/MS/HS)' }, { k: 'ICM_VALUE', l: 'ICM Value', i: 'heart' }, { k: 'SEQUENCE', l: 'Sequence of Teaching', i: 'list-ol' },
  { k: 'DIFF_ASPECT', l: 'Aspek Diferensiasi', i: 'grid-3x3' }, { k: 'DIFF_PROFILE', l: 'Profil Diferensiasi', i: 'person-badge' }, { k: 'PERIOD', l: 'Alokasi Sesi (Period)', i: 'hourglass-split', nilai: 'Menit per sesi', desk: 'Berlaku untuk unit (kosongkan = semua; mis. HS,MS)' }, { k: 'DURATION', l: 'Pilihan Durasi', i: 'stopwatch', nilai: 'Menit' }
];
const termPill = st => `<span class="pill pill-${st === 'ACTIVE' ? 'ACTIVE' : st === 'CLOSED' ? 'CLOSED' : 'DRAFT'}">${st === 'ACTIVE' ? 'Active' : st === 'CLOSED' ? 'Closed' : 'Draft'}</span>`;
PAGES.master = {
  title: 'Master Data', roles: ['QA', 'SUPERADMIN'],
  render() {
    const tab = S.ui.mTab || 'TERM', cur = MASTER_TABS.find(x => x.k === tab), at = activeTerm();
    const nextDeadline = S.terms.filter(t => t.batas_rpp && t.batas_rpp >= todayYmd()).sort((a, b) => a.batas_rpp < b.batas_rpp ? -1 : 1)[0];
    const body = tab === 'SUBJ_PERIOD' ? subjPeriodHtml() : tab === 'TERM' ? `
      <div class="stat-grid cols-3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${statCard({ label: 'Total Term Terdaftar', icon: 'calendar-range', value: S.terms.length, unit: 'Siklus', cap: uniq(S.terms.map(t => t.tahun_ajaran)).length + ' tahun akademik' })}
        ${statCard({ label: 'Tenggat Batas RPP Terdekat', icon: 'alarm', tone: 'sky', value: nextDeadline ? Math.max(0, Math.round((ts(nextDeadline.batas_rpp + 'T00:00:00') - ts(todayYmd() + 'T00:00:00')) / 864e5)) : '—', unit: nextDeadline ? 'Hari lagi' : '', vtone: 'sky', cap: nextDeadline ? E(fmtTanggal(nextDeadline.batas_rpp)) + ' · ' + E(nextDeadline.kode) : 'Belum ada tenggat' })}
        ${statCard({ label: 'Status Penguncian', icon: 'lock', tone: 'amber', value: 'Otomatis', vtone: 'amber', cap: S.terms.filter(t => t.status === 'CLOSED').length + ' term tertutup & terkunci' })}
      </div>
      <section class="card-x flush pure"><div class="d-flex flex-wrap gap-2 justify-content-between align-items-start p-4 pb-3"><div><h3 class="fs-5 fw-8">Pengaturan Tahun & Term Akademik <span class="chip ms-1">${S.terms.filter(t => t.status !== 'CLOSED').length} Aktif/Tersimpan</span></h3><div class="fs-sm text-2">Kelola siklus kalender pembelajaran dan jadwal penguncian dokumen.</div></div><button class="btn btn-primary btn-sm" data-act="m.term" data-id="">${ic('plus-circle')} Tambah Term Baru</button></div>
        <div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Term & Tahun Akademik</th><th>Rentang Tanggal</th><th>Minggu Efektif</th><th>Batas RPP</th><th>Status</th><th class="text-end">Aksi</th></tr></thead><tbody>
          ${S.terms.map(t => `<tr><td data-label="Term" class="text-nowrap"><div class="d-flex align-items-center gap-2"><span class="dot ${t.status === 'ACTIVE' ? 'green' : 'gray'}"></span><div><div class="t-title" style="color:${t.status === 'ACTIVE' ? 'var(--primary-strong)' : t.status === 'CLOSED' ? 'var(--text-3)' : 'inherit'}">Term ${E(t.term)}</div><div class="t-sub">${E(t.tahun_ajaran)} · ${E(t.semester)} · ${E(t.unit_scope === 'ALL' ? 'Semua Unit' : String(t.unit_scope).split(',').join(', '))}</div></div></div></td>

            <td data-label="Rentang" class="fs-sm text-nowrap">${E(fmtTanggal(t.tanggal_mulai))} –<div class="t-sub">${E(fmtTanggal(t.tanggal_selesai))}</div></td>
            <td data-label="Minggu Efektif" class="text-nowrap"><b>${+t.minggu_efektif || 0}</b> minggu<div class="t-sub">${t.minggu_manual ? 'diatur QA' : 'otomatis dari tanggal'}</div></td>
            <td data-label="Batas RPP" class="fs-sm text-nowrap" style="color:${t.batas_rpp >= todayYmd() && t.status === 'ACTIVE' ? 'var(--amber-ink)' : 'inherit'}">${t.batas_rpp >= todayYmd() && t.status === 'ACTIVE' ? ic('alarm') + ' ' : ''}${E(fmtTanggal(t.batas_rpp))}</td>
            <td data-label="Status">${termPill(t.status)}</td>
            <td class="text-end cell-actions text-nowrap"><div class="d-inline-flex gap-1 align-items-center">${t.status !== 'CLOSED' ? `<button class="btn-icon" data-act="m.term" data-id="${E(t.term_id)}" aria-label="Edit term">${ic('pencil-square')}</button>` : ''}${t.status === 'ACTIVE' ? `<button class="btn btn-amber btn-sm" data-act="m.termStatus" data-id="${E(t.term_id)}" data-s="CLOSED" title="Tutup & kunci term ini">${ic('lock')} Tutup</button>` : t.status === 'DRAFT' ? `<button class="btn btn-soft btn-sm" data-act="m.termStatus" data-id="${E(t.term_id)}" data-s="ACTIVE">${ic('play-circle')} Aktivasi</button>` : `<button class="btn btn-ghost btn-sm" data-act="m.termStatus" data-id="${E(t.term_id)}" data-s="ACTIVE" title="Buka kembali (aktifkan)">${ic('unlock')} Buka</button>`}</div></td></tr>`).join('')}</tbody></table></div>
        <div class="p-3"><div class="notice amber"><span class="ic">${ic('shield-exclamation')}</span><div class="flex-grow-1"><b>Perhatian Tata Kelola Kurikulum:</b> Menutup term akan mengunci seluruh dokumen Analisis Chapter dan Lesson Plan di dalamnya untuk audit mutu & akreditasi. Mengaktifkan term baru otomatis menutup term aktif sebelumnya.</div></div></div></section>`
      : (() => {
        const refs = S.refs.filter(r => r.kategori === tab).sort((a, b) => a.urutan - b.urutan);
        return `<section class="card-x flush pure"><div class="d-flex flex-wrap gap-2 justify-content-between align-items-start p-4 pb-3"><div><h3 class="fs-5 fw-8">${E(cur.l)} <span class="chip ms-1">${refs.filter(r => r.aktif).length} aktif</span></h3><div class="fs-sm text-2">Nilai referensi yang dipakai di seluruh form. Data nonaktif tetap tersimpan agar dokumen lama tetap utuh.</div></div><button class="btn btn-primary btn-sm" data-act="m.ref" data-id="">${ic('plus-circle')} Tambah</button></div>
        <div class="tbl-wrap"><table class="tbl rtable"><thead><tr><th>Urutan</th><th>Kode</th><th>Label</th><th>${E(cur.desk || 'Deskripsi')}</th>${cur.nilai ? `<th>${E(cur.nilai)}</th>` : ''}<th>Status</th><th class="text-end">Aksi</th></tr></thead><tbody>
          ${refs.map(r => `<tr><td data-label="Urutan">${r.urutan}</td><td data-label="Kode"><span class="mono fw-7">${E(r.kode)}</span></td><td data-label="Label" class="fw-6">${E(r.label)}</td><td data-label="Deskripsi" class="text-2 fs-sm">${E(r.deskripsi || '—')}</td>${cur.nilai ? `<td data-label="${E(cur.nilai)}">${E(r.nilai === '' ? '—' : r.nilai)}</td>` : ''}<td data-label="Status"><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" data-act="m.refToggle" data-id="${E(r.ref_id)}" ${r.aktif ? 'checked' : ''} aria-label="Aktif"></div></td><td class="text-end cell-actions"><button class="btn-icon" data-act="m.ref" data-id="${E(r.ref_id)}" aria-label="Edit">${ic('pencil-square')}</button></td></tr>`).join('')}
        </tbody></table></div></section>`;
      })();
    return `<div class="crumbs"><span>Pengaturan</span><span>›</span><span class="cur">Master Data Kurikulum</span></div>
    <div class="page-head"><div><h1>Pengaturan Master Data</h1></div><div class="actions"><span class="tb-pill">${ic('calendar-check')} Siklus Berjalan: <span style="color:var(--primary-strong)">${E(at ? at.kode : '—')}</span></span><button class="btn btn-soft" data-act="m.audit">${ic('clock-history')} Log Audit</button></div></div>
    <div class="row g-4"><div class="col-lg-3"><section class="card-x" style="padding:16px"><div class="sb-label px-2">Kategori Data</div><div class="d-grid gap-1 mt-1">${MASTER_TABS.map(x => `<button class="nav-i ${tab === x.k ? 'active' : ''}" data-act="m.tab" data-k="${x.k}" style="font-size:.88rem">${ic(x.i)}<span>${E(x.l)}</span></button>`).join('')}</div>
      <div class="inset mt-3 fs-xs"><div class="d-flex gap-2 align-items-center fw-7" style="color:var(--primary-strong)">${ic('shield-check')} Status Sinkronisasi</div><div class="text-2 mt-1">Tersimpan di Google Sheets & cache server berversi. Perubahan langsung berlaku untuk semua pengguna.</div><div class="bar-mini mt-2"><span style="width:${Outbox.items.length ? 60 : 100}%"></span></div></div></section></div>
      <div class="col-lg-9">${body}</div></div>`;
  }
};
/** Tabel period per minggu: baris = mata pelajaran, kolom = tingkat kelas unit terpilih. */
function subjPeriodHtml() {
  const units = UNIT_ORDER.filter(u => S.refs.some(r => r.kategori === 'UNIT' && r.kode === u && r.aktif));
  const unit = S.ui.spUnit && units.indexOf(S.ui.spUnit) >= 0 ? S.ui.spUnit : (units.indexOf('HS') >= 0 ? 'HS' : units[0]);
  S.ui.spUnit = unit;
  const grades = refsOf('GRADE').filter(g => !g.deskripsi || g.deskripsi === unit), subj = refsOf('SUBJECT'), t = activeTerm();
  const w = t ? +t.minggu_efektif || 0 : 0;
  const filled = S.refs.filter(r => r.kategori === 'SUBJ_PERIOD' && r.aktif && String(r.kode).indexOf(unit + '|') === 0).length;
  return `<section class="card-x flush pure"><div class="d-flex flex-wrap gap-2 justify-content-between align-items-start p-4 pb-3"><div><h3 class="fs-5 fw-8">Period per Minggu · Mapel × Kelas <span class="chip ms-1">${filled} terisi</span></h3>
      <div class="fs-sm text-2">Isi jumlah period per minggu setiap mata pelajaran di setiap tingkat kelas. Anggaran period guru dalam satu term = <b>minggu efektif term × period per minggu</b>${t ? ` — contoh ${E(termLabel(t))}: ${w} minggu × 5 period = ${w * 5} period` : ''}. Kosongkan (0) bila mapel tidak diajarkan di kelas itu.</div></div>
      <div class="seg" role="tablist" aria-label="Pilih unit">${units.map(u => `<button class="${u === unit ? 'on' : ''}" data-act="m.spUnit" data-k="${u}" role="tab" aria-selected="${u === unit}">${E(unitShort(u))}</button>`).join('')}</div></div>
    ${grades.length ? `<div class="tbl-wrap"><table class="tbl sp-grid"><thead><tr><th>Mata Pelajaran</th>${grades.map(g => `<th class="text-center">${E(g.label)}</th>`).join('')}</tr></thead><tbody>
      ${subj.map(m => `<tr><td class="fw-6">${E(m.label)}</td>${grades.map(g => { const v = subjPeriod(unit, m.kode, g.kode); return `<td class="text-center"><input type="number" class="form-control sp-in ${v ? 'has' : ''}" min="0" max="40" inputmode="numeric" data-sp="${E(m.kode)}|${E(g.kode)}" value="${v || ''}" placeholder="0" aria-label="${E(m.label)} ${E(g.label)} period per minggu"></td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>` : `<div class="p-4">${emptyState('mortarboard', 'Belum ada tingkat kelas untuk unit ini', 'Tambahkan di tab Tingkat Kelas dengan kode unit ' + E(unit) + '.')}</div>`}
    <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center p-3" style="border-top:1px solid var(--border)"><span class="fs-sm text-2">${ic('info-circle')} Perubahan berlaku untuk anggaran period di Analisis Chapter semua guru unit ${E(unitShort(unit))}.</span><button class="btn btn-primary" data-act="m.spSave">${ic('check2')} Simpan Period ${E(unitShort(unit))}</button></div></section>`;
}
function termDrawer(id) {
  const t = id ? termById(id) : { tahun_ajaran: (activeTerm() || {}).tahun_ajaran || '', term: 1, tanggal_mulai: '', tanggal_selesai: '', batas_rpp: '', unit_scope: 'ALL' };
  drawer({ eyebrow: 'Master Data', title: id ? 'Edit Term' : 'Tambah Term Baru', body: `<form id="termForm" class="d-grid gap-3">
    <div><label class="form-label"><span>Tahun Ajaran <span class="req">*</span></span><span class="hint">format 2026/2027</span></label><input class="form-control" name="tahun_ajaran" value="${E(t.tahun_ajaran)}" placeholder="2026/2027" pattern="\\d{4}/\\d{4}" required></div>
    <div><label class="form-label"><span>Term <span class="req">*</span></span></label><select class="form-select" name="term">${[1, 2, 3, 4].map(n => `<option ${+t.term === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="row g-2"><div class="col-6"><label class="form-label"><span>Tanggal Mulai <span class="req">*</span></span></label><input type="date" class="form-control" name="tanggal_mulai" value="${E(t.tanggal_mulai)}" required></div><div class="col-6"><label class="form-label"><span>Tanggal Selesai <span class="req">*</span></span></label><input type="date" class="form-control" name="tanggal_selesai" value="${E(t.tanggal_selesai)}" required></div></div>
    <div><label class="form-label" for="tMinggu"><span>Minggu Efektif <span class="req">*</span></span><span class="hint" id="tMingguHint">otomatis dari tanggal: ${autoWeeks(t.tanggal_mulai, t.tanggal_selesai) || '—'} minggu</span></label>
      <div class="d-flex gap-2"><input id="tMinggu" type="number" min="1" max="30" class="form-control" name="minggu_efektif" value="${E(t.minggu_manual ? t.minggu_efektif : (autoWeeks(t.tanggal_mulai, t.tanggal_selesai) || ''))}"><button type="button" class="btn btn-soft text-nowrap" id="tMingguAuto">${ic('calculator')} Hitung dari tanggal</button></div>
      <div class="fs-xs text-2 mt-1">Kurangi bila ada libur, ujian, atau kegiatan sekolah. Dipakai untuk menghitung anggaran period: minggu efektif × period per minggu tiap mapel.</div></div>
    <div><label class="form-label"><span>Batas Akhir Analisis/RPP</span></label><input type="date" class="form-control" name="batas_rpp" value="${E(t.batas_rpp)}"></div>
    <div><label class="form-label"><span>Cakupan Unit</span></label><div class="chipcards">${['ALL'].concat(UNIT_ORDER).map(u => `<label class="chipcard ${String(t.unit_scope).split(',').indexOf(u) >= 0 ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" name="unit_scope" value="${u}" class="d-none" ${String(t.unit_scope).split(',').indexOf(u) >= 0 ? 'checked' : ''}>${u === 'ALL' ? 'Semua Unit' : u}</label>`).join('')}</div></div>
    <div id="termErr" class="field-err" hidden></div></form>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="termSave">${ic('check2')} Simpan</button>`,
    onMount: (el, d) => {
      el.addEventListener('change', e => { if (e.target.name === 'unit_scope') e.target.closest('.chipcard').classList.toggle('on', e.target.checked); });
      const autoW = () => { const f = $('#termForm', el); return autoWeeks(f.tanggal_mulai.value, f.tanggal_selesai.value); };
      el.addEventListener('input', e => { if (e.target.name === 'tanggal_mulai' || e.target.name === 'tanggal_selesai') { const h = $('#tMingguHint', el); if (h) h.textContent = 'otomatis dari tanggal: ' + (autoW() || '—') + ' minggu'; } });
      $('#tMingguAuto', el).onclick = () => { const v = autoW(); if (v) $('#tMinggu', el).value = v; };
      $('#termSave', el).onclick = () => {
        const f = $('#termForm', el), fd = new FormData(f), err = $('#termErr', el);
        const p = { term_id: id || '', tahun_ajaran: fd.get('tahun_ajaran').trim(), term: +fd.get('term'), tanggal_mulai: fd.get('tanggal_mulai'), tanggal_selesai: fd.get('tanggal_selesai'), batas_rpp: fd.get('batas_rpp'), minggu_efektif: +fd.get('minggu_efektif') || 0, unit_scope: fd.getAll('unit_scope').indexOf('ALL') >= 0 || !fd.getAll('unit_scope').length ? 'ALL' : fd.getAll('unit_scope').join(',') };
        const bad = !/^\d{4}\/\d{4}$/.test(p.tahun_ajaran) ? 'Tahun ajaran harus berformat 2026/2027.' : (!p.tanggal_mulai || !p.tanggal_selesai || p.tanggal_selesai <= p.tanggal_mulai) ? 'Rentang tanggal term tidak valid.' : (p.minggu_efektif && (p.minggu_efektif < 1 || p.minggu_efektif > 30)) ? 'Minggu efektif harus 1–30.' : '';
        if (bad) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + bad; return; }
        const prev = clone(S.terms), tid = id || uid();
        const auto = autoWeeks(p.tanggal_mulai, p.tanggal_selesai), manual = p.minggu_efektif && p.minggu_efektif !== auto;
        if (!manual) p.minggu_efektif = 0;
        const obj = Object.assign({}, id ? termById(id) : { status: 'DRAFT' }, p, { term_id: tid, kode: p.tahun_ajaran + ' - Term ' + p.term, semester: p.term <= 2 ? 'Ganjil' : 'Genap', minggu_efektif: manual ? p.minggu_efektif : auto, minggu_manual: !!manual });
        const i = S.terms.findIndex(t2 => t2.term_id === tid); if (i >= 0) S.terms[i] = obj; else S.terms.unshift(obj);
        p.term_id = tid;
        Outbox.push('term.save', p, { key: 'term:' + tid, prev, label: 'Simpan term' });
        d.close(); toast('success', 'Term disimpan', obj.kode); persist(); renderRoute(false);
      };
    }
  });
}
function refDrawer(id) {
  const tab = S.ui.mTab, cur = MASTER_TABS.find(x => x.k === tab), r = id ? S.refs.find(x => x.ref_id === id) : { kategori: tab, kode: '', label: '', deskripsi: '', nilai: '', urutan: S.refs.filter(x => x.kategori === tab).length + 1, aktif: true };
  drawer({ eyebrow: cur.l, title: id ? 'Edit ' + r.label : 'Tambah ' + cur.l, body: `<form id="refForm" class="d-grid gap-3">
    <div><label class="form-label"><span>Kode <span class="req">*</span></span><span class="hint">unik dalam kategori</span></label><input class="form-control mono" name="kode" value="${E(r.kode)}" required maxlength="30" ${id ? 'readonly' : ''}></div>
    <div><label class="form-label"><span>Label <span class="req">*</span></span></label><input class="form-control" name="label" value="${E(r.label)}" required maxlength="120"></div>
    <div><label class="form-label"><span>${E(cur.desk || 'Deskripsi')}</span></label><input class="form-control" name="deskripsi" value="${E(r.deskripsi)}" maxlength="300"></div>
    ${cur.nilai ? `<div><label class="form-label"><span>${E(cur.nilai)}</span></label><input type="number" class="form-control" name="nilai" value="${E(r.nilai)}" min="0" max="600"></div>` : ''}
    <div><label class="form-label"><span>Urutan tampil</span></label><input type="number" class="form-control" name="urutan" value="${E(r.urutan)}" min="1" max="999"></div>
    <label class="d-flex gap-2 align-items-center"><input type="checkbox" class="form-check-input m-0" name="aktif" ${r.aktif ? 'checked' : ''}> Aktif (muncul di form)</label><div id="refErr" class="field-err" hidden></div></form>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="refSave">${ic('check2')} Simpan</button>`,
    onMount: (el, d) => {
      $('#refSave', el).onclick = () => {
        const fd = new FormData($('#refForm', el)), err = $('#refErr', el);
        const p = { ref_id: id || uid(), kategori: tab, kode: String(fd.get('kode')).trim(), label: String(fd.get('label')).trim(), deskripsi: String(fd.get('deskripsi') || '').trim(), nilai: fd.get('nilai') === null || fd.get('nilai') === '' ? '' : +fd.get('nilai'), urutan: +fd.get('urutan') || 99, aktif: !!fd.get('aktif') };
        if (!p.kode || !p.label) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' Kode dan label wajib diisi.'; return; }
        if (S.refs.some(x => x.kategori === tab && x.kode.toLowerCase() === p.kode.toLowerCase() && x.ref_id !== p.ref_id)) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' Kode sudah dipakai.'; return; }
        const prev = clone(S.refs), i = S.refs.findIndex(x => x.ref_id === p.ref_id);
        if (i >= 0) S.refs[i] = p; else S.refs.push(p);
        Outbox.push('ref.save', p, { key: 'ref:' + p.ref_id, prev, label: 'Simpan master' });
        d.close(); toast('success', 'Master data disimpan', p.label); persist(); renderRoute(false);
      };
    }
  });
}
Object.assign(ACT, {
  'm.tab': el => { S.ui.mTab = el.dataset.k; renderRoute(false); },
  'm.spUnit': el => { S.ui.spUnit = el.dataset.k; renderRoute(false); },
  'm.spSave': () => {
    const unit = S.ui.spUnit, cells = $$('[data-sp]').map(i => { const [mapel, kelas] = i.dataset.sp.split('|'); return { mapel, kelas, nilai: Math.max(0, Math.min(40, Math.round(+i.value || 0))) }; });
    const prev = clone(S.refs);
    // Optimistic: perbarui master lokal agar anggaran di Analisis Chapter langsung berubah
    cells.forEach(c => { const kode = [unit, c.mapel, c.kelas].join('|'), r = S.refs.find(x => x.kategori === 'SUBJ_PERIOD' && x.kode === kode); if (r) { r.nilai = c.nilai; r.aktif = c.nilai > 0; } else if (c.nilai > 0) S.refs.push({ ref_id: uid(), kategori: 'SUBJ_PERIOD', kode, label: refLabel('SUBJECT', c.mapel) + ' · ' + gradeLabel(c.kelas), deskripsi: unit, nilai: c.nilai, urutan: 99, aktif: true }); });
    Outbox.push('subjperiod.save', { unit, cells }, { key: 'sp:' + unit, prev, label: 'Simpan period per mapel' });
    persist(); renderRoute(false); toast('success', 'Period per mapel disimpan', `${cells.filter(c => c.nilai > 0).length} mapel × kelas terisi untuk ${unitShort(unit)}.`);
  },
  'm.term': el => termDrawer(el.dataset.id),
  'm.ref': el => refDrawer(el.dataset.id),
  'm.refToggle': el => { const r = S.refs.find(x => x.ref_id === el.dataset.id); if (!r) return; const prev = clone(S.refs); r.aktif = el.checked; Outbox.push('ref.save', r, { key: 'ref:' + r.ref_id, prev }); persist(); toast('success', r.aktif ? 'Diaktifkan' : 'Dinonaktifkan', r.label); },
  'm.termStatus': async el => {
    const t = termById(el.dataset.id), s = el.dataset.s;
    const msg = s === 'CLOSED' ? `Seluruh Analisis Chapter dan Lesson Plan pada <b>${E(t.kode)}</b> akan dikunci permanen untuk audit.` : `<b>${E(t.kode)}</b> akan menjadi term aktif. Term aktif saat ini (${E((activeTerm() || {}).kode || '—')}) otomatis ditutup.`;
    if (!(await confirmDlg({ title: s === 'CLOSED' ? 'Tutup term ini?' : 'Aktifkan term ini?', message: msg, ok: s === 'CLOSED' ? 'Tutup & kunci' : 'Aktifkan', tone: s === 'CLOSED' ? 'amber-solid' : 'primary', icon: s === 'CLOSED' ? 'lock' : 'play-circle', iconTone: 'amber' }))) return;
    const prev = clone(S.terms);
    if (s === 'ACTIVE') S.terms.forEach(x => { if (x.status === 'ACTIVE') x.status = 'CLOSED'; });
    t.status = s; if (s === 'ACTIVE') S.activeTermId = t.term_id;
    Outbox.push('term.status', { term_id: t.term_id, status: s }, { key: 'term:' + t.term_id, prev });
    persist(); renderShell(); renderRoute(false); toast('success', s === 'CLOSED' ? 'Term ditutup' : 'Term diaktifkan', t.kode);
  },
  'm.audit': () => {
    const m = modal({ title: 'Log Audit', size: 'wide', html: `<div class="mdl-head"><div><h3>Log Audit & Kepatuhan</h3><div class="text-2 fs-sm">200 aktivitas terakhir — pembuatan, perubahan, submit, return, approve, unduhan.</div></div><button class="btn-icon" data-close aria-label="Tutup">${ic('x-lg')}</button></div><div id="auditBody"><div class="sk sk-block"></div></div>` });
    call('audit.list', { limit: 200 }).then(list => { const b = $('#auditBody', m.el); if (!b) return; b.innerHTML = `<div class="tbl-wrap" style="max-height:62vh;overflow:auto"><table class="tbl"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Keterangan</th></tr></thead><tbody>${list.map(a => `<tr><td class="text-nowrap fs-sm">${E(fmtTanggal(a.waktu, true))}</td><td class="fs-sm">${E(a.user)}</td><td><span class="chip gray mono">${E(a.aksi)}</span></td><td class="fs-sm text-2">${E(a.keterangan)}</td></tr>`).join('')}</tbody></table></div>`; }).catch(e => { const b = $('#auditBody', m.el); if (b) b.innerHTML = emptyState('exclamation-triangle', 'Gagal memuat', E(e.message)); });
  }
});
const masterRecon = setter => ({ ok(data) { setter(data); persist(); if (S.route.name === 'master') refreshCurrentQuiet(); }, fail(err, item) { if (item.prev) setter(item.prev); toast('error', 'Master data gagal disimpan', err.message); refreshCurrentQuiet(); } });
RECON['ref.save'] = masterRecon(d => { S.refs = d; });
RECON['subjperiod.save'] = masterRecon(d => { S.refs = d; });
RECON['term.save'] = masterRecon(d => { S.terms = d; });
RECON['term.status'] = masterRecon(d => { S.terms = d; const a = d.find(t => t.status === 'ACTIVE'); S.activeTermId = a ? a.term_id : S.activeTermId; renderShell(); });

// ════════════════════════════════════════════════════════════
// BAGIAN 26 · PENGGUNA, PERAN & PENGATURAN SISTEM
// ════════════════════════════════════════════════════════════
const NOTIF_KEYS = [['notif_return', 'Lesson Plan Dikembalikan', 'Email langsung ke guru saat ada catatan revisi'], ['notif_submit', 'Pengajuan Baru ke Pimpinan', 'Email ke pimpinan unit saat guru mengajukan'], ['notif_approve', 'Notifikasi Pengesahan Resmi', 'Email ke guru saat lesson plan disetujui'], ['notif_digest', 'Ringkasan Harian Antrean', 'Pimpinan menerima ringkasan dokumen > SLA'], ['notif_weekly', 'Pengingat Mingguan Guru', 'Senin pagi: sesi yang belum memiliki lesson plan']];
PAGES.users = {
  title: 'Pengguna & Sistem', roles: ['QA', 'SUPERADMIN'],
  render() {
    const u = S.ui.us = S.ui.us || { q: '', unit: '', role: '', status: 'Y', page: 1, per: 25, sel: {} };
    const sup = isRole('SUPERADMIN'), all = S.users;
    const rows = all.filter(x => (!u.q || (x.nama + ' ' + x.email + ' ' + x.nip).toLowerCase().indexOf(u.q.toLowerCase()) >= 0) && (!u.unit || String(x.unit).split(',').indexOf(u.unit) >= 0 || (u.unit === 'ALL' && x.unit === 'ALL')) && (!u.role || x.peran === u.role) && (!u.status || (u.status === 'Y' ? x.aktif : !x.aktif)));
    const page = Math.min(u.page, Math.max(1, Math.ceil(rows.length / u.per))), slice = rows.slice((page - 1) * u.per, page * u.per);
    const selN = Object.keys(u.sel).filter(k => u.sel[k]).length;
    const c = S.config.all || {};
    const leaders = all.filter(x => x.peran === 'LEADER' && x.aktif);
    const rolePill = r => `<span class="chip ${r === 'LEADER' ? 'sky' : r === 'QA' ? 'amber' : r === 'SUPERADMIN' ? 'green' : ''}">${E(ROLE_LABEL[r] || r)}</span>`;
    return `<div class="crumbs"><span>Pengaturan</span><span>›</span><span class="cur">Pengguna, Peran & Pengaturan Sistem</span></div>
    <div class="page-head"><div><h1>Pengguna, Peran & ${sup ? 'Pengaturan Sistem' : 'Hak Akses'}</h1><div class="desc">Kelola ${all.filter(x => x.aktif).length} akun pendidik, matriks hak akses berjenjang, tanda tangan digital pimpinan, dan jejak audit kepatuhan.</div></div>
      <div class="actions"><button class="btn btn-soft" data-act="us.csv">${ic('download')} Ekspor Daftar (.CSV)</button>${sup ? `<button class="btn btn-primary" data-act="us.edit" data-id="">${ic('person-plus')} Tambah Pengguna Baru</button>` : ''}</div></div>
    ${!sup ? `<div class="notice sky mb-3"><span class="ic">${ic('info-circle')}</span><div>Mode lihat untuk QA. Perubahan akun & peran dilakukan oleh <b>Super Admin IT</b> — gunakan tombol <b>Usulkan perubahan</b> untuk menyalin usulan.</div></div>` : ''}
    <div class="stat-grid">
      ${statCard({ ey: 'Total Akun Aktif', label: '', icon: 'people', value: all.filter(x => x.aktif).length, cap: `<span class="dot"></span> ${all.length} akun terdaftar` })}
      ${statCard({ ey: 'Guru Pengampu', label: '', icon: 'person-video3', value: all.filter(x => x.peran === 'TEACHER' && x.aktif).length, cap: `<span class="dot"></span> ${UNIT_ORDER.length} unit pendidikan` })}
      ${statCard({ ey: 'Pimpinan / Penelaah', label: '', icon: 'shield-check', tone: 'sky', value: leaders.length, cap: `<span class="dot sky"></span> ${leaders.filter(x => x.has_ttd).length} spesimen TTD tersimpan` })}
      ${statCard({ ey: 'QA & Super Admin', label: '', icon: 'shield-lock', tone: 'amber', value: all.filter(x => (x.peran === 'QA' || x.peran === 'SUPERADMIN') && x.aktif).length, cap: '<span class="dot amber"></span> Akses audit penuh' })}
    </div>
    <section class="card-x flush pure mb-4" style="position:relative">
      <div class="filter-bar"><div class="input-icon search">${ic('search')}<input class="form-control" data-f="us.q" value="${E(u.q)}" placeholder="Cari nama, NIP, surel guru…"></div>
        <select class="form-select" data-f="us.unit"><option value="">Unit: Semua</option>${UNIT_ORDER.concat(['ALL']).map(x => `<option value="${x}" ${u.unit === x ? 'selected' : ''}>${x === 'ALL' ? 'Lintas unit' : x}</option>`).join('')}</select>
        <select class="form-select" data-f="us.role"><option value="">Peran: Semua</option>${Object.keys(ROLE_LABEL).map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
        <select class="form-select" data-f="us.status"><option value="">Status: Semua</option><option value="Y" ${u.status === 'Y' ? 'selected' : ''}>Aktif (${all.filter(x => x.aktif).length})</option><option value="N" ${u.status === 'N' ? 'selected' : ''}>Nonaktif</option></select></div>
      <div class="tbl-wrap"><table class="tbl rtable"><thead><tr>${sup ? `<th style="width:44px"><input type="checkbox" class="form-check-input m-0" data-act="us.selAll" ${selN && selN === slice.length ? 'checked' : ''} aria-label="Pilih semua"></th>` : ''}<th>Nama & Identitas NIP</th><th>Surel Institusi</th><th>Unit Sekolah</th><th>Peran Sistem</th><th>Tanda Tangan Digital</th><th>Status Akun</th><th class="text-end">Aksi</th></tr></thead><tbody>
        ${slice.map(x => `<tr>${sup ? `<td>${x.user_id === S.me.user_id ? '' : `<input type="checkbox" class="form-check-input m-0" data-act="us.sel" data-id="${E(x.user_id)}" ${u.sel[x.user_id] ? 'checked' : ''} aria-label="Pilih ${E(x.nama)}">`}</td>` : ''}
          <td data-label="Nama"><div class="d-flex gap-2 align-items-center"><span class="avatar ${avatarTone(x.peran)}">${E(initials(x.nama))}</span><div class="min-w-0"><div class="t-title">${E(x.nama)}</div><div class="t-sub">NIP: ${E(x.nip || '—')}</div></div></div></td>
          <td data-label="Surel" class="fs-sm">${E(x.email)}</td><td data-label="Unit"><span class="chip gray">${E(x.unit === 'ALL' ? 'Semua Unit' : x.unit)}</span></td><td data-label="Peran">${rolePill(x.peran)}</td>
          <td data-label="TTD">${x.peran === 'LEADER' ? (x.has_ttd ? `<span class="chip sky">${ic('patch-check')} Terverifikasi</span>` : `<span class="chip amber">${ic('exclamation-triangle')} Belum diunggah</span>`) : x.peran === 'QA' ? '<span class="chip outline">Pengawas Mutu</span>' : x.peran === 'SUPERADMIN' ? '<span class="chip outline">Sistem Root</span>' : '<span class="text-3 fs-sm">— Belum perlu</span>'}</td>
          <td data-label="Status"><span class="pill ${x.aktif ? 'pill-ACTIVE' : 'pill-CLOSED'}">${x.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
          <td class="text-end cell-actions">${sup ? `<button class="btn-icon" data-act="us.edit" data-id="${E(x.user_id)}" aria-label="Edit">${ic('pencil-square')}</button>` : `<button class="btn-icon" data-act="us.propose" data-id="${E(x.user_id)}" aria-label="Usulkan perubahan" title="Usulkan perubahan">${ic('chat-left-text')}</button>`}</td></tr>`).join('')}
      </tbody></table></div><div class="tbl-foot"><span>Menampilkan ${slice.length} dari ${rows.length} entri</span>${pager(rows.length, page, u.per, 'us.page')}</div>
      ${sup && selN ? `<div style="position:sticky;bottom:12px;display:flex;justify-content:center;padding:0 12px 12px"><div class="d-flex flex-wrap gap-2 align-items-center" style="background:#2B2A3D;color:#fff;border-radius:999px;padding:8px 10px 8px 18px;box-shadow:var(--sh-3)"><span class="fw-7 me-2">${ic('check-circle-fill')} ${selN} Pengguna Terpilih</span>
        <button class="btn btn-sm" style="--bs-btn-color:#fff;--bs-btn-hover-bg:rgba(255,255,255,.12);--bs-btn-hover-color:#fff" data-act="us.bulk" data-op="resetpw">${ic('key')} Reset Password</button>
        <button class="btn btn-sm" style="--bs-btn-color:#fff;--bs-btn-hover-bg:rgba(255,255,255,.12);--bs-btn-hover-color:#fff" data-act="us.bulkMenu">${ic('arrow-left-right')} Ubah Peran / Unit</button>
        <button class="btn btn-sm" style="--bs-btn-color:#fff;--bs-btn-hover-bg:rgba(255,255,255,.12);--bs-btn-hover-color:#fff" data-act="us.bulk" data-op="activate">${ic('person-check')} Aktifkan</button>
        <button class="btn btn-rose-soft btn-sm" data-act="us.bulk" data-op="deactivate">${ic('person-x')} Nonaktifkan</button></div></div>` : ''}
    </section>
    ${sup ? `<div class="row g-4">
      <div class="col-lg-4"><section class="card-x h-100"><div class="card-head"><div><h3>Notifikasi & SLA Review</h3><div class="sub">Kanal email (antrean 5 menit) — lonceng di aplikasi selalu aktif.</div></div><span class="icon-tile sm amber">${ic('bell')}</span></div>
        ${NOTIF_KEYS.map(n => `<div class="d-flex gap-3 align-items-center justify-content-between py-2" style="border-bottom:1px solid var(--border)"><div><b class="fs-sm d-block">${E(n[1])}</b><span class="fs-xs text-2">${E(n[2])}</span></div><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" data-act="cfg.toggle" data-k="${n[0]}" ${c[n[0]] === 'Y' ? 'checked' : ''} aria-label="${E(n[1])}"></div></div>`).join('')}
        <div class="d-flex gap-2 align-items-center mt-3"><label class="fs-sm flex-grow-1" for="cfgSla">SLA (hari) sebelum dianggap mendesak</label><input id="cfgSla" type="number" min="1" max="14" class="form-control" style="width:80px" value="${E(c.sla_hari || 2)}" data-cfg="sla_hari"></div></section></div>
      <div class="col-lg-4"><section class="card-x h-100"><div class="card-head"><div><h3>Tanda Tangan Digital</h3><div class="sub">Spesimen tersimpan di folder Drive terbatas; hanya server yang melekatkannya.</div></div><span class="icon-tile sm">${ic('pen')}</span></div>
        ${leaders.map(l => `<div class="inset d-flex gap-2 align-items-center mb-2"><svg viewBox="0 0 60 24" width="54" height="22" aria-hidden="true"><path d="M2 16c6-10 10-10 9-3s4 2 7-3 5 5 9 3 5-8 9-4 3 8 7 4" fill="none" stroke="${l.has_ttd ? 'var(--primary)' : 'var(--border-strong)'}" stroke-width="1.8" stroke-linecap="round"/></svg><div class="flex-grow-1 min-w-0"><b class="fs-sm d-block clamp-1">${E(l.nama)}</b><span class="fs-xs ${l.has_ttd ? '' : 'text-2'}" style="color:${l.has_ttd ? 'var(--amber-ink)' : ''}">${l.has_ttd ? ic('lock') + ' Terkunci (server)' : E(l.jabatan)}</span></div><button class="btn ${l.has_ttd ? 'btn-ghost' : 'btn-primary'} btn-sm" data-act="sig.upload" data-id="${E(l.user_id)}">${l.has_ttd ? 'Ganti' : 'Unggah'}</button></div>`).join('') || '<div class="text-2 fs-sm">Belum ada akun pimpinan.</div>'}</section></div>
      <div class="col-lg-4"><section class="card-x h-100"><div class="card-head"><div><h3>Audit Log & Kepatuhan</h3><div class="sub">${S.audit.length} aktivitas terbaru</div></div><span class="icon-tile sm sky">${ic('journal-check')}</span></div>
        <div class="tl">${S.audit.slice(0, 7).map(a => `<div class="tl-i ${/APPROVE/.test(a.aksi) ? 'APPROVED' : /RETURN/.test(a.aksi) ? 'RETURNED' : /SUBMIT/.test(a.aksi) ? 'SUBMITTED' : 'RESUBMIT'}"><div class="h"><span class="fs-sm">${E(String(a.waktu).slice(11, 16))} · ${E(a.aksi)}</span></div><div class="b clamp-1">${E(a.user)} — ${E(a.keterangan)}</div></div>`).join('')}</div>
        <button class="link-btn fs-sm mt-3" data-act="m.audit">Lihat Log Lengkap ${ic('arrow-right')}</button></section></div>
    </div>
    <section class="card-x mt-4"><div class="card-head"><div><h3>Identitas Aplikasi & Parameter Akademik</h3><div class="sub">Tersimpan di sheet AppConfig · ID penyimpanan dikelola di Script Properties.</div></div><button class="btn btn-primary btn-sm" data-act="cfg.saveAll">${ic('check2')} Simpan Pengaturan</button></div>
      <div class="row g-3">${[['appName', 'Nama aplikasi'], ['schoolName', 'Nama sekolah'], ['schoolSub', 'Sub-judul kop dokumen'], ['logoUrl', 'URL logo (opsional)']].map(k => `<div class="col-md-${k[0] === 'schoolSub' ? 8 : 4}"><label class="form-label"><span>${E(k[1])}</span></label><input class="form-control" data-cfg="${k[0]}" value="${E(c[k[0]] || '')}"></div>`).join('')}
        <div class="col-md-4"><label class="form-label"><span>Aturan matriks diferensiasi</span></label><select class="form-select" data-cfg="diff_mode"><option value="SATU" ${c.diff_mode !== 'BARIS' ? 'selected' : ''}>Hanya satu dari 9 kotak</option><option value="BARIS" ${c.diff_mode === 'BARIS' ? 'selected' : ''}>Satu pilihan per baris</option></select></div>
        <div class="col-md-4"><label class="form-label"><span>Tampilkan akun demo di login</span></label><select class="form-select" data-cfg="demo_mode"><option value="Y" ${c.demo_mode === 'Y' ? 'selected' : ''}>Ya (mode uji coba)</option><option value="N" ${c.demo_mode !== 'Y' ? 'selected' : ''}>Tidak (produksi)</option></select></div>
        <div class="col-md-8"><label class="form-label" for="cfgAppUrl"><span>Alamat aplikasi (URL GitHub Pages)</span><span class="hint">dipakai tombol "Buka LMS ICM" di email</span></label><div class="d-flex gap-2"><input id="cfgAppUrl" class="form-control" data-cfg="app_url" inputmode="url" value="${E(c.app_url || '')}" placeholder="https://username.github.io/lms-icm/"><button type="button" class="btn btn-soft text-nowrap" data-act="cfg.useHere" title="Isi dengan alamat halaman yang sedang dibuka">${ic('geo-alt')} Alamat ini</button></div></div>
        <div class="col-12"><div class="inset"><div class="d-flex flex-wrap gap-3 align-items-start"><span class="icon-tile sm">${ic('google')}</span><div class="flex-grow-1 min-w-0" style="flex-basis:260px"><b class="d-block">Login Google (opsional)</b><div class="fs-sm text-2">Isi <b>OAuth Client ID</b> (jenis <i>Web application</i>) agar tombol "Masuk dengan Google" muncul di halaman login. Disimpan di Script Properties, bukan di Sheets.</div>
          <div class="fs-sm mt-2">Status: ${(S.config.secrets || {}).GOOGLE_CLIENT_ID && S.config.secrets.GOOGLE_CLIENT_ID.ada ? `<span class="chip green">${ic('check-circle')} Aktif</span> <span class="mono">${E(S.config.secrets.GOOGLE_CLIENT_ID.samar)}</span>` : `<span class="chip gray">Belum diisi</span>`}</div></div>
          <div class="d-flex gap-2 flex-wrap w-100" style="max-width:560px"><input id="secCid" class="form-control flex-grow-1" style="min-width:220px" autocomplete="off" spellcheck="false" placeholder="1234567890-xxxx.apps.googleusercontent.com" aria-label="Google OAuth Client ID"><button type="button" class="btn btn-primary" data-act="sec.save">${ic('check2')} Simpan</button>${(S.config.secrets || {}).GOOGLE_CLIENT_ID && S.config.secrets.GOOGLE_CLIENT_ID.ada ? `<button type="button" class="btn btn-ghost" data-act="sec.del">${ic('x-circle')} Nonaktifkan</button>` : ''}</div></div></div></div>
        <div class="col-md-6"><label class="form-label"><span>ID Spreadsheet Database</span></label><div class="verify-code">${E((S.config.storage || {}).spreadsheetId || '—')}</div></div><div class="col-md-6"><label class="form-label"><span>ID Folder Drive Utama</span></label><div class="verify-code">${E((S.config.storage || {}).folderId || '—')}</div></div></div></section>` : ''}`;
  }
};
function userDrawer(id) {
  const x = id ? S.users.find(y => y.user_id === id) : { email: '', nama: '', nip: '', peran: 'TEACHER', jabatan: '', unit: 'HS', mata_pelajaran: '', kelas: '', aktif: true };
  const units = String(x.unit).split(',');
  drawer({ eyebrow: 'Pengguna', title: id ? 'Edit ' + x.nama : 'Tambah Pengguna Baru', body: `<form id="usForm" class="d-grid gap-3">
    <div><label class="form-label"><span>Nama lengkap & gelar <span class="req">*</span></span></label><input class="form-control" name="nama" value="${E(x.nama)}" required></div>
    <div><label class="form-label"><span>Email (Gmail atau email sekolah) <span class="req">*</span></span></label><input type="email" class="form-control" name="email" value="${E(x.email)}" required></div>
    <div class="row g-2"><div class="col-6"><label class="form-label"><span>NIP</span></label><input class="form-control" name="nip" value="${E(x.nip)}"></div><div class="col-6"><label class="form-label"><span>Peran <span class="req">*</span></span></label><select class="form-select" name="peran" id="usRole">${Object.keys(ROLE_LABEL).map(r => `<option value="${r}" ${x.peran === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div></div>
    <div><label class="form-label"><span>Jabatan</span></label><input class="form-control" name="jabatan" value="${E(x.jabatan)}" placeholder="mis. Guru Biologi / Kepala SMP"></div>
    <div id="usUnitWrap"><label class="form-label"><span>Unit</span><span class="hint">pimpinan boleh lebih dari satu</span></label><div class="chipcards">${UNIT_ORDER.map(u => `<label class="chipcard ${units.indexOf(u) >= 0 ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" name="unit" value="${u}" class="d-none" ${units.indexOf(u) >= 0 ? 'checked' : ''}>${u}</label>`).join('')}</div></div>
    <div class="row g-2"><div class="col-7"><label class="form-label"><span>Mata pelajaran (kode)</span></label><select class="form-select" name="mata_pelajaran"><option value="">—</option>${refsOf('SUBJECT').map(s => `<option value="${s.kode}" ${x.mata_pelajaran === s.kode ? 'selected' : ''}>${E(s.label)}</option>`).join('')}</select></div><div class="col-5"><label class="form-label"><span>Kelas</span></label><select class="form-select" name="kelas"><option value="">—</option>${refsOf('GRADE').map(g => `<option value="${g.kode}" ${String(x.kelas) === g.kode ? 'selected' : ''}>${E(g.label)} (${E(g.deskripsi)})</option>`).join('')}</select></div></div>
    <label class="d-flex gap-2 align-items-center"><input type="checkbox" class="form-check-input m-0" name="aktif" ${x.aktif ? 'checked' : ''}> Akun aktif</label>
    ${id ? '<label class="d-flex gap-2 align-items-center"><input type="checkbox" class="form-check-input m-0" name="reset_password"> Buat kata sandi sementara baru</label>' : '<div class="notice sky fs-sm"><span class="ic">' + ic('key') + '</span><div>Kata sandi sementara dibuat otomatis dan ditampilkan sekali setelah disimpan.</div></div>'}
    <div id="usErr" class="field-err" hidden></div></form>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="usSave">${ic('check2')} Simpan</button>`,
    onMount: (el, d) => {
      el.addEventListener('change', e => { if (e.target.name === 'unit') e.target.closest('.chipcard').classList.toggle('on', e.target.checked); });
      $('#usSave', el).onclick = () => {
        const fd = new FormData($('#usForm', el)), err = $('#usErr', el), btn = $('#usSave', el);
        const p = { user_id: id || '', nama: String(fd.get('nama')).trim(), email: String(fd.get('email')).trim().toLowerCase(), nip: String(fd.get('nip') || '').trim(), peran: fd.get('peran'), jabatan: String(fd.get('jabatan') || '').trim(), unit: fd.getAll('unit').join(','), mata_pelajaran: fd.get('mata_pelajaran'), kelas: fd.get('kelas'), aktif: !!fd.get('aktif'), reset_password: !!fd.get('reset_password') };
        if (p.nama.length < 3 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' Nama (min. 3 karakter) dan email valid wajib diisi.'; return; }
        if ((p.peran === 'TEACHER' || p.peran === 'LEADER') && !p.unit) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' Pilih minimal satu unit.'; return; }
        setBtnBusy(btn, true, 'Menyimpan…');
        call('user.save', p).then(r => { S.users = r.users; persist(); d.close(); renderRoute(false); toast('success', 'Pengguna disimpan', r.user.nama); if (r.tempPassword) showTempPasswords([{ nama: r.user.nama, email: r.user.email, password: r.tempPassword }]); })
          .catch(e => { setBtnBusy(btn, false); err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + E(e.message); });
      };
    }
  });
}
function showTempPasswords(list) {
  const txt = list.map(x => `${x.nama} <${x.email}> — kata sandi sementara: ${x.password}`).join('\n');
  modal({ title: 'Kata sandi sementara', sticky: true, html: `<div class="mdl-head"><div class="d-flex gap-3"><span class="icon-tile amber">${ic('key')}</span><div><h3>Kata sandi sementara</h3><p class="text-2 mt-1 mb-0">Ditampilkan <b>sekali saja</b>. Bagikan secara pribadi dan minta pengguna menggantinya di menu Profil.</p></div></div></div><textarea class="form-control mono" rows="${Math.min(8, list.length + 1)}" id="tmpPw" readonly>${E(txt)}</textarea><div class="mdl-foot"><button class="btn btn-soft" data-act="copy.field" data-field="tmpPw">${ic('copy')} Salin</button><button class="btn btn-primary" data-close>Sudah dicatat</button></div>` });
}
Object.assign(ACT, {
  'us.page': el => { S.ui.us.page = +el.dataset.page; renderRoute(false); },
  'us.edit': el => userDrawer(el.dataset.id),
  'us.sel': el => { S.ui.us.sel[el.dataset.id] = el.checked; renderRoute(false); },
  'us.selAll': el => { const on = el.checked; $$('[data-act="us.sel"]').forEach(c => { S.ui.us.sel[c.dataset.id] = on; }); renderRoute(false); },
  'us.csv': () => downloadCsv('Daftar_Pengguna_LMS_ICM.csv', ['Nama', 'NIP', 'Email', 'Peran', 'Jabatan', 'Unit', 'Mapel', 'Kelas', 'Status', 'TTD'], S.users.map(x => [x.nama, x.nip, x.email, ROLE_LABEL[x.peran], x.jabatan, x.unit, x.mata_pelajaran, x.kelas, x.aktif ? 'Aktif' : 'Nonaktif', x.has_ttd ? 'Ya' : ''])),
  'us.propose': el => { const x = S.users.find(y => y.user_id === el.dataset.id); modal({ title: 'Usulkan perubahan', html: `<div class="mdl-head"><div><h3>Usulan perubahan akun</h3><div class="text-2 fs-sm">Salin dan kirim ke Super Admin IT.</div></div></div><textarea class="form-control" rows="6" id="propTx">Usulan perubahan akun LMS ICM\nNama: ${E(x.nama)}\nEmail: ${E(x.email)}\nPeran saat ini: ${E(ROLE_LABEL[x.peran])} · Unit: ${E(x.unit)}\nUsulan: </textarea><div class="mdl-foot"><button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-primary" data-act="copy.field" data-field="propTx">${ic('copy')} Salin Usulan</button></div>` }); },
  'us.bulkMenu': el => popMenu(el, `<div class="px-2 py-1 fs-xs text-3 fw-7">UBAH PERAN</div>${['TEACHER', 'LEADER', 'QA'].map(r => `<button class="mi" data-act="us.bulk" data-op="role" data-v="${r}">${ic('person-badge')} ${ROLE_LABEL[r]}</button>`).join('')}<div class="sep"></div><div class="px-2 py-1 fs-xs text-3 fw-7">PINDAH UNIT</div>${UNIT_ORDER.map(u => `<button class="mi" data-act="us.bulk" data-op="unit" data-v="${u}">${ic('bank')} ${u} · ${E(unitLabel(u))}</button>`).join('')}`),
  'us.bulk': async el => {
    closeMenu();
    const ids = Object.keys(S.ui.us.sel).filter(k => S.ui.us.sel[k]), op = el.dataset.op, v = el.dataset.v || '';
    if (!ids.length) return;
    const label = { resetpw: 'Reset kata sandi', deactivate: 'Nonaktifkan', activate: 'Aktifkan', role: 'Ubah peran → ' + ROLE_LABEL[v], unit: 'Pindah unit → ' + v }[op];
    if (!(await confirmDlg({ title: label + ' untuk ' + ids.length + ' akun?', message: op === 'resetpw' ? 'Kata sandi baru akan ditampilkan sekali.' : 'Perubahan berlaku segera.', ok: label, tone: op === 'deactivate' ? 'danger' : 'primary', icon: 'people' }))) return;
    toast('info', 'Memproses…', label);
    call('user.bulk', { ids, op, value: v }).then(r => { S.users = r.users; S.ui.us.sel = {}; persist(); renderRoute(false); toast('success', 'Selesai', label + ' · ' + ids.length + ' akun'); if (r.tempPasswords && r.tempPasswords.length) showTempPasswords(r.tempPasswords); }).catch(e => toast('error', 'Gagal', e.message));
  },
  'cfg.toggle': el => { const c = S.config.all = S.config.all || {}; c[el.dataset.k] = el.checked ? 'Y' : 'N'; Outbox.push('config.save', { [el.dataset.k]: c[el.dataset.k] }, { key: 'config' }); toast('success', el.checked ? 'Notifikasi diaktifkan' : 'Notifikasi dimatikan', NOTIF_KEYS.find(n => n[0] === el.dataset.k)[1]); },
  'cfg.useHere': () => { const i = $('#cfgAppUrl'); if (i) { i.value = location.origin + location.pathname.replace(/index\.html$/, ''); i.focus(); } },
  'sec.save': async el => {
    const v = ($('#secCid') || {}).value ? $('#secCid').value.trim() : '';
    if (!v) { toast('warning', 'Client ID kosong', 'Tempel OAuth Client ID dari Google Cloud Console.'); return; }
    setBtnBusy(el, true, 'Menyimpan…');
    try { const r = await call('secret.save', { kunci: 'GOOGLE_CLIENT_ID', nilai: v }); S.config.secrets = Object.assign({}, S.config.secrets, { GOOGLE_CLIENT_ID: r }); LS.del('boot'); toast('success', 'Login Google aktif', 'Tombol Google tampil di halaman login.'); renderRoute(false); }
    catch (e) { setBtnBusy(el, false); toast('error', 'Gagal menyimpan', e.message); }
  },
  'sec.del': async el => {
    if (!await confirmDlg({ title: 'Nonaktifkan login Google?', message: 'Tombol Google hilang dari halaman login. Pengguna tetap bisa masuk dengan email & kata sandi.', ok: 'Nonaktifkan', tone: 'primary', icon: 'google' })) return;
    try { const r = await call('secret.save', { kunci: 'GOOGLE_CLIENT_ID', nilai: '__HAPUS__' }); S.config.secrets = Object.assign({}, S.config.secrets, { GOOGLE_CLIENT_ID: r }); LS.del('boot'); toast('success', 'Login Google dinonaktifkan'); renderRoute(false); }
    catch (e) { toast('error', 'Gagal', e.message); }
  },
  'cfg.saveAll': () => { const c = S.config.all = S.config.all || {}, p = {}; $$('[data-cfg]').forEach(i => { p[i.dataset.cfg] = i.value; c[i.dataset.cfg] = i.value; }); Object.assign(S.config, { appName: p.appName, schoolName: p.schoolName, schoolSub: p.schoolSub, logoUrl: p.logoUrl, diff_mode: p.diff_mode || 'BARIS', sla_hari: +p.sla_hari || 2 }); Outbox.push('config.save', p, { key: 'config' }); persist(); renderShell(); toast('success', 'Pengaturan disimpan', 'Berlaku untuk semua pengguna setelah sinkron.'); },
  'sig.upload': el => uploadSignature(el.dataset.id)
});
RECON['config.save'] = { ok(data) { const keep = S.config.all; S.config = Object.assign({}, S.config, data); if (!data.all && keep) S.config.all = keep; persist(); }, fail(err) { toast('error', 'Pengaturan gagal disimpan', err.message); syncNow(false); } };

async function uploadSignature(userId) {
  const f = await pickFile('image/png,image/jpeg');
  if (!f) return;
  if (!/^image\/(png|jpeg)$/.test(f.type)) { toast('error', 'Format tidak didukung', 'Gunakan PNG (latar transparan) atau JPG.'); return; }
  if (f.size > 1024 * 1024) { toast('error', 'Gambar terlalu besar', 'Maksimal 1 MB.'); return; }
  toast('info', 'Mengunggah spesimen…', f.name);
  try {
    const b64 = await fileToB64(f);
    const r = await call('sig.upload', { user_id: userId, b64, mime: f.type });
    const u = S.users.find(x => x.user_id === r.user_id); if (u) u.has_ttd = true;
    if (S.me.user_id === r.user_id) S.me.has_ttd = true;
    persist(); renderRoute(false); toast('success', 'Spesimen TTD tersimpan', 'Hanya server yang dapat melekatkannya pada PDF final.');
  } catch (e) { toast('error', 'Gagal mengunggah TTD', e.message); }
}

// ════════════════════════════════════════════════════════════
// BAGIAN 27 · PROFIL & KEAMANAN (semua peran)
// ════════════════════════════════════════════════════════════
PAGES.profile = {
  title: 'Profil & Akun',
  render() {
    const me = S.me, dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return `<div class="page-head"><div><h1>Profil & Akun</h1><div class="desc">Identitas, keamanan, tampilan, dan data perangkat Anda.</div></div></div>
    <div class="row g-4"><div class="col-lg-5"><section class="card-x"><div class="d-flex gap-3 align-items-center mb-3"><span class="avatar lg ${avatarTone(me.peran)}" style="width:64px;height:64px;flex-basis:64px;font-size:1.2rem">${E(initials(me.nama))}</span><div><h3 class="fs-5 fw-8">${E(me.nama)}</h3><div class="text-2 fs-sm">${E(me.email)}</div><span class="chip mt-1">${E(ROLE_LABEL[me.peran])}</span></div></div>
      <div class="kv-grid"><div class="kv"><div class="k">NIP</div><div class="v">${E(me.nip || '—')}</div></div><div class="kv"><div class="k">Jabatan</div><div class="v">${E(me.jabatan || '—')}</div></div><div class="kv"><div class="k">Unit</div><div class="v">${E(me.unit === 'ALL' ? 'Semua unit' : myUnits().map(u => unitShort(u) + ' · ' + unitLabel(u)).join(', '))}</div></div><div class="kv"><div class="k">Mata pelajaran</div><div class="v">${E(me.mata_pelajaran ? String(me.mata_pelajaran).split(',').map(m => refLabel('SUBJECT', m.trim())).join(', ') : '—')}</div></div></div>
      <div class="d-flex justify-content-between align-items-center mt-3 inset"><div><b class="fs-sm d-block">Mode gelap</b><span class="fs-xs text-2">Disimpan di perangkat ini</span></div><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" data-act="theme.toggle" ${dark ? 'checked' : ''} aria-label="Mode gelap"></div></div>
      ${me.peran === 'LEADER' ? `<div class="inset mt-2 d-flex gap-3 align-items-center"><span class="icon-tile sm ${me.has_ttd ? 'green' : 'amber'}">${ic('pen')}</span><div class="flex-grow-1"><b class="fs-sm d-block">Spesimen tanda tangan</b><span class="fs-xs text-2">${me.has_ttd ? 'Tersimpan aman di server. Dilekatkan otomatis saat Anda menyetujui.' : 'Belum diunggah — PDF final akan memakai nama tercetak + kode verifikasi.'}</span></div><button class="btn ${me.has_ttd ? 'btn-soft' : 'btn-primary'} btn-sm" data-act="sig.upload" data-id="${E(me.user_id)}">${me.has_ttd ? 'Ganti' : 'Unggah PNG'}</button></div>` : ''}</section></div>
      <div class="col-lg-7"><section class="card-x mb-4"><div class="card-head"><div><h3>Ganti Kata Sandi</h3><div class="sub">Minimal 8 karakter, memuat huruf dan angka.</div></div><span class="icon-tile sm">${ic('shield-lock')}</span></div>
        <form id="pwForm" class="row g-3"><div class="col-12"><label class="form-label" for="pwOld"><span>Kata sandi saat ini</span></label><input id="pwOld" type="password" class="form-control" autocomplete="current-password" required></div><div class="col-md-6"><label class="form-label" for="pwNew"><span>Kata sandi baru</span></label><input id="pwNew" type="password" class="form-control" autocomplete="new-password" minlength="8" required></div><div class="col-md-6"><label class="form-label" for="pwNew2"><span>Ulangi kata sandi baru</span></label><input id="pwNew2" type="password" class="form-control" autocomplete="new-password" required></div><div id="pwErr" class="field-err col-12" hidden></div><div class="col-12 text-end"><button class="btn btn-primary" id="pwBtn" type="submit">${ic('check2')} Perbarui Kata Sandi</button></div></form></section>
      <section class="card-x"><div class="card-head"><div><h3>Data di Perangkat Ini</h3><div class="sub">Snapshot data disimpan di browser agar aplikasi terbuka instan & tetap bisa dipakai saat koneksi lemah.</div></div><span class="icon-tile sm sky">${ic('device-ssd')}</span></div>
        <div class="kv-grid"><div class="kv"><div class="k">Sinkron terakhir</div><div class="v">${E(relTime(new Date(S.lastSync || Date.now()).toISOString()))}</div></div><div class="kv"><div class="k">Antrean sinkron</div><div class="v">${Outbox.items.length ? Outbox.items.length + ' perubahan menunggu' : 'Kosong — semua tersimpan'}</div></div></div>
        <div class="d-flex gap-2 flex-wrap mt-3"><button class="btn btn-soft" data-act="sync.full">${ic('arrow-repeat')} Muat ulang dari server</button><button class="btn btn-ghost" data-act="local.clear">${ic('trash3')} Kosongkan cache perangkat</button></div>
        <div class="fs-xs text-3 mt-3">LMS ICM v${E(cfg('version', BOOT.version || '1.0.0'))} · ${E(cfg('schoolName', ''))}</div></section></div></div>`;
  },
  mount() {
    const f = $('#pwForm'); if (!f) return;
    f.onsubmit = e => {
      e.preventDefault();
      const o = $('#pwOld').value, n = $('#pwNew').value, n2 = $('#pwNew2').value, err = $('#pwErr');
      const bad = n.length < 8 || !/[A-Za-z]/.test(n) || !/\d/.test(n) ? 'Kata sandi baru minimal 8 karakter dan memuat huruf serta angka.' : n !== n2 ? 'Konfirmasi kata sandi tidak sama.' : '';
      if (bad) { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + bad; return; }
      const btn = $('#pwBtn'); setBtnBusy(btn, true, 'Menyimpan…');
      call('me.password', { old: o, nw: n }).then(() => { f.reset(); err.hidden = true; toast('success', 'Kata sandi diperbarui', 'Gunakan kata sandi baru saat masuk berikutnya.'); }).catch(x => { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + E(x.message); }).finally(() => setBtnBusy(btn, false));
    };
  }
};
ACT['local.clear'] = async () => {
  if (Outbox.items.length && !(await confirmDlg({ title: 'Ada perubahan belum terkirim', message: Outbox.items.length + ' perubahan akan hilang bila cache dikosongkan.', ok: 'Tetap kosongkan', tone: 'danger', icon: 'exclamation-triangle', iconTone: 'rose' }))) return;
  try { Object.keys(localStorage).filter(k => k.indexOf('lmsicm:') === 0 && k !== 'lmsicm:theme' && k !== 'lmsicm:token').forEach(k => localStorage.removeItem(k)); } catch (e) { /* abaikan */ }
  Outbox.items = []; Outbox.save();
  toast('success', 'Cache perangkat dikosongkan', 'Memuat ulang data dari server…');
  syncNow(true);
};

// ════════════════════════════════════════════════════════════
// BAGIAN 28 · PENYEMPURNAAN KECIL & INISIALISASI
// ════════════════════════════════════════════════════════════

/** Sisipkan tautan pada editor TP tanpa prompt() bawaan browser. */
ACT['rt.cmd'] = (function (orig) {
  return el => {
    if (el.dataset.cmd !== 'createLink') { orig(el); return; }
    const ed = $(`.rt-edit[data-cflo="${el.dataset.i}"]`); if (!ed) return;
    const sel = window.getSelection(), range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    modal({ title: 'Sisipkan tautan', html: `<div class="mdl-head"><h3>Sisipkan tautan</h3><button class="btn-icon" data-close aria-label="Tutup">${ic('x-lg')}</button></div><label class="form-label" for="lnkUrl"><span>Alamat (https://…)</span></label><input id="lnkUrl" class="form-control" value="https://" autofocus><div id="lnkErr" class="field-err" hidden></div><div class="mdl-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="lnkOk">Sisipkan</button></div>`,
      onMount: (m, api) => {
        const go2 = () => {
          const url = $('#lnkUrl', m).value.trim();
          if (!/^https?:\/\/\S+\.\S+/i.test(url)) { const e = $('#lnkErr', m); e.hidden = false; e.innerHTML = ic('exclamation-circle') + ' Masukkan alamat lengkap diawali https://'; return; }
          api.close();
          ed.focus();
          if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
          if (range && !range.collapsed) document.execCommand('createLink', false, url);
          else document.execCommand('insertHTML', false, `<a href="${E(url)}">${E(url)}</a>`);
          if (S.form) { S.form.f.los[+el.dataset.i].teks_tp = ed.innerHTML; chfLocalSave(); }
        };
        $('#lnkOk', m).onclick = go2;
        $('#lnkUrl', m).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go2(); } };
      } });
  };
})(ACT['rt.cmd']);

/** Status term pada menu pemilih term. */
ACT['term.pick'] = el => {
  const terms = S.terms.filter(t => t.status !== 'DRAFT' || isRole('QA', 'SUPERADMIN'));
  const cur = viewTerm();
  popMenu(el, `<div class="px-2 py-1 fs-xs text-3 fw-7">PILIH TERM UNTUK DITAMPILKAN</div>${terms.map(t => `<button class="mi" data-act="term.set" data-id="${E(t.term_id)}">${ic(cur && t.term_id === cur.term_id ? 'check2-circle' : 'circle')}<span class="flex-grow-1">${E(t.kode)}</span>${termPill(t.status)}</button>`).join('')}`);
};

/** Render ulang halaman setelah data latar berubah — tidak mengganggu form yang sedang diisi. */
refreshCurrentQuiet = function (force) {
  if (!S.me || $('#app').hidden) return;
  renderShell();
  const p = PAGES[S.route.name];
  if (!p || p.noAutoRefresh) { if (S.builder) paintAutosave(); return; }
  const ae = document.activeElement;
  if (!force && ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) && $('#view').contains(ae)) return;
  if (modalStack.length || openMenu) return;
  const y = window.scrollY;
  renderRoute(false);
  window.scrollTo(0, y);
};

/** Hapus draft yang tidak pernah tersinkron vs sudah ada di server. */
ACT['lp.del'] = (function (orig) {
  return async el => {
    const l = lpById(el.dataset.id);
    if (l && !l.kode_dok && Outbox.items.some(i => i.key === 'lp:' + l.lp_id && i.inflight)) { toast('info', 'Sedang menyinkron', 'Coba hapus lagi setelah sinkron selesai.'); return; }
    return orig(el);
  };
})(ACT['lp.del']);

/** Peringatan sebelum menutup tab bila masih ada perubahan yang belum terkirim. */
window.addEventListener('beforeunload', e => {
  if (S.builder && S.builder.dirty) { try { LS.set('draft:' + S.builder.lp.lp_id, { lp: S.builder.lp, at: Date.now() }); } catch (x) { /* abaikan */ } }
  if (Outbox.items.length) { e.preventDefault(); e.returnValue = ''; }
});

/** Penanganan error global → toast (bukan hanya console). */
window.addEventListener('error', e => { if (e && e.message && !/ResizeObserver|Script error/.test(e.message)) { console.error(e.error || e.message); toast('error', 'Terjadi kesalahan tampilan', e.message); } });
window.addEventListener('unhandledrejection', e => { const m = e.reason && e.reason.message; if (m && !(e.reason && e.reason.code)) { console.error(e.reason); toast('error', 'Terjadi kesalahan', m); } });

// ── Mulai aplikasi ──
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

