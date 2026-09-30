// link health: is that "official website" link still alive, moved, or dead.
// follows redirects manually to count hops and catch the final status.
import { fetchHead, fetchText, pool } from './http.js';

export async function checkLink(url, { timeoutMs = 10000, maxHops = 5 } = {}) {
  let cur = url;
  const chain = [];
  for (let i = 0; i < maxHops; i++) {
    let r = await fetchHead(cur, { timeoutMs });
    if (r && r.status === 405) r = null; // some servers hate HEAD
    if (!r) {
      const g = await fetchText(cur, { timeoutMs });
      if (!g.ok) return { url, status: 'broken', note: g.error || 'unreachable', chain, finalUrl: cur, hops: chain.length };
      r = { status: g.status, location: null };
    }
    chain.push({ url: cur, status: r.status });
    if (r.status >= 300 && r.status < 400 && r.location) {
      try {
        cur = new URL(r.location, cur).href;
      } catch {
        return { url, status: 'broken', note: 'bad redirect', chain, finalUrl: cur, hops: chain.length };
      }
      continue;
    }
    if (r.status >= 200 && r.status < 300) {
      const hops = chain.length - 1;
      return {
        url,
        status: hops ? 'redirected' : 'alive',
        chain,
        finalUrl: cur,
        hops,
        outdated: hops >= 2 ? 'redirect chain (' + hops + ' hops)' : null,
      };
    }
    return { url, status: 'broken', note: 'http-' + r.status, chain, finalUrl: cur, hops: chain.length };
  }
  return { url, status: 'broken', note: 'too many redirects', chain, finalUrl: cur, hops: chain.length };
}

export async function analyzeLinks(links, { timeoutMs = 10000, concurrency = 4, cap = 15 } = {}) {
  const urls = [
    ...new Set(
      (links || [])
        .map((l) => (typeof l === 'string' ? l : l && l.url))
        .filter((u) => u && /^https?:\/\//i.test(u))
    ),
  ].slice(0, cap);
  return pool(urls, concurrency, (u) => checkLink(u, { timeoutMs }));
}
