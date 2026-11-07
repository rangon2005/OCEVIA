'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const users = new Map();
const MAX_USERS = 150;

function event(res, name, data) {
  if (!res.destroyed && res.writable) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcastUsers() {
  const list = [...users].map(([id, u]) => ({ id, name: u.name, tag: u.tag }));
  for (const u of users.values()) event(u.res, 'users', list);
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function serveIndex(res) {
  fs.readFile(INDEX, (err, data) => {
    if (err) return json(res, 500, { error: 'Ocevia index.html could not be read' });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveIndex(res);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'ocevia', tourmate: true });
  if (req.method === 'GET' && url.pathname === '/tm/events') {
    const id = (url.searchParams.get('id') || '').slice(0, 32);
    if (!id) return json(res, 400, { error: 'Missing user id' });
    if (!users.has(id) && users.size >= MAX_USERS) return json(res, 503, { error: 'Nearby chat is full. Try again later.' });
    const name = (url.searchParams.get('name') || 'Traveller').trim().slice(0, 24) || 'Traveller';
    const tag = (url.searchParams.get('tag') || '').trim().slice(0, 50);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    const previous = users.get(id);
    if (previous && previous.keepalive) clearInterval(previous.keepalive);
    const user = { name, tag, res, lastSent: 0, keepalive: setInterval(() => {
      if (!res.destroyed) res.write(': keepalive\n\n');
    }, 20000) };
    users.set(id, user);
    broadcastUsers();
    req.on('close', () => {
      clearInterval(user.keepalive);
      if (users.get(id) === user) {
        users.delete(id);
        broadcastUsers();
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/tm/send') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5000) req.destroy();
    });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body || '{}');
        const sender = users.get(String(msg.id || ''));
        const text = String(msg.text || '').trim().slice(0, 500);
        const target = String(msg.to || 'all');
        if (!sender || !text) return json(res, 400, { error: 'Join the nearby chat before sending' });
        const now = Date.now();
        if (now - sender.lastSent < 450) return json(res, 429, { error: 'Please slow down' });
        sender.lastSent = now;
        const packet = { from: String(msg.id), name: sender.name, to: target, text, t: now };
        if (target === 'all') {
          for (const u of users.values()) event(u.res, 'msg', packet);
        } else {
          const recipient = users.get(target);
          if (recipient) event(recipient.res, 'msg', packet);
          event(sender.res, 'msg', packet);
        }
        res.writeHead(204);
        res.end();
      } catch (_) {
        json(res, 400, { error: 'Invalid message' });
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ocevia + TourMate listening on port ${PORT}`);
  let found = false;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`On this Wi-Fi/hotspot, open: http://${net.address}:${PORT}`);
        found = true;
      }
    }
  }
  if (!found) console.log(`Open http://localhost:${PORT} on this device`);
});
