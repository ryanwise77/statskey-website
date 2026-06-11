// Stateless proxy: signs in to Abbott's LibreLink Up API with the patient's
// own Libre app credentials, fetches up to 90 days of glucose history, and
// returns ONLY derived summary numbers. Credentials and tokens are never
// stored, logged, or echoed back; each request is a fresh login.
//
// This is the community-documented API (the same one StatsKey's app and the
// Nightscout ecosystem use). Abbott occasionally changes header requirements;
// LIBRE_LLU_VERSION can be overridden via env without a code change.

import { createHash } from 'node:crypto';

const LLU_VERSION = process.env.LIBRE_LLU_VERSION || '4.12.0';
const LLU_PRODUCT = 'llu.android';
const UPSTREAM_TIMEOUT_MS = 20000;
const MAX_REGION_HOPS = 3;

const MEAL_WINDOWS = {
  after_breakfast: [6, 11],
  after_lunch: [11, 16],
  after_dinner: [16, 22],
  overnight: [22, 6],
};

const baseUrl = (region) => (region ? `https://api-${region}.libreview.io` : 'https://api.libreview.io');

function lluHeaders(token, accountId) {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json',
    product: LLU_PRODUCT,
    version: LLU_VERSION,
    'cache-control': 'no-cache',
  };
  if (token) h.authorization = `Bearer ${token}`;
  if (accountId) h['account-id'] = createHash('sha256').update(accountId).digest('hex');
  return h;
}

async function lluFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Resolves to { token, accountId, region } or throws { code }.
async function login(email, password) {
  let region = null;
  for (let hop = 0; hop <= MAX_REGION_HOPS; hop++) {
    let res;
    try {
      res = await lluFetch(baseUrl(region) + '/llu/auth/login', {
        method: 'POST',
        headers: lluHeaders(),
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw { code: 'upstream_unreachable' };
    }
    if (res.status === 401 || res.status === 403) throw { code: 'bad_credentials' };
    if (res.status === 429) throw { code: 'rate_limited' };
    if (!res.ok) throw { code: 'upstream_error' };
    let json;
    try {
      json = await res.json();
    } catch {
      throw { code: 'upstream_error' };
    }

    if (json && json.data && json.data.redirect && json.data.region) {
      region = String(json.data.region);
      continue;
    }
    if (json && json.status === 2) throw { code: 'bad_credentials' };

    let token = json && json.data && json.data.authTicket && json.data.authTicket.token;
    let accountId = json && json.data && json.data.user && json.data.user.id;

    // Pending terms-of-use/privacy step: acknowledge it the same way the
    // official app would, once; if that fails, surface it to the user.
    const step = json && json.data && json.data.step;
    if (!token && step && step.type) {
      throw { code: 'terms_needed' };
    }
    if (json && json.status === 4) {
      const stepType = (step && step.type) || 'tou';
      if (!token) throw { code: 'terms_needed' };
      try {
        const cont = await lluFetch(baseUrl(region) + '/auth/continue/' + stepType, {
          method: 'POST',
          headers: lluHeaders(token, accountId),
        });
        const contJson = await cont.json();
        token = contJson && contJson.data && contJson.data.authTicket && contJson.data.authTicket.token;
        accountId = (contJson && contJson.data && contJson.data.user && contJson.data.user.id) || accountId;
        if (!token) throw new Error();
      } catch {
        throw { code: 'terms_needed' };
      }
    }

    if (!token || !accountId) throw { code: 'upstream_changed' };
    return { token, accountId, region };
  }
  throw { code: 'upstream_changed' };
}

/* ---- Generic reading extraction ----
   The glucoseHistory payload shape isn't formally documented, so instead of
   binding to exact field names we deep-scan for objects that look like
   readings: a glucose-ish numeric field plus a parseable timestamp. */

const VALUE_KEYS_MG = ['valueinmgperdl'];
const VALUE_KEYS_ANY = ['value', 'glucosevalue', 'glucose'];
const TIME_KEYS = ['timestamp', 'factorytimestamp', 'date', 'datetime', 'time'];

const TS_US = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i;
const TS_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/;

function parseTimestamp(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : null; // epoch s or ms
    if (ms) { const d = new Date(ms); return { t: d.getTime(), h: d.getHours() }; }
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = TS_ISO.exec(s);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return { t: d.getTime(), h: d.getHours() };
  }
  m = TS_US.exec(s);
  if (m) {
    let h = +m[4];
    const ampm = m[6] ? m[6].toUpperCase() : null;
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    const d = new Date(+m[3], +m[1] - 1, +m[2], h, +m[5]);
    return { t: d.getTime(), h };
  }
  return null;
}

function extractReadings(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) extractReadings(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;

  let value = null, isMg = false;
  let when = null;
  for (const [key, v] of Object.entries(node)) {
    const k = key.toLowerCase();
    if (value === null && typeof v === 'number' && Number.isFinite(v)) {
      if (VALUE_KEYS_MG.includes(k)) { value = v; isMg = true; }
      else if (VALUE_KEYS_ANY.includes(k)) value = v;
    } else if (VALUE_KEYS_MG.includes(k) && typeof v === 'number') { value = v; isMg = true; }
    if (!when && TIME_KEYS.includes(k)) when = parseTimestamp(v);
  }
  if (value !== null && when) {
    // Unit heuristic for non-explicit fields: CGM mmol/L values live below ~28.
    const mg = isMg || value > 30 ? value : value * 18.016;
    if (mg >= 20 && mg <= 600) out.push({ v: mg, t: when.t, h: when.h });
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') extractReadings(v, out);
  }
}

function summarize(readings) {
  // The endpoint is asked for 90 days, but clamp anyway relative to newest.
  const tMax = Math.max(...readings.map((r) => r.t));
  const recent = readings.filter((r) => r.t >= tMax - 90 * 86400000);
  if (recent.length < 24) return null;

  const n = recent.length;
  let sum = 0, above180 = 0, above250 = 0, below70 = 0;
  const winCount = {}, winHigh = {};
  for (const k of Object.keys(MEAL_WINDOWS)) { winCount[k] = 0; winHigh[k] = 0; }
  const days = new Set();
  for (const r of recent) {
    sum += r.v;
    if (r.v > 180) above180++;
    if (r.v > 250) above250++;
    if (r.v < 70) below70++;
    days.add(Math.floor((r.t + 6 * 3600000) / 86400000));
    for (const [k, [start, end]] of Object.entries(MEAL_WINDOWS)) {
      const inWin = start < end ? r.h >= start && r.h < end : r.h >= start || r.h < end;
      if (inWin) { winCount[k]++; if (r.v > 180) winHigh[k]++; }
    }
  }
  const pct = (c) => Math.round((c / n) * 1000) / 10;
  const pctAbove180 = pct(above180);
  const windows = {};
  for (const k of Object.keys(MEAL_WINDOWS)) {
    windows[k] = winCount[k] ? Math.round((winHigh[k] / winCount[k]) * 1000) / 10 : 0;
  }
  let flagged = Object.keys(windows).filter(
    (k) => windows[k] >= 8 && (windows[k] >= pctAbove180 + 5 || windows[k] >= pctAbove180 * 1.3)
  );
  if (flagged.length === 0 && pctAbove180 >= 5) {
    const top = Object.keys(windows).sort((a, b) => windows[b] - windows[a])[0];
    if (windows[top] >= 5) flagged = [top];
  }
  const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return {
    readings: n,
    days: days.size,
    from: fmt(Math.min(...recent.map((r) => r.t))),
    to: fmt(tMax),
    pctAbove180,
    pctAbove250: pct(above250),
    pctBelow70: pct(below70),
    avg: Math.round(sum / n),
    flagged,
  };
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return undefined; }
    }
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return undefined;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const body = await readJsonBody(req);
  const email = body && typeof body.email === 'string' ? body.email.trim() : '';
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!email || !password || email.length > 254 || password.length > 128) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  let session;
  try {
    session = await login(email, password);
  } catch (e) {
    const code = e && e.code ? e.code : 'upstream_error';
    const status = code === 'bad_credentials' ? 401 : code === 'terms_needed' ? 409 : 502;
    res.status(status).json({ error: code });
    return;
  }

  let json;
  try {
    const histRes = await lluFetch(
      baseUrl(session.region) + '/glucoseHistory?numPeriods=5&period=90',
      { method: 'GET', headers: lluHeaders(session.token, session.accountId) }
    );
    if (histRes.status === 401 || histRes.status === 403) {
      res.status(502).json({ error: 'upstream_changed' });
      return;
    }
    if (!histRes.ok) {
      res.status(502).json({ error: 'upstream_error' });
      return;
    }
    json = await histRes.json();
  } catch {
    res.status(502).json({ error: 'upstream_unreachable' });
    return;
  }

  const readings = [];
  extractReadings(json && json.data !== undefined ? json.data : json, readings);
  const summary = readings.length >= 24 ? summarize(readings) : null;
  if (!summary) {
    // Account reachable but no usable history (no uploads, or shape changed).
    res.status(502).json({ error: 'no_data' });
    return;
  }
  res.status(200).json({ summary });
}
