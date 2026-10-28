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
  migrate(db); save(db); return db;
}
function migrate(db) {
  if (db.schemaVersion === 2) return false;
  const ids = { u1: 'CC1001', u2: 'CC2001', u3: 'CC2002' };
  db.users.forEach(u => { u.userId ||= ids[u.id] || `CC-${u.id}`; });
  for (let day = 1; day <= 6; day++) {
    for (const hour of [10, 14]) {
      const interviewerId = day % 2 ? 'u2' : 'u3';
      const startsAt = future(day, hour);
      if (!db.slots.some(s => s.interviewerId === interviewerId && overlaps(s, { startsAt, duration: 30 }))) {
        db.slots.push({ id: uid(), interviewerId, startsAt, duration: 30, type: ['Software Engineering', 'Behavioral', 'Product Internship'][day % 3] });
      }
    }
  }
  db.schemaVersion = 2;
  return true;
}
function load() { if (!fs.existsSync(DB_PATH)) return seed(); const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); if (migrate(db)) save(db); return db; }
function overlaps(a, b) { const startA = new Date(a.startsAt).getTime(), startB = new Date(b.startsAt).getTime(); return startA < startB + b.duration * 60000 && startB < startA + a.duration * 60000; }
function save(db) { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); const temp = `${DB_PATH}.tmp`; fs.writeFileSync(temp, JSON.stringify(db, null, 2)); fs.renameSync(temp, DB_PATH); }
function publicUser(user) { return { id: user.id, userId: user.userId, name: user.name, role: user.role, bio: user.bio }; }
function userFrom(req, db) { const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie || '')?.[1]; return db.users.find(u => u.id === sessions.get(sid)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 100000) { reject(new Error('Request too large')); req.destroy(); } }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
const safe = value => typeof value === 'string' ? value.trim() : '';
function bookingView(b, db, viewer) { const slot = db.slots.find(s => s.id === b.slotId); const { notes, ...rest } = b; return { ...rest, ...(viewer?.id === b.interviewerId ? { notes: notes || '' } : {}), slot, candidate: publicUser(db.users.find(u => u.id === b.candidateId)), interviewer: publicUser(db.users.find(u => u.id === b.interviewerId)), feedback: db.feedback.find(f => f.bookingId === b.id) || null }; }

async function api(req, res, url) {
  const route = url.pathname;
  try {
    // Read the request before loading state so concurrent mutations cannot use stale data.
    const input = req.method === 'POST' ? await body(req) : {};
    const db = load(); const user = userFrom(req, db);
    if (route === '/api/login' && req.method === 'POST') {
      const found = db.users.find(u => u.userId.toUpperCase() === safe(input.userId).toUpperCase());
      if (!found || typeof input.password !== 'string' || !verify(input.password, found.password) || (input.role && input.role !== found.role)) return fail(res, 401, 'Check your user ID, password and selected role');
      const sid = uid(); sessions.set(sid, found.id);
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
      return json(res, 200, { user: publicUser(found) });
    }
    if (route === '/api/logout' && req.method === 'POST') { const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie || '')?.[1]; sessions.delete(sid); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'); return json(res, 200, { ok: true }); }
    if (!user) return fail(res, 401, 'Please sign in');
    if (route === '/api/me' && req.method === 'GET') return json(res, 200, { user: publicUser(user) });
    if (route === '/api/interviewers' && req.method === 'GET') return json(res, 200, db.users.filter(u => u.role === 'interviewer').map(publicUser));
    if (route === '/api/slots' && req.method === 'GET') return json(res, 200, db.slots.filter(s => new Date(s.startsAt) > new Date() && (user.role === 'interviewer' ? s.interviewerId === user.id : s.status !== 'cancelled')).map(s => ({ ...s, interviewer: publicUser(db.users.find(u => u.id === s.interviewerId)), available: s.status !== 'cancelled' && !db.bookings.some(b => b.slotId === s.id && b.status !== 'cancelled') })).sort((a,b) => a.startsAt.localeCompare(b.startsAt)));
    if (route === '/api/bookings' && req.method === 'GET') return json(res, 200, db.bookings.filter(b => b.candidateId === user.id || b.interviewerId === user.id).map(b => bookingView(b, db, user)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    if (route === '/api/slots' && req.method === 'POST') {
      if (user.role !== 'interviewer') return fail(res, 403, 'Only interviewers can add slots');
      const at = new Date(input.startsAt); const type = safe(input.type);
      if (!Number.isFinite(at.getTime()) || at <= new Date() || !['Software Engineering','Behavioral','Product Internship','General'].includes(type)) return fail(res, 400, 'Choose a future date and valid interview type');
      const duration = Number(input.duration ?? 30), count = Number(input.count ?? 1), gap = Number(input.gap ?? 0);
      if (![15,30,45,60].includes(duration) || !Number.isInteger(count) || count < 1 || count > 8 || ![0,15,30].includes(gap)) return fail(res, 400, 'Choose 1–8 slots, a valid duration and a valid break');
      const slots = Array.from({ length: count }, (_, i) => ({ id: uid(), interviewerId: user.id, startsAt: new Date(at.getTime() + i * (duration + gap) * 60000).toISOString(), type, duration }));
      if (slots.some(next => db.slots.some(s => s.interviewerId === user.id && s.status !== 'cancelled' && overlaps(s, next)))) return fail(res, 409, 'A time overlaps your existing schedule. No slots were created.');
      db.slots.push(...slots); save(db); return json(res, 201, { slots });
    }
    const cancelSlot = /^\/api\/slots\/([^/]+)\/cancel$/.exec(route);
    if (cancelSlot && req.method === 'POST') {
      const slot = db.slots.find(s => s.id === cancelSlot[1]);
      if (!slot) return fail(res, 404, 'Slot not found');
      if (user.role !== 'interviewer' || slot.interviewerId !== user.id) return fail(res, 403, 'Only the owner can cancel this slot');
      if (slot.status === 'cancelled' || new Date(slot.startsAt) <= new Date() || db.bookings.some(b => b.slotId === slot.id && b.status === 'completed')) return fail(res, 409, 'This slot cannot be cancelled');
      slot.status = 'cancelled'; slot.cancelledAt = new Date().toISOString();
      db.bookings.filter(b => b.slotId === slot.id && b.status === 'scheduled').forEach(b => { b.status = 'cancelled'; b.cancelledBy = user.id; b.cancelledAt = slot.cancelledAt; });
      save(db); return json(res, 200, { ok: true });
    }
    if (route === '/api/bookings' && req.method === 'POST') {
      if (user.role !== 'candidate') return fail(res, 403, 'Only candidates can book');
      const slot = db.slots.find(s => s.id === input.slotId);
      if (!slot || slot.status === 'cancelled' || new Date(slot.startsAt) <= new Date()) return fail(res, 404, 'Slot unavailable');
      if (db.bookings.some(b => b.slotId === slot.id && b.status !== 'cancelled')) return fail(res, 409, 'This slot was already booked');
      if (db.bookings.some(b => b.candidateId === user.id && b.status === 'scheduled' && overlaps(db.slots.find(s => s.id === b.slotId), slot))) return fail(res, 409, 'You already have an interview at this time');
      const booking = { id: uid(), slotId: slot.id, candidateId: user.id, interviewerId: slot.interviewerId, goal: safe(input.goal).slice(0, 300), status: 'scheduled', createdAt: new Date().toISOString() };
      db.bookings.push(booking); save(db); return json(res, 201, bookingView(booking, db, user));
    }
    const cancel = /^\/api\/bookings\/([^/]+)\/cancel$/.exec(route);
    if (cancel && req.method === 'POST') { const b = db.bookings.find(x => x.id === cancel[1]); if (!b) return fail(res, 404, 'Booking not found'); if (b.candidateId !== user.id && b.interviewerId !== user.id) return fail(res, 403, 'Not your booking'); if (b.status !== 'scheduled') return fail(res, 409, 'Only scheduled interviews can be cancelled'); b.status = 'cancelled'; b.cancelledBy = user.id; b.cancelledAt = new Date().toISOString(); save(db); return json(res, 200, bookingView(b, db, user)); }
    const complete = /^\/api\/bookings\/([^/]+)\/complete$/.exec(route);
    if (complete && req.method === 'POST') { const b = db.bookings.find(x => x.id === complete[1]); if (!b) return fail(res, 404, 'Booking not found'); if (b.interviewerId !== user.id) return fail(res, 403, 'Only the interviewer can complete this session'); if (b.status !== 'scheduled') return fail(res, 409, 'Session is not scheduled'); b.status = 'completed'; save(db); return json(res, 200, bookingView(b, db, user)); }
    const notes = /^\/api\/bookings\/([^/]+)\/notes$/.exec(route);
    if (notes && req.method === 'POST') { const b = db.bookings.find(x => x.id === notes[1]); if (!b) return fail(res, 404, 'Booking not found'); if (b.interviewerId !== user.id) return fail(res, 403, 'Only the interviewer can save notes'); b.notes = safe(input.notes).slice(0, 2000); save(db); return json(res, 200, bookingView(b, db, user)); }
    const feedback = /^\/api\/bookings\/([^/]+)\/feedback$/.exec(route);
    if (feedback && req.method === 'POST') {
      const b = db.bookings.find(x => x.id === feedback[1]); if (!b) return fail(res, 404, 'Booking not found');
      if (b.interviewerId !== user.id || b.status !== 'completed') return fail(res, 403, 'Complete your interview before giving feedback');
      if (db.feedback.some(f => f.bookingId === b.id)) return fail(res, 409, 'Feedback already submitted');
      const scores = ['communication','structure','confidence'].map(k => Number(input[k]));
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

