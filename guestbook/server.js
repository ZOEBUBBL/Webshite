// Guestbook + visitor counter for the zo3bubbl3 site.
// Plain Node, no dependencies. Data lives in DATA_DIR (a Railway volume at /data), so redeploys keep it.
//
//   GET  /api/hits?bump=1      -> {hits}        bump adds one visit
//   GET  /api/guestbook        -> {entries}     newest last
//   POST /api/guestbook        {name, message}  -> {entries}
//   DELETE /api/guestbook/:id  (Authorization: Bearer ADMIN_TOKEN)
//   GET  /admin                moderation page
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const START_HITS = +process.env.START_HITS || 665;
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://zoebubbl.github.io,http://localhost:8765')
  .split(',').map(s => s.trim()).filter(Boolean);
const KEEP = 500;          // entries kept on disk
const SHOW = 50;           // entries sent to the page
const GAP_MS = 30 * 1000;  // one post per visitor every 30s

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'state.json');
let state = { hits: START_HITS, entries: [
  { id: 'first', n: 'zo3bubbl3', m: 'you found it. sign below.', t: 0 },
] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { /* first run */ }

let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  }, 250);
};

const lastPost = new Map();
const ipOf = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const spammy = s => /(https?:\/\/|www\.|\.(com|net|ru|xyz|top|io)\b|\[url|<a\s)/i.test(s);
const visible = () => state.entries.slice(-SHOW);

const send = (req, res, code, body, type = 'application/json') => {
  const origin = req.headers.origin;
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (origin && ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(code, headers);
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const readBody = req => new Promise((ok, fail) => {
  let data = '';
  req.on('data', c => { data += c; if (data.length > 4096) { fail(new Error('too big')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(data || '{}')); } catch (e) { fail(e); } });
});

const isAdmin = req => ADMIN_TOKEN && req.headers.authorization === 'Bearer ' + ADMIN_TOKEN;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGINS.includes(req.headers.origin) ? req.headers.origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
    });
    return res.end();
  }

  if (p === '/api/hits' && req.method === 'GET') {
    if (url.searchParams.get('bump')) { state.hits++; save(); }
    return send(req, res, 200, { hits: state.hits });
  }

  if (p === '/api/guestbook' && req.method === 'GET') return send(req, res, 200, { entries: visible() });

  if (p === '/api/guestbook' && req.method === 'POST') {
    let b;
    try { b = await readBody(req); } catch (e) { return send(req, res, 400, { error: 'Bad request.' }); }
    if (b.website) return send(req, res, 200, { entries: visible() }); // honeypot: bots fill every field
    const n = clean(b.name, 30), m = clean(b.message, 240);
    if (!n || !m) return send(req, res, 400, { error: 'Write a name and a message.' });
    if (spammy(n + ' ' + m)) return send(req, res, 400, { error: 'No links in the guestbook, sorry.' });
    const ip = ipOf(req), now = Date.now();
    if (now - (lastPost.get(ip) || 0) < GAP_MS) return send(req, res, 429, { error: 'Slow down a little, then try again.' });
    lastPost.set(ip, now);
    state.entries.push({ id: now.toString(36) + Math.random().toString(36).slice(2, 6), n, m, t: now });
    state.entries = state.entries.slice(-KEEP);
    save();
    return send(req, res, 201, { entries: visible() });
  }

  const del = p.match(/^\/api\/guestbook\/([\w-]+)$/);
  if (del && req.method === 'DELETE') {
    if (!isAdmin(req)) return send(req, res, 401, { error: 'Wrong password.' });
    state.entries = state.entries.filter(e => e.id !== del[1]);
    save();
    return send(req, res, 200, { entries: state.entries });
  }

  if (p === '/api/admin' && req.method === 'GET') {
    if (!isAdmin(req)) return send(req, res, 401, { error: 'Wrong password.' });
    return send(req, res, 200, { entries: state.entries, hits: state.hits });
  }

  if (p === '/admin' && req.method === 'GET') {
    return send(req, res, 200, fs.readFileSync(path.join(__dirname, 'admin.html')), 'text/html; charset=utf-8');
  }

  if (p === '/') return send(req, res, 200, 'zo3bubbl3 guestbook is awake.', 'text/plain');
  send(req, res, 404, { error: 'Not found.' });
}).listen(PORT, () => console.log(`guestbook on :${PORT}, data in ${DATA_DIR}`));
