'use strict';
/*
 * Historical Satellite Map Analysis backend (Google Earth Engine).
 * No extra server: this runs inside the same free Render service that already serves Ocevia.
 * Needs a FREE Earth Engine service account (see GEE_SETUP.md):
 *   GEE_SERVICE_ACCOUNT_JSON  (the whole JSON key file)  and  GEE_PROJECT (Google Cloud project id)
 * Nothing is stored: images are processed in Google's cloud and only map tiles + a few numbers come back.
 * Every number is an estimate from satellite pixels (30 m Landsat / 10 m Sentinel-2), not a ground measurement.
 */
let ee = null, ready = null;

const configured = () => !!(process.env.GEE_SERVICE_ACCOUNT_JSON || (process.env.GEE_CLIENT_EMAIL && process.env.GEE_PRIVATE_KEY));

function loadKey() {
  if (process.env.GEE_SERVICE_ACCOUNT_JSON) {
    let raw = process.env.GEE_SERVICE_ACCOUNT_JSON.trim();
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8'); // base64 is accepted too
    const k = JSON.parse(raw);
    if (k.private_key) k.private_key = k.private_key.replace(/\\n/g, '\n');
    return k;
  }
  return { client_email: process.env.GEE_CLIENT_EMAIL, private_key: process.env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n'), project_id: process.env.GEE_PROJECT };
}

function init() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    if (!configured()) return reject(new Error('Earth Engine is not connected: GEE_SERVICE_ACCOUNT_JSON is not set on the server.'));
    try { ee = require('@google/earthengine'); } catch (e) { return reject(new Error('The @google/earthengine package is not installed on the server (npm install failed).')); }
    let key;
    try { key = loadKey(); } catch (e) { return reject(new Error('GEE_SERVICE_ACCOUNT_JSON is not valid JSON.')); }
    const project = process.env.GEE_PROJECT || key.project_id;
    ee.data.authenticateViaPrivateKey(key,
      () => ee.initialize(null, null, () => resolve(ee), e => reject(new Error('Earth Engine initialize failed: ' + e)), null, project),
      e => reject(new Error('Earth Engine login failed: ' + e)));
  });
  ready.catch(() => { ready = null; });
  return ready;
}

const evalP = (obj, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('Earth Engine took too long. Try a smaller area.')), ms || 100000);
  obj.evaluate((v, err) => { clearTimeout(t); err ? rej(new Error(String(err))) : res(v); });
});
const mapP = (img, vis) => new Promise((res, rej) => {
  img.getMap(vis, (m, err) => {
    if (err || !m) return rej(new Error(String(err || 'map failed')));
    res(m.urlFormat || `https://earthengine.googleapis.com/v1/${m.mapid}/tiles/{z}/{x}/{y}`);
  });
});

// ---------- imagery ----------
const SEASONS = { dry: [1, 1, 4, 30], winter: [11, 1, 12, 31], monsoon: [6, 1, 9, 30], year: [1, 1, 12, 31] };
const L_BANDS_OLD = ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'];   // Landsat 5 / 7
const L_BANDS_NEW = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'];   // Landsat 8 / 9
const STD = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'];

function landsat(id, bands, name, g, y, cloudMax) {
  const col = ee.ImageCollection(id).filterBounds(g).filterDate(y.a, y.b).filter(ee.Filter.lt('CLOUD_COVER', cloudMax));
  return col.map(im => {
    const qa = im.select('QA_PIXEL');
    const ok = qa.bitwiseAnd(26).eq(0); // dilated cloud, cloud, cloud shadow
    const sr = im.select(bands, STD).multiply(0.0000275).add(-0.2).updateMask(ok);
    return sr.copyProperties(im, ['system:time_start', 'CLOUD_COVER']).set('sensor', name).set('cloud', im.get('CLOUD_COVER'));
  });
}
function sentinel2(g, y, cloudMax) {
  const col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(g).filterDate(y.a, y.b).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudMax));
  return col.map(im => {
    const scl = im.select('SCL');
    const ok = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(1));
    const sr = im.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'], STD).multiply(0.0001).updateMask(ok);
    return sr.copyProperties(im, ['system:time_start']).set('sensor', 'Sentinel-2').set('cloud', im.get('CLOUDY_PIXEL_PERCENTAGE'));
  });
}
function dates(year, season) {
  const s = SEASONS[season] || SEASONS.dry;
  const p = n => String(n).padStart(2, '0');
  return { a: `${year}-${p(s[0])}-${p(s[1])}`, b: `${year}-${p(s[2])}-${p(s[3])}` };
}
function sensorsFor(year, choice) {
  if (choice === 'sentinel2') return year >= 2016 ? ['s2'] : [];
  const o = [];
  if (year <= 2012) o.push('l5');
  if (year >= 1999 && year <= 2021) o.push('l7');
  if (year >= 2013) o.push('l8');
  if (year >= 2022) o.push('l9');
  return o;
}
function collection(year, g, season, choice, cloudMax) {
  const y = dates(year, season), list = sensorsFor(year, choice);
  if (!list.length) return null;
  const parts = list.map(k => k === 'l5' ? landsat('LANDSAT/LT05/C02/T1_L2', L_BANDS_OLD, 'Landsat 5', g, y, cloudMax)
    : k === 'l7' ? landsat('LANDSAT/LE07/C02/T1_L2', L_BANDS_OLD, 'Landsat 7', g, y, cloudMax)
    : k === 'l8' ? landsat('LANDSAT/LC08/C02/T1_L2', L_BANDS_NEW, 'Landsat 8', g, y, cloudMax)
    : k === 'l9' ? landsat('LANDSAT/LC09/C02/T1_L2', L_BANDS_NEW, 'Landsat 9', g, y, cloudMax)
    : sentinel2(g, y, cloudMax));
  let c = parts[0]; for (let i = 1; i < parts.length; i++) c = c.merge(parts[i]);
  return c;
}
// the least cloudy scenes of the year/season, as a median composite (clouds already masked)
function composite(year, g, season, choice, cloudMax, limit) {
  const col = collection(year, g, season, choice, cloudMax);
  if (!col) return null;
  const best = col.sort('cloud').limit(limit || 12);
  return { best, image: best.median().clip(g) };
}
const idx = im => im.addBands([
  im.normalizedDifference(['green', 'nir']).rename('ndwi'),
  im.normalizedDifference(['green', 'swir1']).rename('mndwi'),
  im.normalizedDifference(['nir', 'red']).rename('ndvi'),
  im.normalizedDifference(['swir1', 'nir']).rename('ndbi')
]);

function geomFrom(body) {
  const ring = body && body.polygon;
  if (!Array.isArray(ring) || ring.length < 3 || ring.length > 600) throw new Error('Draw or choose an area first.');
  const pts = ring.map(p => [Number(p[0]), Number(p[1])]);
  if (pts.some(p => !isFinite(p[0]) || !isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('The area is not valid.');
  const g = ee.Geometry.Polygon([pts]);
  return g;
}
function yearOf(v) { const y = Number(v); if (!(y >= 2000 && y <= new Date().getFullYear())) throw new Error('Choose a year between 2000 and now.'); return Math.round(y); }
const MAX_KM2 = 30000;

async function sceneInfo(year, g, season, choice) {
  // relax the cloud limit step by step, so a cloudy year still returns something usable (and says so)
  for (const cloudMax of [20, 40, 70]) {
    const c = composite(year, g, season, choice, cloudMax, 12);
    if (!c) return { year, ok: false, reason: choice === 'sentinel2' ? 'Sentinel-2 surface reflectance starts in 2016.' : 'No Landsat satellite covers this year.' };
    const info = await evalP(ee.Dictionary({
      n: c.best.size(),
      list: c.best.toList(12).map(im => ee.Dictionary({ t: ee.Image(im).get('system:time_start'), s: ee.Image(im).get('sensor'), c: ee.Image(im).get('cloud') }))
    }));
    if (info.n > 0) {
      const sc = (info.list || []).map(x => ({ date: new Date(x.t).toISOString().slice(0, 10), sensor: x.s, cloud: Math.round(Number(x.c) * 10) / 10 })).sort((a, b) => a.date < b.date ? -1 : 1);
      const mean = sc.reduce((a, b) => a + b.cloud, 0) / sc.length;
      return { year, ok: true, season, cloudLimit: cloudMax, scenes: sc, sensors: [...new Set(sc.map(x => x.sensor))], meanCloud: Math.round(mean * 10) / 10, c };
    }
  }
  return { year, ok: false, reason: `No usable (cloud-free enough) ${choice === 'sentinel2' ? 'Sentinel-2' : 'Landsat'} scene was found for ${year} in this area and season. Try another season or year.` };
}

async function handleScenes(body) {
  const g = geomFrom(body), season = SEASONS[body.season] ? body.season : 'dry', choice = body.sensor === 'sentinel2' ? 'sentinel2' : 'landsat';
  const area = await evalP(g.area(1));
  if (area / 1e6 > MAX_KM2) throw new Error(`The area is too large (${Math.round(area / 1e6)} km²). Use less than ${MAX_KM2} km².`);
  const out = { aoi_km2: Math.round(area / 1e5) / 10, years: {}, tiles: {} };
  for (const y of [yearOf(body.y1), yearOf(body.y2)].filter((v, i, a) => a.indexOf(v) === i)) {
    const si = await sceneInfo(y, g, season, choice);
    if (!si.ok) { out.years[y] = { ok: false, reason: si.reason }; continue; }
    const vis = choice === 'sentinel2' ? { bands: ['red', 'green', 'blue'], min: 0.02, max: 0.28, gamma: 1.15 } : { bands: ['red', 'green', 'blue'], min: 0.02, max: 0.24, gamma: 1.2 };
    out.tiles[y] = await mapP(si.c.image, vis);
    const { c, ...pub } = si; out.years[y] = pub;
  }
  return out;
}

const PAL = { water: '#1f78b4', veg: '#33a02c', built: '#e31a1c', crop: '#ffd92f', bare: '#b8a07e' };

async function handleAnalyze(body) {
  const g = geomFrom(body), season = SEASONS[body.season] ? body.season : 'dry', choice = body.sensor === 'sentinel2' ? 'sentinel2' : 'landsat';
  const y1 = yearOf(body.y1), y2 = yearOf(body.y2);
  if (y1 === y2) throw new Error('Choose two different years.');
  const scale = choice === 'sentinel2' ? 20 : 30;
  const aoi = (await evalP(g.area(1))) / 1e6;
  if (aoi > MAX_KM2) throw new Error(`The area is too large (${Math.round(aoi)} km²). Use less than ${MAX_KM2} km².`);
  const s1 = await sceneInfo(y1, g, season, choice), s2 = await sceneInfo(y2, g, season, choice);
  if (!s1.ok || !s2.ok) throw new Error((!s1.ok ? s1.reason : s2.reason));
  const a = idx(s1.c.image), b = idx(s2.c.image);
  // spectral-index rules (NOT machine learning, NOT AI): fixed thresholds
  const water = im => im.select('ndwi').gt(0).or(im.select('mndwi').gt(0));
  const veg = im => im.select('ndvi').gt(0.35).and(water(im).not());
  const built = im => im.select('ndbi').gt(0).and(im.select('ndvi').lt(0.2)).and(water(im).not());
  const w1 = water(a), w2 = water(b), v1 = veg(a), v2 = veg(b), u1 = built(a), u2 = built(b);
  const area = ee.Image.pixelArea().divide(1e6); // km²
  const sumOf = (m, name) => area.updateMask(m).rename(name);
  const stack = ee.Image.cat([
    sumOf(w1, 'water1'), sumOf(w2, 'water2'), sumOf(w2.and(w1.not()), 'water_gain'), sumOf(w1.and(w2.not()), 'water_loss'),
    sumOf(v1, 'veg1'), sumOf(v2, 'veg2'), sumOf(v2.and(v1.not()), 'veg_gain'), sumOf(v1.and(v2.not()), 'veg_loss'),
    sumOf(u1, 'built1'), sumOf(u2, 'built2'), sumOf(u2.and(u1.not()), 'built_gain'), sumOf(u1.and(u2.not()), 'built_loss'),
    sumOf(w1.not().and(w2), 'erosion'), sumOf(w1.and(w2.not()), 'accretion'), area.rename('total')
  ]);
  const stats = await evalP(stack.unmask(0).reduceRegion({ reducer: ee.Reducer.sum(), geometry: g, scale, maxPixels: 1e10, bestEffort: true, tileScale: 4 }));
  const r = k => Math.round((stats[k] || 0) * 1000) / 1000;
  const tiles = {};
  const base = { bands: ['red', 'green', 'blue'], min: 0.02, max: 0.24, gamma: 1.2 };
  tiles.true1 = await mapP(s1.c.image, base);
  tiles.true2 = await mapP(s2.c.image, base);
  const two = (gain, loss, gc, lc) => gain.selfMask().visualize({ palette: [gc] }).blend(loss.selfMask().visualize({ palette: [lc] }));
  tiles.water = await mapP(two(w2.and(w1.not()), w1.and(w2.not()), '#00e5ff', '#ff7a00'), {});
  tiles.veg = await mapP(two(v2.and(v1.not()), v1.and(v2.not()), '#00c853', '#8d6e63'), {});
  tiles.built = await mapP(two(u2.and(u1.not()), u1.and(u2.not()), '#ff00aa', '#9e9e9e'), {});
  tiles.coast = await mapP(two(w1.and(w2.not()), w1.not().and(w2), '#00c853', '#ff1744'), {}); // green = water->land (accretion), red = land->water (erosion)
  const meta = s => ({ year: s.year, season: s.season, scenes: s.scenes, sensors: s.sensors, meanCloud: s.meanCloud, cloudLimit: s.cloudLimit });
  return {
    aoi_km2: Math.round(aoi * 10) / 10, scale_m: scale, season, sensor: choice,
    years: { y1: meta(s1), y2: meta(s2) },
    water: { y1: r('water1'), y2: r('water2'), gain: r('water_gain'), loss: r('water_loss') },
    vegetation: { y1: r('veg1'), y2: r('veg2'), gain: r('veg_gain'), loss: r('veg_loss') },
    builtup: { y1: r('built1'), y2: r('built2'), gain: r('built_gain'), loss: r('built_loss') },
    coast: { erosion: r('erosion'), accretion: r('accretion'), net: Math.round((r('accretion') - r('erosion')) * 1000) / 1000 },
    tiles,
    methods: {
      water: 'NDWI = (Green - NIR)/(Green + NIR) > 0, or MNDWI = (Green - SWIR1)/(Green + SWIR1) > 0. Spectral-index rule, not AI.',
      vegetation: 'NDVI = (NIR - Red)/(NIR + Red) > 0.35 outside water. Spectral-index rule, not AI.',
      builtup: 'NDBI = (SWIR1 - NIR)/(SWIR1 + NIR) > 0 with NDVI < 0.2 outside water. Rough proxy: bare soil and dry sand can be mistaken for built-up land.',
      coast: 'Land that became water (erosion) and water that became land (accretion) between the two composites. Tide level, river season and sediment also change the waterline, so treat it as an estimate.'
    }
  };
}

async function handleLandcover(body) {
  const g = geomFrom(body), season = SEASONS[body.season] ? body.season : 'dry', choice = body.sensor === 'sentinel2' ? 'sentinel2' : 'landsat';
  const y1 = yearOf(body.y1), y2 = yearOf(body.y2), scale = choice === 'sentinel2' ? 20 : 30;
  const [s1, s2, st] = await Promise.all([sceneInfo(y1, g, season, choice), sceneInfo(y2, g, season, choice), sceneInfo(2021, g.buffer(4000), season, choice)]);
  if (!s1.ok || !s2.ok) throw new Error(!s1.ok ? s1.reason : s2.reason);
  if (!st.ok) throw new Error('No 2021 reference imagery to train the classifier for this area.');
  // Machine learning: Random Forest trained on ESA WorldCover 2021 labels (10 m land cover) mapped to 5 classes.
  const wc = ee.Image('ESA/WorldCover/v200/2021').select('Map');
  const cls = wc.remap([10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100], [2, 2, 2, 4, 3, 5, 5, 1, 2, 2, 5]).rename('class');
  const feat = im => idx(im).select(STD.concat(['ndwi', 'ndvi', 'ndbi']));
  const trainImg = feat(st.c.image.clip(g.buffer(4000))).addBands(cls);
  const samples = trainImg.stratifiedSample({ numPoints: 250, classBand: 'class', region: g.buffer(4000), scale, seed: 11, tileScale: 4, geometries: false });
  const nS = await evalP(samples.size());
  if (nS < 60) throw new Error('Too few training pixels in this area. Draw a bigger area (include land and water).');
  const rf = ee.Classifier.smileRandomForest({ numberOfTrees: 60, seed: 7 }).train({ features: samples, classProperty: 'class', inputProperties: STD.concat(['ndwi', 'ndvi', 'ndbi']) });
  const c1 = feat(s1.c.image).classify(rf).rename('c'), c2 = feat(s2.c.image).classify(rf).rename('c');
  const area = ee.Image.pixelArea().divide(1e6);
  const grp = c => area.addBands(c).reduceRegion({ reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }), geometry: g, scale, maxPixels: 1e10, bestEffort: true, tileScale: 4 });
  const [g1, g2] = await Promise.all([evalP(grp(c1)), evalP(grp(c2))]);
  const names = { 1: 'water', 2: 'vegetation', 3: 'builtup', 4: 'cropland', 5: 'bare' };
  const flat = gr => { const o = { water: 0, vegetation: 0, builtup: 0, cropland: 0, bare: 0 }; (gr.groups || []).forEach(x => { o[names[x.class]] = Math.round(x.sum * 1000) / 1000; }); return o; };
  const vis = { min: 1, max: 5, palette: [PAL.water, PAL.veg, PAL.built, PAL.crop, PAL.bare] };
  return {
    classes: { y1: flat(g1), y2: flat(g2) },
    tiles: { lc1: await mapP(c1, vis), lc2: await mapP(c2, vis) },
    trainingPixels: nS,
    method: 'Machine learning (Google Earth Engine Random Forest, 60 trees) trained on ESA WorldCover 2021 labels and applied to both years. Accuracy was not assessed here and older images (Landsat 5/7) differ from the 2021 training data, so class areas are approximate. This is a classifier, not a prediction.',
    legend: PAL
  };
}

async function handle(req, res, p, h) {
  const { json, readBody } = h;
  if (req.method === 'GET' && p === '/api/hist/status') {
    if (!configured()) return json(res, 200, { gee: false, reason: 'GEE_SERVICE_ACCOUNT_JSON is not set on the server.' });
    try { await init(); return json(res, 200, { gee: true }); } catch (e) { return json(res, 200, { gee: false, reason: e.message }); }
  }
  const routes = { '/api/hist/scenes': handleScenes, '/api/hist/analyze': handleAnalyze, '/api/hist/landcover': handleLandcover };
  if (req.method === 'POST' && routes[p]) {
    return readBody(req, res, async body => {
      try { await init(); json(res, 200, await routes[p](body)); }
      catch (e) { console.error('[gee]', p, e && e.message); json(res, 502, { error: String(e && e.message || e).slice(0, 300) }); }
    }, 60000);
  }
  return json(res, 404, { error: 'Not found' });
}

module.exports = { handle, configured };
