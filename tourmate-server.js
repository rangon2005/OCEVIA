'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const gee = require('./gee');

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(path.resolve(__dirname, '..'), 'index.html');
const MAX_USERS = 300;
const MAX_ROOM = Math.max(2, Number(process.env.TM_MAX_ROOM || 20)); // travellers per group
const STATE_FILE = process.env.TM_STATE_FILE || path.join(os.tmpdir(), 'ocevia-tourmate-state.json');
const users = new Map(); // id -> {name, room, lat, lng, acc, locT, online, seen, res, keep, lastSent, av, avT}

const ev = (res, name, data) => { if (res && !res.destroyed && res.writable) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const idOf = s => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
const roomOf = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const ALIVE_MS = 45000;
const BOOT = Date.now().toString(36);
// Per-room message buffer: lets phones whose live stream is blocked still receive chat and alerts by polling.
const rooms = new Map();
const roomBuf = r => { let x = rooms.get(r); if (!x) { x = { seq: 0, buf: [] }; rooms.set(r, x); } return x; };
function emit(room, kind, packet) {
  const R = roomBuf(room);
  packet.seq = ++R.seq; packet.k = kind; packet.boot = BOOT;
  R.buf.push(packet);
  while (R.buf.length > 80) R.buf.shift();
  let imgs = 0;
  for (let i = R.buf.length - 1; i >= 0; i--) if (R.buf[i].img && ++imgs > 6) R.buf[i] = Object.assign({}, R.buf[i], { img: undefined, text: 'ðŸ“· Photo (too old to load)' });
  for (const o of users.values()) if (o.room === room && o.online) ev(o.res, kind === 'alert' ? 'alert' : 'msg', packet);
}
const isActive = u => Date.now() - (u.alive || 0) < ALIVE_MS;
const members = room => {
  // Hide an old inactive copy of someone who is active again under the same name (new browser / cleared storage), so nobody appears twice.
  const live = new Set([...users.values()].filter(u => u.room === room && isActive(u)).map(u => u.name.toLowerCase()));
  return [...users].filter(([, u]) => u.room === room && (isActive(u) || !live.has(u.name.toLowerCase()))).map(([id, u]) => ({
  id, name: u.name, lat: u.lat, lng: u.lng, acc: u.acc, locT: u.locT, online: isActive(u), seen: u.seen, av: u.av ? u.avT : 0
  }));
};
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
const FB_URL = (process.env.FIREBASE_DB_URL || '').trim().replace(/\/+$/, '');
function servePage(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 500, { error: path.basename(file) + ' could not be read' });
    const html = data.toString('utf8').replace('<head>', '<head><script>window.TM_SERVER=1;window.TM_MAX=' + MAX_ROOM + ';window.FB_URL=' + JSON.stringify(FB_URL) + ';</script>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
  });
}
const serveIndex = res => servePage(res, INDEX);
const HIST = path.join(path.resolve(__dirname, '..'), 'historical.html');

function admit(id, name, room) {
  let u = users.get(id);
  if (u && u.room !== room) { const old = u.room; if (u.keep) clearInterval(u.keep); try { if (u.res) u.res.end(); } catch (_) {} users.delete(id); u = null; pushRoom(old); }
  if (!u) {
    if (users.size >= MAX_USERS) return { err: 'TourMate is full. Try again later.' };
    // Same person coming back from another browser/phone/cleared storage: take over the old offline entry instead of counting twice.
    const key = name.toLowerCase();
    for (const [i, x] of users) if (x.room === room && i !== id && !x.online && !isActive(x) && Date.now() - x.seen > 60000 && x.name.toLowerCase() === key) {
      if (x.keep) clearInterval(x.keep);
      users.delete(i);
      u = x; users.set(id, u);
      break;
    }
    if (!u) {
      const others = [...users].filter(([i, x]) => x.room === room && i !== id);
      if (others.length >= MAX_ROOM) {
        const stale = others.filter(([, x]) => !x.online && x.seen < Date.now() - 24 * 3600e3).sort((a, b) => a[1].seen - b[1].seen)[0];
        if (!stale) return { err: `This group already has ${MAX_ROOM} travellers (the maximum).` };
        users.delete(stale[0]);
      }
      u = { name, room, lat: null, lng: null, acc: null, locT: null, online: false, seen: Date.now(), res: null, keep: null, lastSent: 0, av: '', avT: 0 };
      users.set(id, u);
    }
    save();
  }
  u.name = name;
  return { user: u };
}

// ---- Persist travellers (last location, photo) so a server restart does not make people vanish from the group ----
let saveT = null;
function save() {
  remoteDirty = true;
  if (saveT) return;
  saveT = setTimeout(() => {
    saveT = null;
    try {
      const out = [...users].map(([id, u]) => ({ id, name: u.name, room: u.room, lat: u.lat, lng: u.lng, acc: u.acc, locT: u.locT, seen: u.seen, av: u.av, avT: u.avT }));
      fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(out));
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (_) {}
  }, 3000);
  saveT.unref();
}
try {
  const old = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const limit = Date.now() - 7 * 24 * 3600e3;
  for (const x of old) if (x && x.id && x.room && x.seen > limit) users.set(x.id, { name: x.name || 'Traveller', room: x.room, lat: x.lat, lng: x.lng, acc: x.acc, locT: x.locT, online: false, seen: x.seen, res: null, keep: null, lastSent: 0, av: x.av || '', avT: x.avT || 0 });
} catch (_) {}

// ---- Free hosting helpers ----
// 1) Render's free plan sleeps after ~15 min without visitors. Pinging our own public address keeps TourMate awake (uses the free 750 h/month).
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || process.env.TM_SELF_URL || '').replace(/\/+$/, '');
if (SELF_URL) setInterval(() => { fetch(SELF_URL + '/health').catch(() => {}); }, 9 * 60e3).unref();
// 2) Optional free Upstash Redis backup (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). Free servers lose their disk on restart; this keeps rooms and last locations.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '', UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const redis = async cmd => { const r = await fetch(UPSTASH_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return (await r.json()).result; };
let remoteDirty = false;
if (UPSTASH_URL && UPSTASH_TOKEN) {
  (async () => {
    try {
      const raw = await redis(['GET', 'ocevia:tm']);
      for (const x of JSON.parse(raw || '[]')) if (x && x.id && x.room && !users.has(x.id)) users.set(x.id, { name: x.name || 'Traveller', room: x.room, lat: x.lat, lng: x.lng, acc: x.acc, locT: x.locT, online: false, seen: x.seen || Date.now(), res: null, keep: null, lastSent: 0, av: '', avT: 0 });
    } catch (_) {}
  })();
  setInterval(async () => {
    if (!remoteDirty) return; remoteDirty = false;
    try { await redis(['SET', 'ocevia:tm', JSON.stringify([...users].map(([id, u]) => ({ id, name: u.name, room: u.room, lat: u.lat, lng: u.lng, acc: u.acc, locT: u.locT, seen: u.seen }))), 'EX', 7 * 86400]); } catch (_) { remoteDirty = true; }
  }, 60e3).unref();
}

// Keep an offline traveller (with their last location) until they leave the group; clean up only after 7 days.
setInterval(() => {
  const limit = Date.now() - 7 * 24 * 3600e3;
  for (const [id, u] of users) if (!u.online && u.seen < limit) users.delete(id);
  save();
}, 600e3).unref();


setInterval(() => {
  const changed = new Set();
  for (const u of users.values()) { const a = isActive(u); if (u.lastActive !== a) { u.lastActive = a; changed.add(u.room); } }
  for (const r of changed) pushRoom(r);
}, 10000).unref();

// ---- Ocevia AI (Gemini). The key stays on the server: set GEMINI_API_KEY in the environment (free key: aistudio.google.com/apikey) ----
// The key may be pasted into Render with quotes, spaces or a new line: clean it so the request header stays valid.
const GKEY = (process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
let aiLastErr = '', aiGoodModel = '';
const aiHits = new Map(); // ip -> [timestamps]
const num = v => (isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);
function whyPrompt(m) {
  const d = m.data && typeof m.data === 'object' ? m.data : {};
  const keys = ['rank', 'of', 'score', 'temp_c', 'feels_c', 'rain_mm_72h', 'gust_kmh', 'wave_m', 'cloud_pct', 'wet_hours', 'rain_peak_mm_h', 'feels_max_c', 'feels_min_c', 'temp_max_c', 'temp_min_c', 'avg_rain_mm', 'avg_gust_kmh', 'avg_wave_m'];
  const data = { place: clean(d.place || m.place, 80), place_type: clean(d.type, 2), waves_estimated: !!d.waves_estimated };
  for (const k of keys) data[k] = num(k === 'rank' ? m.rank : d[k]);
  for (const k of ['first_rain', 'rain_peak_time', 'gust_peak_time', 'thunder_time']) data[k] = clean(d[k], 20);
  data.hazards = Array.isArray(d.hazards) ? d.hazards.slice(0, 8).map(h => clean(h, 60)) : [];
  const act = clean(m.act, 40), place = clean(m.place, 80);
  return `You are Ocevia, a careful travel-weather guide for Bangladesh. A tourist wants ${act} at ${place} (place_type: c=beach, r=river, w=lake/wetland, h=hill, f=forest, x=heritage site). Real 72-hour forecast numbers for this place, plus the average of all ranked places: ${JSON.stringify(data)}.
Write simple English, max 130 words, in 3 short parts:
WHY: why this place is #${data.rank} of ${data.of || 'all'} - compare at least two numbers with the averages.
RISKS: only risks that these numbers support for ${act} at this kind of place, each with its number and time (for example rain peak time, gust peak time, thunder time). If a value is 0, empty or low, do not invent a risk; say the weather risk is low. Do not mention waves for a hill, forest or heritage site. If waves_estimated is true say the wave height is estimated.
TIP: one safety tip tied to the strongest signal in the data. Mention BMD warnings only if gusts are 40+ km/h, waves 1.5+ m or thunder_time is set.
Never use facts that are not in the data.`;
}

const dataJson = (d, n) => JSON.stringify(d || {}).replace(/[<>]/g, '').slice(0, n || 7000);
function aiPrompt(m) {
  const kind = String(m.kind || 'why');
  const place = clean(m.place, 80), act = clean(m.act, 40);
  if (kind === 'forecast') return `You are Ocevia, an AI weather guide for Bangladesh. Place: ${place}. Live weather numbers (JSON, NOAA GFS model): ${dataJson(m.data)}.
Write simple English, max 150 words, exactly 4 short lines:
NOW: what the weather is like right now and what it means for a tourist.
WEEK: how the 7 days develop; name the rainiest, hottest and any thunderstorm days with their numbers.
BEST: the best day and time of day to go out.
WATCH: one safety warning that the numbers support (heat feels-like 36+, gusts 40+ km/h, thunder, heavy rain). If nothing stands out, say the risk is low.
Use only the data given and never invent numbers. Mention that forecasts are less certain later in the week.`;
  if (kind === 'guide') return `You are Ocevia, an AI travel guide for Bangladesh. A tourist wants ${act} in ${place}. Ocevia ranked places from live 72-hour forecast data (rank 1 is best; JSON): ${dataJson(m.data)}.
Write simple English, max 150 words:
BEST PICK: the best place and why, with 2-3 numbers from the data.
BACKUP: one good alternative and how it differs.
SAFETY: one safety tip tied to the hazards or numbers in the data (BMD warnings only if gusts are 40+ km/h, waves 1.5+ m or thunder is listed).
If km_from_selected_area is present, mention the distance. Use only the data given.`;
  if (kind === 'danger') return `You are Ocevia's danger analyst for Bangladesh. Below is a live ranking of districts by an Ocevia danger index (0-100) built from the next 72 hours of weather (JSON; "top" = most dangerous districts, "all" = national summary): ${dataJson(m.data, 9000)}.
Write simple English, max 180 words, in 4 short parts:
OVERALL: one sentence on the national picture (use the severe/high counts).
TOP 3: the three most dangerous districts, why, with numbers and times from the hazards.
AVOID: what people should avoid in the next 72 hours (rivers, sea, open fields, travel).
CYCLONE: only if cyclone_near_bangladesh is not empty, say it with distance; otherwise skip this part.
Say this is guidance and people must follow BMD warnings. Use only the data given; never invent numbers.`;
  if (kind === 'chat') return `You are Ocevia AI, a friendly assistant for tourists in Bangladesh (places, weather, travel cost, safety, culture). Context and recent chat (JSON): ${dataJson(m.data, 6000)}.
Answer the user's latest question ("q") in the SAME language and style the user wrote in (Bangla, Banglish or English). Max 160 words, short lines.
Use only numbers that appear in the context. If live weather is needed and is not in the context, say to open the Forecast page. For travel costs give rough BDT ranges and say they are estimates. For safety or emergencies mention BMD warnings and 999.`;
  if (kind === 'route') return `You are Ocevia AI, a travel guide for Bangladesh. A tourist at their current GPS location wants to go to ${place} for ${act}. Facts (JSON): ${dataJson(m.data)}.
Write simple English, max 210 words, with these 5 short headings:
HOW TO GO: the best way by road, bus, train or launch for this distance, and when to leave.
BUDGET: use cost_estimates_bdt_one_way; give a rough one-way and return total and say it is an estimate (food and tickets extra).
AT THE PLACE: what to do for the activity.
WEATHER & SAFETY: use the weather numbers and hazards given.
PACK: 3 useful items.
If has_road_route is false, say the trip needs a boat or ferry. Use only the data given and never invent numbers.`;
  if (kind === 'tour_cost') {
    const d = m.data && typeof m.data === 'object' ? m.data : {};
    const costPlace = clean(d.place || m.place, 80), costAct = clean(d.act || m.act, 40);
    return `You are Ocevia, a Bangladesh travel cost expert. The tourist wants to visit ${costPlace} for ${costAct}. 
Provide a detailed, practical cost breakdown in Bangladeshi Taka (à§³) for a 2-day trip from Dhaka:
1. Transport (bus, train, launch options with prices)
2. Accommodation (budget to mid-range options)  
3. Food (local street food to restaurant)
4. Entry fees and activities for ${costAct}
5. Total estimated budget (budget / mid-range / comfortable)
6. 3 practical money-saving tips
7. Best time to book and any seasonal price variations
Keep it concise, accurate and helpful. Use à§³ symbol for prices.`;
  }
  if (kind === 'hist_analysis') {
    const d = m.data && typeof m.data === 'object' ? m.data : {};
    const histPlace = clean(d.place || m.place, 80);
    const yearBefore = clean(d.year_before, 10), yearAfter = clean(d.year_after, 10);
    const season = clean(d.season, 20);
    return `You are Ocevia, an environmental change analysis AI for Bangladesh. Analyse likely changes between ${yearBefore} and ${yearAfter} for ${histPlace} during ${season} season.

Focus on these variables: coastal erosion, land accretion, vegetation change, water body change, built-up area change.

Consider:
- Bangladesh's geographic and climatic context
- The specific location's known characteristics  
- Seasonal patterns
- Known trends in that region

Provide a structured analysis in 300-400 words covering each variable. Be specific to the location if possible.`;
  }
  return whyPrompt(m);
}
async function askGemini(prompt) {
  if (!GKEY) { aiLastErr = 'GEMINI_API_KEY is not set on this server'; return ''; }
  const models = [...new Set([aiGoodModel, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'].filter(Boolean))];
  for (const model of models) {
    // 2.5 models "think" first and the thinking can eat the whole answer budget (empty reply): switch it off, retry without that option if the model refuses it.
    for (const think of [true, false]) {
      const gen = { temperature: 0.3, maxOutputTokens: think ? 1400 : 3000 };
      if (think) gen.thinkingConfig = { thinkingBudget: 0 };
      let r, raw = '';
      try {
        const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 25000);
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY }, signal: ctl.signal,
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gen })
        });
        clearTimeout(tm);
        raw = await r.text();
      } catch (e) { aiLastErr = `${model}: ${e && e.name === 'AbortError' ? 'timeout' : 'network error ' + (e && e.message)}`; break; }
      if (!r.ok) {
        let msg = raw; try { msg = JSON.parse(raw).error.message; } catch (_) {}
        aiLastErr = `${model} HTTP ${r.status}: ${String(msg).split(GKEY).join('***').replace(/\s+/g, ' ').slice(0, 200)}`;
        console.error('[gemini]', aiLastErr);
        if (r.status === 400 && think && !/API key|API_KEY/i.test(msg)) continue; // try again without thinkingConfig
        break; // next model
      }
      let o = {}; try { o = JSON.parse(raw); } catch (_) {}
      const cand = (o.candidates || [])[0] || {};
      const t = ((cand.content || {}).parts || []).map(p => p.text || '').join('').trim();
      if (t) { aiGoodModel = model; aiLastErr = ''; return t; }
      aiLastErr = `${model}: empty answer (${cand.finishReason || (o.promptFeedback && o.promptFeedback.blockReason) || 'no reason'})`;
      console.error('[gemini]', aiLastErr);
    }
  }
  return '';
}
let aiTestAt = 0;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveIndex(res);
  if (req.method === 'GET' && (p === '/historical-map' || p === '/historical-map/' || p === '/historical.html')) return servePage(res, HIST);
  if (p.startsWith('/api/hist/')) return gee.handle(req, res, p, { json, readBody });
  if (req.method === 'GET' && p === '/ai/test') {
    // Open /ai/test in the browser to see exactly why Gemini does or does not answer (the key itself is never shown).
    if (Date.now() - aiTestAt < 8000) return json(res, 429, { error: 'Wait a few seconds and reload' });
    aiTestAt = Date.now();
    return askGemini('Reply with the single word OK.').then(t => json(res, 200, { ok: !!t, reply: t.slice(0, 40), model: aiGoodModel, keySet: !!GKEY, keyLength: GKEY.length, error: t ? '' : aiLastErr }));
  }
  if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'ocevia', tourmate: true, version: 'v16', ai: !!GKEY, aiModel: aiGoodModel, aiError: aiLastErr, firebase: !!FB_URL, gee: gee.configured(), max: MAX_ROOM, persist: !!UPSTASH_URL, keepAwake: !!SELF_URL });
  if (req.method === 'GET' && p === '/cyclones') {
    const https = require('https');
    const urls = [
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC',
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP?eventtype=TC'
    ];
    async function fetchUrl(u) {
      return new Promise((resolve, reject) => {
        const req2 = https.get(u, { headers: { 'User-Agent': 'OceviaWeatherApp/1.0', 'Accept': 'application/json' }, timeout: 10000 }, r2 => {
          let d = '';
          r2.on('data', c => d += c);
          r2.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        });
        req2.on('error', reject);
        req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
      });
    }
    for (const u of urls) {
      try {
        const o = await fetchUrl(u);
        if (o && Array.isArray(o.features)) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=900', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify(o));
        }
      } catch(e) {}
    }
    return json(res, 502, { error: 'Could not fetch cyclone data' });
  }

  if (req.method === 'POST' && p === '/ai') {
    return readBody(req, res, async m => {
      if (!GKEY) return json(res, 503, { error: 'AI key not set on the server' });
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const now = Date.now(), hits = (aiHits.get(ip) || []).filter(t => now - t < 60e3);
      if (hits.length >= 25) return json(res, 429, { error: 'Too many AI requests, wait a minute' });
      hits.push(now); aiHits.set(ip, hits);
      if (aiHits.size > 2000) aiHits.clear();
      const text = await askGemini(aiPrompt(m));
      return text ? json(res, 200, { text }) : json(res, 502, { error: 'Gemini did not respond', detail: aiLastErr });
    }, 20000);
  }

  if (req.method === 'POST' && p === '/tm/join') {
    return readBody(req, res, m => {
      const id = idOf(m.id), room = roomOf(m.room), name = clean(m.name, 24) || 'Traveller';
      if (!id || room.length < 3) return json(res, 400, { error: 'Enter your name and a group code of 3+ letters or numbers.' });
      const r = admit(id, name, room);
      if (r.err) return json(res, 409, { error: r.err });
      json(res, 200, { ok: true, max: MAX_ROOM, count: members(room).length, users: members(room), seq: roomBuf(room).seq, boot: BOOT });
    });
  }

  if (req.method === 'GET' && p === '/tm/events') {
    const id = idOf(url.searchParams.get('id')), room = roomOf(url.searchParams.get('room'));
    const name = clean(url.searchParams.get('name'), 24) || 'Traveller';
    if (!id || room.length < 3) return json(res, 400, { error: 'Name and a 3+ character group code are required' });
    const r = admit(id, name, room);
    if (r.err) return json(res, 409, { error: r.err });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Content-Encoding': 'identity' });
    if (res.flushHeaders) res.flushHeaders();
    try { req.socket.setTimeout(0); req.socket.setNoDelay(true); req.socket.setKeepAlive(true, 15000); } catch (_) {}
    // padding makes proxies that buffer small responses (Render, Cloudflare, mobile carriers) release the stream at once
    res.write('retry: 3000\n:' + ' '.repeat(2048) + '\n\n');
    const user = users.get(id);
    if (user.keep) clearInterval(user.keep);
    const prev = user.res; if (prev && prev !== res) { try { prev.end(); } catch (_) {} }
    user.res = res; user.online = true; user.seen = Date.now(); user.alive = user.seen;
    user.keep = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
    pushRoom(room);
    // use res (not req) 'close': req 'close' fires early on modern Node versions
    res.on('close', () => {
      if (users.get(id) === user && user.res === res) { clearInterval(user.keep); user.online = false; user.seen = Date.now(); pushRoom(room); }
    });
    return;
  }

  if (req.method === 'GET' && p === '/tm/poll') {
    const id = idOf(url.searchParams.get('id')), room = roomOf(url.searchParams.get('room'));
    const name = clean(url.searchParams.get('name'), 24) || 'Traveller';
    let since = Number(url.searchParams.get('since')) || 0;
    if (!id || room.length < 3) return json(res, 400, { error: 'Name and a 3+ character group code are required' });
    let u = users.get(id);
    if (!u || u.room !== room) { const r = admit(id, name, room); if (r.err) return json(res, 409, { error: r.err }); u = r.user; }
    const was = isActive(u); u.alive = Date.now(); u.seen = u.alive;
    if (!was) pushRoom(room);
    const R = roomBuf(room);
    if (url.searchParams.get('boot') !== BOOT) since = 0;
    return json(res, 200, { ok: true, boot: BOOT, seq: R.seq, max: MAX_ROOM, users: members(room), msgs: R.buf.filter(m => m.seq > since) });
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
      emit(u.room, 'alert', packet);
      json(res, 200, { ok: true, notified: members(u.room).filter(x => x.online && x.id !== String(m.id)).length });
    });
  }

  if (req.method === 'POST' && p === '/tm/loc') {
    return readBody(req, res, m => {
      let u = users.get(String(m.id || '')), lat = Number(m.lat), lng = Number(m.lng);
      // After a server restart the traveller is unknown: re-admit from the name + group code the page sends along.
      if (!u && m.id && roomOf(m.room).length >= 3) { const r = admit(idOf(m.id), clean(m.name, 24) || 'Traveller', roomOf(m.room)); if (r.user) u = r.user; }
      if (!u || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json(res, 400, { error: 'Join first' });
      u.lat = lat; u.lng = lng; u.acc = Math.round(Number(m.acc) || 0); u.locT = Date.now(); u.seen = u.locT; u.alive = u.locT;
      save();
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
      emit(u.room, 'msg', packet);
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
      emit(u.room, 'msg', packet);
      res.writeHead(204); res.end();
    }, 70000);
  }

  if (req.method === 'POST' && p === '/tm/ping') {
    return readBody(req, res, m => {
      let u = users.get(String(m.id || ''));
      if (!u && m.id && roomOf(m.room).length >= 3) { const r = admit(idOf(m.id), clean(m.name, 24) || 'Traveller', roomOf(m.room)); if (r.user) u = r.user; }
      if (!u) return json(res, 400, { error: 'Join first' });
      const was = isActive(u); u.alive = Date.now(); u.seen = u.alive;
      if (!was) pushRoom(u.room);
      res.writeHead(204); res.end();
    });
  }

  if (req.method === 'POST' && p === '/tm/avatar') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || '')), img = String(m.img || '');
      if (!u) return json(res, 400, { error: 'Join first' });
      if (img === '') { u.av = ''; u.avT = Date.now(); }
      else {
        if (img.length > 45000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img)) return json(res, 400, { error: 'Send a small JPEG photo' });
        u.av = img.split(',')[1]; u.avT = Date.now();
      }
      save(); pushRoom(u.room);
      json(res, 200, { ok: true, v: u.av ? u.avT : 0 });
    }, 60000);
  }

  if (req.method === 'GET' && p === '/tm/avatar') {
    const u = users.get(idOf(url.searchParams.get('id')));
    if (!u || !u.av) { res.writeHead(404); return res.end(); }
    const buf = Buffer.from(u.av, 'base64');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    return res.end(buf);
  }

  if (req.method === 'POST' && p === '/tm/leave') {
    return readBody(req, res, m => {
      const u = users.get(String(m.id || ''));
      if (u) {
        clearInterval(u.keep);
        const room = u.room;
        users.delete(String(m.id));
        try { if (u.res && !u.res.destroyed) u.res.end(); } catch (_) {}
        save();
        pushRoom(room);
      }
      res.writeHead(204); res.end();
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

// Render / load balancers keep idle connections longer than Node's 5 s default, which caused random resets ("server not reachable").
server.keepAliveTimeout = 125e3;
server.headersTimeout = 130e3;
server.requestTimeout = 0;
// one bad request must never take the whole room server down
process.on('uncaughtException', e => console.error('uncaught', e && e.stack || e));
process.on('unhandledRejection', e => console.error('unhandled', e && e.stack || e));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ocevia + TourMate listening on port ${PORT}`);
  let found = false;
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) { console.log(`On this Wi-Fi/hotspot, open: http://${n.address}:${PORT}`); found = true; }
  }
  if (!found) console.log(`Open http://localhost:${PORT} on this device`);
});

