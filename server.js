const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_PATH = process.env.CAREERCUE_DB || path.join(ROOT, 'data', 'careercue.json');
const sessions = new Map();
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const fail = (res, code, message) => json(res, code, { error: message });
const uid = () => crypto.randomUUID();
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, stored) => { const [salt, digest] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), crypto.scryptSync(password, salt, 64)); };
const future = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

function seed() {
  const db = {
    users: [
      { id: 'u1', name: 'Aarav Mehta', email: 'candidate@careercue.demo', role: 'candidate', password: hash('Demo123!'), bio: 'Final-year CS student preparing for software engineering roles.' },
      { id: 'u2', name: 'Nisha Rao', email: 'interviewer@careercue.demo', role: 'interviewer', password: hash('Demo123!'), bio: 'Peer mentor focusing on technical and behavioral interviews.' },
      { id: 'u3', name: 'Kabir Shah', email: 'kabir@careercue.demo', role: 'interviewer', password: hash('Demo123!'), bio: 'Product and internship interview practice.' }
    ],
    slots: [
      { id: 's1', interviewerId: 'u2', startsAt: future(2, 16), type: 'Software Engineering', duration: 30 },
      { id: 's2', interviewerId: 'u2', startsAt: future(3, 11), type: 'Behavioral', duration: 30 },
      { id: 's3', interviewerId: 'u3', startsAt: future(4, 15), type: 'Product Internship', duration: 30 }
    ],
    bookings: [], feedback: []
  };
  save(db); return db;
}
function load() { return fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : seed(); }
function save(db) { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); const temp = `${DB_PATH}.tmp`; fs.writeFileSync(temp, JSON.stringify(db, null, 2)); fs.renameSync(temp, DB_PATH); }
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, bio: user.bio }; }
function userFrom(req, db) { const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie || '')?.[1]; return db.users.find(u => u.id === sessions.get(sid)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 100000) { reject(new Error('Request too large')); req.destroy(); } }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
const safe = value => typeof value === 'string' ? value.trim() : '';
function bookingView(b, db, viewer) { const slot = db.slots.find(s => s.id === b.slotId); const { notes, ...rest } = b; return { ...rest, ...(viewer?.id === b.interviewerId ? { notes: notes || '' } : {}), slot, candidate: publicUser(db.users.find(u => u.id === b.candidateId)), interviewer: publicUser(db.users.find(u => u.id === b.interviewerId)), feedback: db.feedback.find(f => f.bookingId === b.id) || null }; }

async function api(req, res, url) {
  const db = load(); const user = userFrom(req, db); const route = url.pathname;
  try {
    if (route === '/api/login' && req.method === 'POST') {
      const input = await body(req); const found = db.users.find(u => u.email === safe(input.email).toLowerCase());
      if (!found || typeof input.password !== 'string' || !verify(input.password, found.password)) return fail(res, 401, 'Invalid email or password');
      const sid = uid(); sessions.set(sid, found.id);
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
      return json(res, 200, { user: publicUser(found) });
    }
    if (route === '/api/logout' && req.method === 'POST') { const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie || '')?.[1]; sessions.delete(sid); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'); return json(res, 200, { ok: true }); }
    if (!user) return fail(res, 401, 'Please sign in');
    if (route === '/api/me' && req.method === 'GET') return json(res, 200, { user: publicUser(user) });
    if (route === '/api/interviewers' && req.method === 'GET') return json(res, 200, db.users.filter(u => u.role === 'interviewer').map(publicUser));
    if (route === '/api/slots' && req.method === 'GET') return json(res, 200, db.slots.filter(s => new Date(s.startsAt) > new Date()).map(s => ({ ...s, interviewer: publicUser(db.users.find(u => u.id === s.interviewerId)), available: !db.bookings.some(b => b.slotId === s.id && b.status !== 'cancelled') })).sort((a,b) => a.startsAt.localeCompare(b.startsAt)));
    if (route === '/api/bookings' && req.method === 'GET') return json(res, 200, db.bookings.filter(b => b.candidateId === user.id || b.interviewerId === user.id).map(b => bookingView(b, db, user)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    if (route === '/api/slots' && req.method === 'POST') {
      if (user.role !== 'interviewer') return fail(res, 403, 'Only interviewers can add slots');
      const input = await body(req); const at = new Date(input.startsAt); const type = safe(input.type);
      if (!Number.isFinite(at.getTime()) || at <= new Date() || !['Software Engineering','Behavioral','Product Internship','General'].includes(type)) return fail(res, 400, 'Choose a future date and valid interview type');
      if (db.slots.some(s => s.interviewerId === user.id && Math.abs(new Date(s.startsAt) - at) < 30 * 60000)) return fail(res, 409, 'This overlaps an existing slot');
      const slot = { id: uid(), interviewerId: user.id, startsAt: at.toISOString(), type, duration: 30 }; db.slots.push(slot); save(db); return json(res, 201, slot);
    }
    if (route === '/api/bookings' && req.method === 'POST') {
      if (user.role !== 'candidate') return fail(res, 403, 'Only candidates can book');
      const input = await body(req); const slot = db.slots.find(s => s.id === input.slotId);
      if (!slot || new Date(slot.startsAt) <= new Date()) return fail(res, 404, 'Slot unavailable');
      if (db.bookings.some(b => b.slotId === slot.id && b.status !== 'cancelled')) return fail(res, 409, 'This slot was already booked');
      const booking = { id: uid(), slotId: slot.id, candidateId: user.id, interviewerId: slot.interviewerId, goal: safe(input.goal).slice(0, 300), status: 'scheduled', createdAt: new Date().toISOString() };
      db.bookings.push(booking); save(db); return json(res, 201, bookingView(booking, db, user));
    }
    const cancel = /^\/api\/bookings\/([^/]+)\/cancel$/.exec(route);
    if (cancel && req.method === 'POST') { const b = db.bookings.find(x => x.id === cancel[1]); if (!b) return fail(res, 404, 'Booking not found'); if (b.candidateId !== user.id && b.interviewerId !== user.id) return fail(res, 403, 'Not your booking'); if (b.status !== 'scheduled') return fail(res, 409, 'Only scheduled interviews can be cancelled'); b.status = 'cancelled'; save(db); return json(res, 200, bookingView(b, db, user)); }
    const complete = /^\/api\/bookings\/([^/]+)\/complete$/.exec(route);
    if (complete && req.method === 'POST') { const b = db.bookings.find(x => x.id === complete[1]); if (!b) return fail(res, 404, 'Booking not found'); if (b.interviewerId !== user.id) return fail(res, 403, 'Only the interviewer can complete this session'); if (b.status !== 'scheduled') return fail(res, 409, 'Session is not scheduled'); b.status = 'completed'; save(db); return json(res, 200, bookingView(b, db, user)); }
    const notes = /^\/api\/bookings\/([^/]+)\/notes$/.exec(route);
    if (notes && req.method === 'POST') { const b = db.bookings.find(x => x.id === notes[1]); if (!b) return fail(res, 404, 'Booking not found'); if (b.interviewerId !== user.id) return fail(res, 403, 'Only the interviewer can save notes'); const input = await body(req); b.notes = safe(input.notes).slice(0, 2000); save(db); return json(res, 200, bookingView(b, db, user)); }
    const feedback = /^\/api\/bookings\/([^/]+)\/feedback$/.exec(route);
    if (feedback && req.method === 'POST') {
      const b = db.bookings.find(x => x.id === feedback[1]); if (!b) return fail(res, 404, 'Booking not found');
      if (b.interviewerId !== user.id || b.status !== 'completed') return fail(res, 403, 'Complete your interview before giving feedback');
      if (db.feedback.some(f => f.bookingId === b.id)) return fail(res, 409, 'Feedback already submitted');
      const input = await body(req); const scores = ['communication','structure','confidence'].map(k => Number(input[k]));
      if (scores.some(n => !Number.isInteger(n) || n < 1 || n > 5) || !safe(input.strengths) || !safe(input.improve)) return fail(res, 400, 'Give scores from 1 to 5 and written feedback');
      const f = { id: uid(), bookingId: b.id, communication: scores[0], structure: scores[1], confidence: scores[2], strengths: safe(input.strengths).slice(0, 1000), improve: safe(input.improve).slice(0, 1000), createdAt: new Date().toISOString() };
      db.feedback.push(f); save(db); return json(res, 201, f);
    }
    return fail(res, 404, 'Not found');
  } catch (e) { return fail(res, 400, e.message); }
}

const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.resolve(ROOT, 'public', '.' + decodeURIComponent(requestPath));
  if (!file.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' }); fs.createReadStream(file).pipe(res);
});
if (require.main === module) server.listen(PORT, () => console.log(`CareerCue running at http://localhost:${PORT}`));
module.exports = server;

