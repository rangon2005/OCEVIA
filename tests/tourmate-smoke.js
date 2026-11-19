'use strict';
// Run with: OCEVIA_URL=https://your-service.onrender.com npm run test:tourmate
const base = (process.env.OCEVIA_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const room = 'TEST' + Math.random().toString(36).slice(2, 8).toUpperCase();
const members = Array.from({ length: 4 }, (_, i) => ({
  id: `smoke-${Date.now()}-${i}`,
  name: 'Same-name tester'
}));
async function json(url, options) {
  const r = await fetch(url, options);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} returned ${r.status}: ${body.error || 'request failed'}`);
  return body;
}
(async () => {
  const health = await json(`${base}/health`);
  if (!health.tourmate) throw new Error('TourMate service is not healthy');
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const result = await json(`${base}/tm/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...m, room })
    });
    if (result.count !== i + 1) throw new Error(`Expected ${i + 1} room members, received ${result.count}`);
  }
  const loc = await fetch(`${base}/tm/loc`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...members[3], room, lat: 23.78, lng: 90.41, acc: 8 })
  });
  if (loc.status !== 204) throw new Error(`Location update returned ${loc.status}`);
  const finalHealth = await json(`${base}/health`);
  if (finalHealth.members < 4) throw new Error('Server did not retain all four test members');
  console.log(`PASS: four members joined room ${room}; location update accepted; server healthy.`);
  await Promise.all(members.map(m => fetch(`${base}/tm/leave`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: m.id })
  })));
})().catch(err => { console.error(`FAIL: ${err.message}`); process.exitCode = 1; });
