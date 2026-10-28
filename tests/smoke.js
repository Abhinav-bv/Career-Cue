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
    assert.equal((await request('/api/login','POST',{userId:'CC1001',password:'wrong'})).status,401);
    assert.equal((await request('/api/login','POST',{userId:'CC1001',password:'Demo123!',role:'interviewer'})).status,401);
    const c = await request('/api/login','POST',{userId:'cc1001',password:'Demo123!',role:'candidate'}); assert.equal(c.status,200);candidateCookie=c.cookie;
    const i = await request('/api/login','POST',{userId:'CC2001',password:'Demo123!',role:'interviewer'}); assert.equal(i.status,200);interviewerCookie=i.cookie;
    const k = await request('/api/login','POST',{userId:'CC2002',password:'Demo123!'}); assert.equal(k.status,200);
    assert.equal(c.body.user.userId,'CC1001'); assert.equal(c.body.user.password,undefined);
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
    assert.ok(slots.body.filter(s=>s.available).length>=12);
    const mine=await request('/api/slots','GET',null,interviewerCookie);assert.ok(mine.body.every(s=>s.interviewerId==='u2'));
    const startsAt=new Date(Date.now()+20*86400000).toISOString();
    const batch={startsAt,type:'General',duration:45,count:3,gap:15};
    assert.equal((await request('/api/slots','POST',batch,candidateCookie)).status,403);
    assert.equal((await request('/api/slots','POST',{...batch,count:9},interviewerCookie)).status,400);
    assert.equal((await request('/api/slots','POST',{...batch,startsAt:'2000-01-01'},interviewerCookie)).status,400);
    const created=await request('/api/slots','POST',batch,interviewerCookie);assert.equal(created.status,201);assert.equal(created.body.slots.length,3);
    assert.equal(new Date(created.body.slots[1].startsAt)-new Date(created.body.slots[0].startsAt),60*60000);
    const before=(await request('/api/slots','GET',null,interviewerCookie)).body.length;
    assert.equal((await request('/api/slots','POST',{...batch,startsAt:new Date(new Date(startsAt).getTime()-60*60000).toISOString()},interviewerCookie)).status,409);
    assert.equal((await request('/api/slots','GET',null,interviewerCookie)).body.length,before,'Bulk conflict must be atomic');
    const race=await Promise.all([1,2].map(()=>request('/api/bookings','POST',{slotId:created.body.slots[0].id},candidateCookie)));
    assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
    const booked=race.find(x=>x.status===201).body;
    const cross=await request('/api/slots','POST',{...batch,count:1},k.cookie);assert.equal(cross.status,201);
    assert.equal((await request('/api/bookings','POST',{slotId:cross.body.slots[0].id},candidateCookie)).status,409,'Interviewee cannot book overlapping interviews');
    assert.equal((await request(`/api/bookings/${booked.id}/cancel`,'POST',{},k.cookie)).status,403);
    assert.equal((await request(`/api/bookings/${booked.id}/cancel`,'POST',{},candidateCookie)).status,200);
    assert.equal((await request('/api/slots','GET',null,candidateCookie)).body.find(s=>s.id===booked.slotId).available,true);
    const rebook=await request('/api/bookings','POST',{slotId:booked.slotId},candidateCookie);assert.equal(rebook.status,201);
    assert.equal((await request(`/api/slots/${booked.slotId}/cancel`,'POST',{},candidateCookie)).status,403);
    assert.equal((await request(`/api/slots/${booked.slotId}/cancel`,'POST',{},k.cookie)).status,403);
    assert.equal((await request(`/api/slots/${booked.slotId}/cancel`,'POST',{},interviewerCookie)).status,200);
    assert.equal((await request('/api/bookings','GET',null,candidateCookie)).body.find(b=>b.id===rebook.body.id).status,'cancelled');
    assert.equal((await request('/api/bookings','POST',{slotId:booked.slotId},candidateCookie)).status,404);
    const saved=JSON.parse(fs.readFileSync(process.env.CAREERCUE_DB,'utf8'));
    assert.equal(saved.slots.find(s=>s.id===booked.slotId).status,'cancelled');
    assert.equal(saved.users[0].userId,'CC1001');
    // Exercise an old saved database without deleting its existing feedback.
    delete saved.schemaVersion;saved.users.forEach(u=>delete u.userId);fs.writeFileSync(process.env.CAREERCUE_DB,JSON.stringify(saved));
    assert.equal((await request('/api/login','POST',{userId:'CC1001',password:'Demo123!'})).status,200);
    assert.equal(JSON.parse(fs.readFileSync(process.env.CAREERCUE_DB,'utf8')).feedback[0].structure,5);
    console.log('CareerCue checks passed: user ID login, role checks, bulk scheduling, duration and gap, atomic overlap rejection, concurrent booking, cancellation and reopening, owner cancellation, feedback, persistence and migration.');
  } finally { await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});

