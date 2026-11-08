'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(path.resolve(__dirname, '..'), 'index.html');
const MAX_USERS = 300;
const MAX_ROOM = 5; // travellers per group
const users = new Map(); // id -> {name, room, lat, lng, acc, locT, online, seen, res, keep, lastSent}

const ev = (res, name, data) => { if (res && !res.destroyed && res.writable) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const roomOf = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const members = room => [...users].filter(([, u]) => u.room === room).map(([id, u]) => ({
  id, name: u.name, lat: u.lat, lng: u.lng, acc: u.acc, locT: u.locT, online: u.online, seen: u.seen
}));
function pushRoom(room) {
  const list = members(room);
  for (const u of users.values()) if (u.room === room && u.online) ev(u.res, 'users', list);
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
function readBody(req, res, cb, max = 6000) {
  let b = '';
  req.on('data', c => { b += c; if (b.length > max) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch (_) { json(res, 400, { error: 'Invalid request' }); } });
}
function serveIndex(res) {
  fs.readFile(INDEX, (err, data) => {
    if (err) return json(res, 500, { error: 'index.html could not be read' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

function admit(id, name, room) {
  let u = users.get(id);
  if (u && u.room !== room) { const old = u.room; if (u.keep) clearInterval(u.keep); try { if (u.res) u.res.end(); } catch (_) {} users.delete(id); u = null; pushRoom(old); }
  if (!u) {
    if (users.size >= MAX_USERS) return { err: 'TourMate is full. Try again later.' };
    const others = [...users].filter(([i, x]) => x.room === room && i !== id);
    if (others.length >= MAX_ROOM) {
      const stale = others.filter(([, x]) => !x.online && x.seen < Date.now() - 15 * 60e3).sort((a, b) => a[1].seen - b[1].seen)[0];
      if (!stale) return { err: `This group already has ${MAX_ROOM} travellers (the maximum).` };
      users.delete(stale[0]);
    }
    u = { name, room, lat: null, lng: null, acc: null, locT: null, online: false, seen: Date.now(), res: null, keep: null, lastSent: 0 };
    users.set(id, u);
  }
  u.name = name;
  return { user: u };
}

// Forget travellers who have been offline for 3 hours.
setInterval(() => {
  const limit = Date.now() - 3 * 3600e3;
  for (const [id, u] of users) if (!u.online && u.seen < limit) users.delete(id);
}, 600e3).unref();


// ---- Ocevia AI (Gemini). The key stays on the server: set GEMINI_API_KEY in the environment (free key: aistudio.google.com/apikey) ----
const GKEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const aiHits = new Map(); // ip -> [timestamps]
const num = v => (isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);
function aiPrompt(m) {
  const d = m.data && typeof m.data === 'object' ? m.data : {};
  const data = {
    place: clean(d.place || m.place, 80), type: clean(d.type, 2), rank: num(m.rank), score: num(d.score), temp_c: num(d.temp_c), feels_c: num(d.feels_c),
    rain_mm_72h: num(d.rain_mm_72h), gust_kmh: num(d.gust_kmh), wave_m: num(d.wave_m), cloud_pct: num(d.cloud_pct),
    hazards: Array.isArray(d.hazards) ? d.hazards.slice(0, 8).map(h => clean(h, 60)) : []
  };
  const act = clean(m.act, 40), place = clean(m.place, 80);
  return `You are Ocevia, a careful AI travel-weather guide for Bangladesh. The tourist wants ${act} at ${place}. Live 72-hour forecast data: ${JSON.stringify(data)}. In simple English, max 150 words: 1) why this place ranks #${data.rank}, 2) the specific risks for ${act} given this weather and this kind of place, 3) one clear safety tip. Use only the data given and mention BMD warnings if wind or waves are high.`;
}
async function askGemini(prompt) {
  for (const model of ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!r.ok) continue;
      const o = await r.json();
      const t = ((o.candidates || [])[0]?.content?.parts || []).map(p => p.text).join('');
      if (t) return t;
    } catch (_) {}
  }
  return '';
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveIndex(res);
  if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'ocevia', tourmate: true, ai: !!GKEY });

  if (req.method === 'POST' && p === '/ai') {
    return readBody(req, res, async m => {
      if (!GKEY) return json(res, 503, { error: 'AI key not set on the server' });
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const now = Date.now(), hits = (aiHits.get(ip) || []).filter(t => now - t < 60e3);
      if (hits.length >= 12) return json(res, 429, { error: 'Too many AI requests, wait a minute' });
      hits.push(now); aiHits.set(ip, hits);
      if (aiHits.size > 2000) aiHits.clear();
      const text = await askGemini(aiPrompt(m));
      return text ? json(res, 200, { text }) : json(res, 502, { error: 'Gemini did not respond' });
    });
  }

  if (req.method === 'POST' && p === '/tm/join') {
    return readBody(req, res, m => {
      const id = clean(m.id, 32), room = roomOf(m.room), name = clean(m.name, 24) || 'Traveller';
      if (!id || room.length < 3) return json(res, 400, { error: 'Enter your name and a group code of 3+ letters or numbers.' });
      const r = admit(id, name, room);
      if (r.err) return json(res, 409, { error: r.err });
      json(res, 200, { ok: true, max: MAX_ROOM, count: members(room).length });
    });
  }

  if (req.method === 'GET' && p === '/tm/events') {
    const id = clean(url.searchParams.get('id'), 32), room = roomOf(url.searchParams.get('room'));
    const name = clean(url.searchParams.get('name'), 24) || 'Traveller';
    if (!id || room.length < 3) return json(res, 400, { error: 'Name and a 3+ character group code are required' });
    const r = admit(id, name, room);
    if (r.err) return json(res, 409, { error: r.err });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const user = users.get(id);
    if (user.keep) clearInterval(user.keep);
    user.res = res; user.online = true; user.seen = Date.now();
    user.keep = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 20000);
    pushRoom(room);
    // use res (not req) 'close': req 'close' fires early on modern Node versions
    res.on('close', () => {
      if (users.get(id) === user && user.res === res) { clearInterval(user.keep); user.online = false; user.seen = Date.now(); pushRoom(room); }
    });
    return;
  }

  if (req.method === 'POST' && p === '/tm/alert') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || ''));
      if (!u) return json(res, 400, { error: 'Join first' });
      const now = Date.now();
      if (now - (u.lastAlert || 0) < 3000) return json(res, 429, { error: 'Alert already sent' });
      u.lastAlert = now;
      const lat = Number(m.lat), lng = Number(m.lng), ok = isFinite(lat) && isFinite(lng) && m.lat != null;
      const packet = { from: String(m.id), name: u.name, lat: ok ? lat : u.lat, lng: ok ? lng : u.lng, t: now };
      for (const o of users.values()) if (o.room === u.room && o.online) ev(o.res, 'alert', packet);
      json(res, 200, { ok: true, notified: members(u.room).filter(x => x.online && x.id !== String(m.id)).length });
    });
  }

  if (req.method === 'POST' && p === '/tm/loc') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || '')), lat = Number(m.lat), lng = Number(m.lng);
      if (!u || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json(res, 400, { error: 'Join first' });
      u.lat = lat; u.lng = lng; u.acc = Math.round(Number(m.acc) || 0); u.locT = Date.now(); u.seen = u.locT;
      pushRoom(u.room);
      res.writeHead(204); res.end();
    });
  }

  if (req.method === 'POST' && p === '/tm/send') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || '')), text = clean(m.text, 500);
      if (!u || !text) return json(res, 400, { error: 'Join before sending' });
      const now = Date.now();
      if (now - u.lastSent < 450) return json(res, 429, { error: 'Please slow down' });
      u.lastSent = now;
      const packet = { from: String(m.id), name: u.name, text, t: now };
      for (const o of users.values()) if (o.room === u.room && o.online) ev(o.res, 'msg', packet);
      res.writeHead(204); res.end();
    });
  }

  if (req.method === 'POST' && p === '/tm/photo') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || '')), img = String(m.img || '');
      if (!u || img.length > 60000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img)) return json(res, 400, { error: 'Join first and send a small JPEG photo' });
      const now = Date.now();
      if (now - u.lastSent < 1500) return json(res, 429, { error: 'Please slow down' });
      u.lastSent = now;
      const packet = { from: String(m.id), name: u.name, img, t: now };
      for (const o of users.values()) if (o.room === u.room && o.online) ev(o.res, 'msg', packet);
      res.writeHead(204); res.end();
    }, 70000);
  }

  if (req.method === 'POST' && p === '/tm/leave') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || ''));
      if (u) {
        clearInterval(u.keep);
        const room = u.room;
        users.delete(String(m.id));
        try { if (u.res && !u.res.destroyed) u.res.end(); } catch (_) {}
        pushRoom(room);
      }
      res.writeHead(204); res.end();
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ocevia + TourMate listening on port ${PORT}`);
  let found = false;
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) { console.log(`On this Wi-Fi/hotspot, open: http://${n.address}:${PORT}`); found = true; }
  }
  if (!found) console.log(`Open http://localhost:${PORT} on this device`);
});
