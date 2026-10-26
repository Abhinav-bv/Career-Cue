const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'careercue-test-'));
process.env.CAREERCUE_DB = path.join(temp, 'test.json');
const server = require('../server');

(async () => {
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  let candidateCookie, interviewerCookie;
  async function request(route, method = 'GET', data, cookie) {
    const r = await fetch(base + route, { method, headers: { ...(data ? { 'Content-Type':'application/json' } : {}), ...(cookie ? { Cookie:cookie } : {}) }, body: data ? JSON.stringify(data) : undefined });
    return { status:r.status, body:await r.json(), cookie:r.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    const page = await fetch(base + '/'); assert.equal(page.status, 200); assert.match(await page.text(), /CareerCue/);
    const c = await request('/api/login','POST',{email:'candidate@careercue.demo',password:'Demo123!'}); assert.equal(c.status,200);candidateCookie=c.cookie;
    const i = await request('/api/login','POST',{email:'interviewer@careercue.demo',password:'Demo123!'}); assert.equal(i.status,200);interviewerCookie=i.cookie;
    const slots = await request('/api/slots','GET',null,candidateCookie); assert.equal(slots.status,200);
    const slotId = slots.body.find(x=>x.interviewer.id==='u2'&&x.available).id;
    const booking = await request('/api/bookings','POST',{slotId,goal:'Practice explaining projects'},candidateCookie); assert.equal(booking.status,201);
    assert.equal((await request('/api/bookings','POST',{slotId},candidateCookie)).status,409);
    assert.equal((await request(`/api/bookings/${booking.body.id}/notes`,'POST',{notes:'Private prep'},candidateCookie)).status,403);
    assert.equal((await request(`/api/bookings/${booking.body.id}/notes`,'POST',{notes:'Ask about tradeoffs'},interviewerCookie)).status,200);
    assert.equal((await request('/api/bookings','GET',null,candidateCookie)).body[0].notes,undefined);
    assert.equal((await request(`/api/bookings/${booking.body.id}/complete`,'POST',null,candidateCookie)).status,403);
    assert.equal((await request(`/api/bookings/${booking.body.id}/complete`,'POST',null,interviewerCookie)).status,200);
    assert.equal((await request(`/api/bookings/${booking.body.id}/feedback`,'POST',{communication:4,structure:5,confidence:3,strengths:'Clear examples',improve:'Shorten the introduction'},interviewerCookie)).status,201);
    const history = await request('/api/bookings','GET',null,candidateCookie);assert.equal(history.body[0].feedback.structure,5);
    assert.equal(JSON.parse(fs.readFileSync(process.env.CAREERCUE_DB, 'utf8')).feedback[0].structure,5);
    console.log('CareerCue smoke test passed: login, booking, conflict, permissions, completion, feedback, persistence.');
  } finally { await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});

