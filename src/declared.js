// declared identity: only what people publicly say about themselves.
// rel=me links, feeds, schema.org metadata. no guessing, no inference.
import { fetchText, pool } from './http.js';

function attrs(tag) {
  const m = {};
  const re = /([\w:-]+)\s*=\s*["']([^"']*)["']/g;
  let x;
  while ((x = re.exec(tag))) m[x[1].toLowerCase()] = x[2];
  return m;
}

function absUrl(href, base) {
  try {
    const u = new URL(href, base);
    return u.protocol.startsWith('http') ? u.href : null;
  } catch {
    return null;
  }
}

// <link rel="me"> and <a rel="me"> — rel can be "me author" etc.
export function extractRelMe(html, baseUrl) {
  const out = [];
  if (!html) return out;
  const re = /<(link|a)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = attrs(m[0]);
    const rel = String(a.rel || '').toLowerCase().split(/\s+/);
    if (!rel.includes('me') || !a.href) continue;
    const url = absUrl(a.href, baseUrl);
    if (url) out.push({ url, tag: m[1], source: baseUrl });
  }
  const seen = new Set();
  return out.filter((o) => {
    if (seen.has(o.url)) return false;
    seen.add(o.url);
    return true;
  });
}

// fetch the target, check it links back with rel=me to the source
// (or anywhere on the source's domain). mastodon-style proof.
export async function verifyRelMe(link, { timeoutMs = 10000 } = {}) {
  const fail = (evidence) => ({ ...link, verified: false, evidence });
  let r;
  try {
    r = await fetchText(link.url, { timeoutMs });
  } catch {
    return fail('fetch failed');
  }
  if (!r.ok) return fail('target unreachable');
  const back = extractRelMe(r.body, r.url || link.url);
  let srcHost = '';
  try {
    srcHost = new URL(link.source).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  const hit = back.find((b) => {
    if (b.url === link.source) return true;
    try {
      return !!srcHost && new URL(b.url).hostname.toLowerCase() === srcHost;
    } catch {
      return false;
    }
  });
  return hit ? { ...link, verified: true, evidence: 'backlink: ' + hit.url } : { ...link, verified: false, evidence: 'no rel=me backlink' };
}

// <link rel="alternate" type="application/rss+xml|atom+xml">
export function extractFeedLinks(html, baseUrl) {
  const out = [];
  if (!html) return out;
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = attrs(m[0]);
    const rel = String(a.rel || '').toLowerCase().split(/\s+/);
    const type = String(a.type || '').toLowerCase();
    if (rel.includes('alternate') && (type.includes('rss') || type.includes('atom')) && a.href) {
      const url = absUrl(a.href, baseUrl);
      if (url) out.push(url);
    }
  }
  return [...new Set(out)];
}

function unesc(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .trim();
}

function pick(src, tag) {
  const m = src.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? unesc(m[1]) : null;
}

// handles RSS <item> and Atom <entry>. regexes, good enough.
export function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return null;
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) return null; // not a feed at all
  const isAtom = /<feed[\s>]/i.test(xml);
  const scope = isAtom ? xml : ((xml.match(/<channel[\s>][\s\S]*?<\/channel>/i) || [])[0] || xml);
  const chanAuthor =
    pick(scope, 'managingEditor') ||
    pick(scope, 'dc:creator') ||
    (() => {
      const a = scope.match(/<author[\s>][\s\S]*?<\/author>/i);
      return a ? pick(a[0], 'name') : null;
    })();
  let chanLink = pick(scope, 'link');
  const lm = scope.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (lm) chanLink = lm[1];
  const items = [];
  const re = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 8) {
    const it = m[0];
    let link = pick(it, 'link');
    const ilm = it.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (ilm) link = ilm[1];
    const am = it.match(/<author[\s>][\s\S]*?<\/author>/i);
    items.push({
      title: (pick(it, 'title') || '').slice(0, 160),
      link,
      pubDate: pick(it, 'pubDate') || pick(it, 'published') || pick(it, 'updated'),
      author: (am ? pick(am[0], 'name') : null) || pick(it, 'dc:creator'),
    });
  }
  return {
    kind: isAtom ? 'atom' : 'rss',
    title: (pick(scope, 'title') || '').slice(0, 160),
    link: chanLink,
    author: chanAuthor,
    updated: pick(scope, 'lastBuildDate') || pick(scope, 'updated'),
    items,
  };
}

export async function fetchFeed(url, { timeoutMs = 12000 } = {}) {
  try {
    const r = await fetchText(url, { timeoutMs });
    if (!r.ok) return null;
    const f = parseFeed(r.body);
    return f ? { url, ...f } : null;
  } catch {
    return null;
  }
}

// <script type="application/ld+json"> → Person / ProfilePage nodes
export function extractJsonLd(html) {
  const out = [];
  if (!html) return out;
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* broken json-ld, skip */
    }
  }
  return out;
}

export function schemaProfiles(html) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const types = [].concat(node['@type'] || []);
    if (types.includes('Person') || types.includes('ProfilePage')) {
      found.push({
        type: types.includes('Person') ? 'Person' : 'ProfilePage',
        name: node.name || null,
        alternateName: node.alternateName || null,
        url: node.url || null,
        sameAs: [].concat(node.sameAs || []).filter(Boolean).map(String),
        description: node.description ? String(node.description).slice(0, 300) : null,
      });
    }
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
  };
  extractJsonLd(html).forEach(visit);
  const seen = new Set();
  return found.filter((p) => {
    const k = (p.name || '') + '|' + (p.url || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// declared authors vs known display names. string compare only.
export function authorAttribution(declaredAuthors, knownNames) {
  const known = (knownNames || []).map((n) => String(n || '').toLowerCase()).filter(Boolean);
  return (declaredAuthors || []).map((a) => {
    const s = String(a.author || '').toLowerCase().trim();
    const verdict = !s ? 'unknown' : known.some((k) => s === k || s.includes(k)) ? 'consistent' : 'mismatch';
    return { ...a, verdict };
  });
}

// graph from declared evidence only. never inferred.
export function buildIdentityGraph({ seeds = [] } = {}) {
  const nodes = new Map();
  const edges = [];
  const seen = new Set();
  const addNode = (url, kind) => {
    if (!url) return;
    if (!nodes.has(url)) nodes.set(url, { url, kind, label: shortLabel(url) });
  };
  const addEdge = (from, to, evidence) => {
    if (!from || !to || from === to) return;
    const k = from + '>' + to + '>' + evidence;
    if (seen.has(k)) return;
    seen.add(k);
    addNode(from, 'seed');
    addNode(to, 'profile');
    edges.push({ from, to, evidence });
  };
  for (const s of seeds) {
    if (!s || !s.url) continue;
    addNode(s.url, 'seed');
    for (const r of s.relMe || []) addEdge(s.url, r.url, r.verified ? 'rel=me verified' : 'rel=me one-way');
    for (const p of s.schemas || []) {
      for (const sa of p.sameAs || []) addEdge(s.url, sa, 'schema:sameAs');
      if (p.url && p.url !== s.url) addEdge(s.url, p.url, 'schema:url');
    }
    for (const f of s.feeds || []) if (f.link) addEdge(s.url, f.link, 'feed:link');
    for (const pl of s.profileLinks || []) addEdge(s.url, typeof pl === 'string' ? pl : pl.url, 'profile:website');
  }
  return { nodes: [...nodes.values()], edges };
}

function shortLabel(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.slice(0, 24) : '');
  } catch {
    return String(url).slice(0, 40);
  }
}

export function graphToAscii(graph) {
  const lines = [];
  const byFrom = new Map();
  for (const e of graph.edges || []) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from).push(e);
  }
  const labelOf = (url) => {
    const n = (graph.nodes || []).find((x) => x.url === url);
    return n ? n.label : shortLabel(url);
  };
  for (const s of (graph.nodes || []).filter((n) => n.kind === 'seed')) {
    lines.push(s.url);
    const es = byFrom.get(s.url) || [];
    es.forEach((e, i) => {
      lines.push((i === es.length - 1 ? '└─ ' : '├─ ') + e.evidence + ' → ' + labelOf(e.to));
    });
  }
  return lines.length ? lines.join('\n') : '(empty graph)';
}

// full per-seed analysis. never throws.
export async function analyzeDeclared({ seeds = [], timeoutMs = 12000, concurrency = 3, onStep = () => {} } = {}) {
  return pool(seeds.slice(0, 6), concurrency, async (seedUrl) => {
    const a = { url: seedUrl, relMe: [], schemas: [], feeds: [], error: null };
    try {
      onStep('fetch ' + shortLabel(seedUrl));
      const r = await fetchText(seedUrl, { timeoutMs });
      if (!r.ok) {
        a.error = 'unreachable';
        return a;
      }
      const base = r.url || seedUrl;
      a.schemas = schemaProfiles(r.body);
      const rel = extractRelMe(r.body, base);
      onStep('verify ' + rel.length + ' rel=me links');
      a.relMe = await pool(rel.slice(0, 8), 3, (l) => verifyRelMe(l, { timeoutMs: Math.min(timeoutMs, 10000) }));
      const feedUrls = extractFeedLinks(r.body, base).slice(0, 3);
      onStep('parse ' + feedUrls.length + ' feeds');
      a.feeds = (await pool(feedUrls, 2, (u) => fetchFeed(u, { timeoutMs }))).filter(Boolean);
    } catch {
      a.error = 'failed';
    }
    return a;
  });
}
