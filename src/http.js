// Tiny HTTP helper: timeouts, browser-like UA, concurrency pool, JSON helpers.
// Zero dependencies — uses only Node.js built-ins.
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 EvilTrace/3.0';

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

function timeoutError(err) {
  return err && err.name === 'AbortError' ? 'timeout' : String((err && err.message) || err);
}

// body read with its own timeout. on timeout the stream is cancelled, not
// aborted mid-read — aborting mid-read can crash undici (ERR_ASSERTION).
async function readBodyTimeout(res, ms) {
  let timer;
  try {
    return await Promise.race([
      res.text(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('body-timeout')), ms);
      }),
    ]);
  } catch (err) {
    try {
      if (res.body) await res.body.cancel();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function connect(url, { timeoutMs, headers }) {
  const t = timeoutSignal(timeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, redirect: 'follow', headers });
    t.done();
    return { res };
  } catch (err) {
    t.done();
    return { error: timeoutError(err) };
  }
}

export async function fetchText(url, { timeoutMs = 12000 } = {}) {
  const { res, error } = await connect(url, {
    timeoutMs,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
  });
  if (error) return { ok: false, url, error };
  try {
    const body = await readBodyTimeout(res, timeoutMs);
    return { ok: true, url: res.url, status: res.status, body: body.slice(0, 250_000) };
  } catch (err) {
    return { ok: false, url, error: err && err.message === 'body-timeout' ? 'timeout' : String((err && err.message) || err) };
  }
}

export async function fetchBytes(url, { timeoutMs = 15000 } = {}) {
  const { res, error } = await connect(url, { timeoutMs, headers: { 'User-Agent': USER_AGENT } });
  if (error) return { ok: false, url, error };
  if (!res.ok) {
    try {
      if (res.body) await res.body.cancel();
    } catch {
      /* ignore */
    }
    return { ok: false, url, error: 'http-' + res.status };
  }
  let timer;
  try {
    const bytes = await Promise.race([
      res.arrayBuffer().then((ab) => Buffer.from(ab)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('body-timeout')), timeoutMs);
      }),
    ]);
    if (bytes.length > 5_000_000) return { ok: false, url, error: 'too-large' };
    return { ok: true, url: res.url, bytes };
  } catch (err) {
    try {
      if (res.body) await res.body.cancel();
    } catch {
      /* ignore */
    }
    return { ok: false, url, error: err && err.message === 'body-timeout' ? 'timeout' : String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

// HEAD, no body read. returns { status, location, ok } or null.
export async function fetchHead(url, { timeoutMs = 10000 } = {}) {
  const t = timeoutSignal(timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: t.signal,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
    });
    t.done();
    const out = { status: res.status, location: res.headers.get('location'), ok: res.ok };
    try {
      if (res.body) await res.body.cancel();
    } catch {
      /* ignore */
    }
    return out;
  } catch {
    t.done();
    return null;
  }
}

// Keyless public JSON API helper. Returns parsed JSON or null on any failure.
export async function fetchJSON(url, { timeoutMs = 12000, headers = {} } = {}) {
  const r = await fetchJSONStatus(url, { timeoutMs, headers });
  return r && r.status >= 200 && r.status < 300 ? r.json : null;
}

// Status-aware JSON helper: returns { status, json } (json may be null).
// Used where the HTTP status itself carries meaning (e.g. GitHub 404).
export async function fetchJSONStatus(url, { timeoutMs = 12000, headers = {} } = {}) {
  const { res, error } = await connect(url, {
    timeoutMs,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
  });
  if (error) return null;
  const status = res.status;
  try {
    const text = await readBodyTimeout(res, timeoutMs);
    if (!text || text.length > 2_000_000) return { status, json: null };
    try {
      return { status, json: JSON.parse(text) };
    } catch {
      return { status, json: null };
    }
  } catch {
    return { status, json: null };
  }
}

// JSON POST helper (used for the Roblox username lookup API). Null on failure.
export async function postJSON(url, payload, { timeoutMs = 12000 } = {}) {
  const t = timeoutSignal(timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: t.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    t.done();
  } catch (err) {
    t.done();
    return null;
  }
  try {
    const text = await readBodyTimeout(res, timeoutMs);
    if (!res.ok) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// Run fn over items with at most `concurrency` in flight. Never throws.
export async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        results[idx] = { error: String((err && err.message) || err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
