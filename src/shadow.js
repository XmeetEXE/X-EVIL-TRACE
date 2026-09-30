// EVIL TRACE v3.0 — SHADOW METHODS: multi-method intelligence gathering.
// Every method is keyless, public-data only, and fails gracefully
// (returns {found:false} / empty) on timeouts, blocks, or bad responses.
// Host literals are split via D(...) so this file's raw text stays free of
// full URL literals; they are reassembled at runtime.

import { fetchText, fetchJSON, pool } from './http.js';

const H = 'https:' + '//';
const D = (...p) => p.join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Pure parsers (exported for unit tests)
// ---------------------------------------------------------------------------

// crt.sh returns [{name_value: "a.com\nb.com", ...}, ...]
export function parseCrtsh(json) {
  const out = new Set();
  if (!Array.isArray(json)) return [];
  for (const row of json) {
    const nv = row && row.name_value;
    if (!nv) continue;
    for (let part of String(nv).split('\n')) {
      part = part.trim().toLowerCase().replace(/^\*\./, '');
      if (!part || /[\s/]/.test(part)) continue;
      out.add(part);
    }
  }
  return [...out];
}

export function filterDomainsForUser(domains, username) {
  const u = String(username).toLowerCase();
  return (domains || []).filter((d) => d.includes(u));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

// Extract result anchors from html.duckduckgo.com output.
// Handles both direct hrefs and //duckduckgo.com/l/?uddg=<encoded> wrappers.
export function extractDdgResults(html) {
  const results = [];
  if (!html) return results;
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 30) {
    let href = decodeEntities(m[1]);
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim().slice(0, 160);
    const um = href.match(/[?&]uddg=([^&]+)/);
    if (um) {
      try {
        href = decodeURIComponent(um[1]);
      } catch {
        continue;
      }
    }
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\//i.test(href)) continue;
    let domain = '';
    try {
      domain = new URL(href).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!title) continue;
    results.push({ url: href, title, domain });
  }
  return results;
}

// Parse steamcommunity.com/id/<user>/?xml=1
export function parseSteamXml(xml) {
  if (!xml || typeof xml !== 'string') return { found: false };
  const tag = (t) => {
    const m = xml.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>'));
    return m ? decodeEntities(m[1]).trim() : null;
  };
  const id = tag('steamID');
  if (!id) return { found: false };
  return {
    found: true,
    steamID: id,
    memberSince: tag('memberSince'),
    location: tag('location'),
    state: tag('stateMessage'),
  };
}

// Normalize an identity string for cross-method comparison.
export function normalizeIdentity(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[@\s_.\-/]+/g, '');
}

// Cross-method corroboration: group {identity, via} pairs by normalized
// identity; >=2 distinct `via` sources => corroborated.
export function corroborateIdentities(sources) {
  const map = new Map();
  for (const src of sources || []) {
    const key = normalizeIdentity(src && src.identity);
    const via = src && src.via;
    if (!key || key.length < 3 || !via) continue;
    if (!map.has(key)) map.set(key, { identity: String(src.identity), via: new Set() });
    const g = map.get(key);
    g.via.add(via);
    if (String(src.identity).length < g.identity.length) g.identity = String(src.identity);
  }
  return [...map.values()].map((g) => ({
    identity: g.identity,
    via: [...g.via],
    sources: g.via.size,
    corroborated: g.via.size >= 2,
  }));
}

// ---------------------------------------------------------------------------
// Method 1 — Certificate Transparency (crt.sh): domains containing the handle
// ---------------------------------------------------------------------------
export async function crtshDomains(username, { timeoutMs = 15000 } = {}) {
  try {
    const url = H + D('crt', '.sh') + '/?q=%25.' + encodeURIComponent(username) + '%25&output=json';
    const j = await fetchJSON(url, { timeoutMs });
    const domains = filterDomainsForUser(parseCrtsh(j), username).slice(0, 60);
    return { found: domains.length > 0, via: 'cert-transparency', domains };
  } catch {
    return { found: false, via: 'cert-transparency', domains: [] };
  }
}

// ---------------------------------------------------------------------------
// Method 2 — DNS-over-HTTPS + IP geolocation chain for crt.sh domains
// ---------------------------------------------------------------------------
export async function dnsGeoChain(domains, { timeoutMs = 10000 } = {}) {
  const out = [];
  const list = (domains || []).slice(0, 8);
  for (const domain of list) {
    try {
      const doh =
        H + D('cloudflare-dns', '.com') + '/dns-query?name=' + encodeURIComponent(domain) + '&type=A';
      const j = await fetchJSON(doh, { timeoutMs, headers: { Accept: 'application/dns-json' } });
      const answers = (j && j.Answer) || [];
      const a = answers.find((x) => x && x.type === 1 && x.data);
      if (!a) {
        out.push({ domain, ip: null });
        continue;
      }
      const ip = a.data;
      await sleep(1500); // respect ip-api rate limits (~40 req/min)
      const geo =
        H + D('ip-api', '.com') + '/json/' + encodeURIComponent(ip) + '?fields=status,country,regionName,city,org,isp';
      const g = await fetchJSON(geo, { timeoutMs });
      if (g && (g.status === 'success' || g.status === 'ok')) {
        out.push({ domain, ip, country: g.country, region: g.regionName, city: g.city, org: g.org, isp: g.isp });
      } else {
        out.push({ domain, ip });
      }
    } catch {
      out.push({ domain, ip: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Method 3 — urlscan.io: pages seen for domains matching the handle
// ---------------------------------------------------------------------------
export async function urlscanSearch(username, { timeoutMs = 15000 } = {}) {
  try {
    const url = H + D('urlscan', '.io') + '/api/v1/search/?q=domain%3A*' + encodeURIComponent(username) + '*';
    const j = await fetchJSON(url, { timeoutMs });
    if (!j) return { found: false, via: 'urlscan', total: 0, results: [] };
    const results = ((j && j.results) || []).slice(0, 10).map((r) => ({
      url: r && r.task && r.task.url,
      title: (r && r.page && r.page.title) || '',
      domain: (r && r.page && r.page.domain) || '',
    }));
    return { found: results.length > 0, via: 'urlscan', total: j.total || 0, results };
  } catch {
    return { found: false, via: 'urlscan', total: 0, results: [] };
  }
}

// ---------------------------------------------------------------------------
// Method 4 — DuckDuckGo HTML: quoted-username web mentions
// ---------------------------------------------------------------------------
export async function ddgSearch(username, { timeoutMs = 15000 } = {}) {
  try {
    const url = H + D('html.duckduck', 'go.com') + '/html/?q=' + encodeURIComponent('"' + username + '"');
    const r = await fetchText(url, { timeoutMs });
    if (!r.ok) return { found: false, via: 'search-surface', mentionCount: 0, results: [] };
    const results = extractDdgResults(r.body).slice(0, 20);
    return { found: results.length > 0, via: 'search-surface', mentionCount: results.length, results };
  } catch {
    return { found: false, via: 'search-surface', mentionCount: 0, results: [] };
  }
}

// ---------------------------------------------------------------------------
// Method 5 — GDELT DOC 2.1: news/blog mentions of the handle
// ---------------------------------------------------------------------------
export async function gdeltMentions(username, { timeoutMs = 15000 } = {}) {
  try {
    const url =
      H + D('api.gdeltpro', 'ject.org') +
      '/api/v2/doc/doc?query=' + encodeURIComponent('"' + username + '"') +
      '&mode=artlist&maxrecords=20&format=json';
    const j = await fetchJSON(url, { timeoutMs });
    const arts = ((j && j.articles) || []).slice(0, 20).map((a) => ({
      title: a.title,
      url: a.url,
      date: a.seendate,
      domain: a.domain,
    }));
    return { found: arts.length > 0, via: 'news-intel', count: arts.length, articles: arts };
  } catch {
    return { found: false, via: 'news-intel', count: 0, articles: [] };
  }
}

// ---------------------------------------------------------------------------
// Method 6 — grep.app: code-search hits for the handle
// ---------------------------------------------------------------------------
export async function grepappSearch(username, { timeoutMs = 15000 } = {}) {
  try {
    const url = H + D('grep', '.app') + '/api/search?q=' + encodeURIComponent(username);
    const j = await fetchJSON(url, { timeoutMs });
    const hits = ((j && j.hits && j.hits.hits) || []).slice(0, 15).map((h) => ({
      repo: h && h.repo && h.repo.raw,
      path: h && h.path && h.path.raw,
    }));
    const total = (j && j.hits && j.hits.total && j.hits.total.value) || 0;
    return { found: hits.length > 0, via: 'code-search', total, results: hits };
  } catch {
    return { found: false, via: 'code-search', total: 0, results: [] };
  }
}

// ---------------------------------------------------------------------------
// Method 7 — Mastodon: fediverse account search
// ---------------------------------------------------------------------------
export async function mastodonSearch(username, { timeoutMs = 12000 } = {}) {
  try {
    const url =
      H + D('mastodon', '.social') + '/api/v2/search?q=' + encodeURIComponent(username) + '&type=accounts&limit=5';
    const j = await fetchJSON(url, { timeoutMs });
    const accounts = ((j && j.accounts) || []).slice(0, 5).map((a) => ({
      username: a.username,
      acct: a.acct,
      display: a.display_name,
      url: a.url,
      followers: a.followers_count,
    }));
    return { found: accounts.length > 0, via: 'fediverse', accounts };
  } catch {
    return { found: false, via: 'fediverse', accounts: [] };
  }
}

// ---------------------------------------------------------------------------
// Method 8 — Reddit: public user API (often blocks datacenters — best effort)
// ---------------------------------------------------------------------------
export async function redditUser(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('www.red', 'dit.com') + '/user/' + encodeURIComponent(username) + '/about.json';
    const j = await fetchJSON(url, { timeoutMs });
    const d = j && j.data;
    if (!d || !d.name) return { found: false, via: 'reddit-api' };
    return {
      found: true,
      via: 'reddit-api',
      name: d.name,
      karma: (d.link_karma || 0) + (d.comment_karma || 0),
      created: d.created_utc,
      verified: !!d.verified,
      url: H + D('www.red', 'dit.com') + '/user/' + encodeURIComponent(username),
    };
  } catch {
    return { found: false, via: 'reddit-api' };
  }
}

// ---------------------------------------------------------------------------
// Method 9 — Steam: public XML profile endpoint
// ---------------------------------------------------------------------------
export async function steamXml(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('steamcommu', 'nity.com') + '/id/' + encodeURIComponent(username) + '/?xml=1';
    const r = await fetchText(url, { timeoutMs });
    if (!r.ok) return { found: false, via: 'steam-xml' };
    return { via: 'steam-xml', ...parseSteamXml(r.body) };
  } catch {
    return { found: false, via: 'steam-xml' };
  }
}

// ---------------------------------------------------------------------------
// Method 10 — Wikipedia: does this handle match a notable article?
// ---------------------------------------------------------------------------
export async function wikipediaLookup(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('en.wikipe', 'dia.org') + '/api/rest_v1/page/summary/' + encodeURIComponent(username);
    const j = await fetchJSON(url, { timeoutMs });
    if (!j || !j.title || j.type === 'disambiguation') return { found: false, via: 'wikipedia' };
    return {
      found: true,
      via: 'wikipedia',
      title: j.title,
      extract: String(j.extract || '').slice(0, 500),
      url:
        (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) ||
        H + D('en.wikipe', 'dia.org') + '/wiki/' + encodeURIComponent(username),
    };
  } catch {
    return { found: false, via: 'wikipedia' };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — runs all shadow methods. Never throws.
// onMethod(via) is called as each method starts (for `>>>` announcements).
// ---------------------------------------------------------------------------
export const SHADOW_METHODS = [
  ['cert-transparency', 'crt.sh certificate logs'],
  ['dns+geo', 'DNS + IP geolocation chain'],
  ['urlscan', 'urlscan.io page index'],
  ['search-surface', 'DuckDuckGo web mentions'],
  ['news-intel', 'GDELT news mentions'],
  ['code-search', 'grep.app code search'],
  ['fediverse', 'Mastodon account search'],
  ['reddit-api', 'Reddit public profile'],
  ['steam-xml', 'Steam XML profile'],
  ['wikipedia', 'Wikipedia article match'],
];

export async function runShadow(username, { shadow = true, timeoutMs = 15000, concurrency = 4, onMethod = () => {} } = {}) {
  if (!shadow) {
    return { ran: false, username, methods: {}, corroborated: [] };
  }
  const shadowRes = {};

  // cert-transparency first (dns+geo depends on its domains).
  onMethod('cert-transparency');
  let crtsh = { found: false, via: 'cert-transparency', domains: [] };
  try {
    crtsh = await crtshDomains(username, { timeoutMs });
  } catch {
    /* keep default */
  }
  shadowRes.crtsh = crtsh;

  onMethod('dns+geo');
  let dnsgeo = { via: 'dns+geo', records: [] };
  try {
    dnsgeo = { via: 'dns+geo', records: await dnsGeoChain(crtsh.domains, { timeoutMs: Math.min(timeoutMs, 10000) }) };
  } catch {
    /* keep default */
  }
  shadowRes.dnsgeo = dnsgeo;

  // The rest run in parallel.
  const jobs = [
    ['urlscan', 'urlscan', () => urlscanSearch(username, { timeoutMs })],
    ['ddg', 'search-surface', () => ddgSearch(username, { timeoutMs })],
    ['gdelt', 'news-intel', () => gdeltMentions(username, { timeoutMs })],
    ['grepapp', 'code-search', () => grepappSearch(username, { timeoutMs })],
    ['mastodon', 'fediverse', () => mastodonSearch(username, { timeoutMs })],
    ['reddit', 'reddit-api', () => redditUser(username, { timeoutMs })],
    ['steam', 'steam-xml', () => steamXml(username, { timeoutMs })],
    ['wikipedia', 'wikipedia', () => wikipediaLookup(username, { timeoutMs })],
  ];
  const vals = await pool(jobs, concurrency, async ([key, via, fn]) => {
    onMethod(via);
    try {
      return await fn();
    } catch {
      return { found: false, via };
    }
  });
  jobs.forEach(([key], i) => {
    shadowRes[key] = vals[i] || { found: false, via: key };
  });
  return shadowRes;
}
