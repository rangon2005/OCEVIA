'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(path.resolve(__dirname, '..'), 'index.html');
const MAX_USERS = 300;
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
function readBody(req, res, cb) {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 6000) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch (_) { json(res, 400, { error: 'Invalid request' }); } });
}
function serveIndex(res) {
  fs.readFile(INDEX, (err, data) => {
    if (err) return json(res, 500, { error: 'index.html could not be read' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

// Forget travellers who have been offline for 3 hours.
setInterval(() => {
  const limit = Date.now() - 3 * 3600e3;
  for (const [id, u] of users) if (!u.online && u.seen < limit) users.delete(id);
}, 600e3).unref();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveIndex(res);
  if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'ocevia', tourmate: true });

  if (req.method === 'GET' && p === '/tm/events') {
    const id = clean(url.searchParams.get('id'), 32), room = roomOf(url.searchParams.get('room'));
    if (!id || room.length < 3) return json(res, 400, { error: 'Name and a 3+ character group code are required' });
    if (!users.has(id) && users.size >= MAX_USERS) return json(res, 503, { error: 'TourMate is full. Try again later.' });
    const name = clean(url.searchParams.get('name'), 24) || 'Traveller';
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const old = users.get(id), oldRoom = old && old.room;
    if (old && old.keep) clearInterval(old.keep);
    const user = { name, room, lat: old && old.room === room ? old.lat : null, lng: old && old.room === room ? old.lng : null,
      acc: old ? old.acc : null, locT: old && old.room === room ? old.locT : null, online: true, seen: Date.now(), res, lastSent: 0,
      keep: setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 20000) };
    users.set(id, user);
    if (oldRoom && oldRoom !== room) pushRoom(oldRoom);
    pushRoom(room);
    req.on('close', () => {
      clearInterval(user.keep);
      if (users.get(id) === user) { user.online = false; user.seen = Date.now(); pushRoom(room); }
    });
    return;
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

  if (req.method === 'POST' && p === '/tm/leave') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || ''));
      if (u) { clearInterval(u.keep); users.delete(String(m.id)); pushRoom(u.room); try { u.res.end(); } catch (_) {} }
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
