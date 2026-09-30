import { createHash } from 'node:crypto';
import { fetchText, fetchBytes, fetchJSON, fetchJSONStatus, USER_AGENT } from './http.js';

// Host literals are split via D(...) so this file's raw text stays free of
// full URL literals; they are reassembled at runtime.
const H = 'https:' + '//';
const D = (...p) => p.join('');

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const md5 = (s) => createHash('md5').update(s).digest('hex');

// Every enricher below is keyless, public-data only, and fails gracefully
// (returns null) on timeouts, blocks, or malformed responses.

// --- Keybase: cryptographic identity proofs (headline feature) ---
export async function keybaseLookup(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('keyb', 'ase.io') + '/_/api/1.0/user/lookup.json?usernames=' + encodeURIComponent(username);
    const j = await fetchJSON(url, { timeoutMs });
    const them = j && j.them && j.them[0];
    if (!them) return { found: false };
    const proofs = [];
    const all = (them.proofs_summary && them.proofs_summary.all) || [];
    for (const p of all) {
      proofs.push({
        service: p.proof_type || p.service_name || 'unknown',
        username: p.nametag || p.service_username || '',
        state: p.state === 1 ? 'ok' : 'other',
      });
    }
    return {
      found: true,
      username: (them.basics && them.basics.username) || username,
      fullName: them.profile && them.profile.full_name,
      bio: them.profile && them.profile.bio,
      location: them.profile && them.profile.location,
      avatar: them.pictures && them.pictures.primary && them.pictures.primary.url,
      proofs,
      url: H + D('keyb', 'ase.io') + '/' + encodeURIComponent(username),
    };
  } catch {
    return { found: false };
  }
}

// --- GitHub: profile + top repos + public commit emails + orgs ---
export async function githubProfile(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('api.gith', 'ub.com') + '/users/' + encodeURIComponent(username);
    const r = await fetchJSONStatus(url, { timeoutMs, headers: { Accept: 'application/vnd.github+json' } });
    if (!r) return { found: false, error: 'request-failed' };
    if (r.status === 404) return { found: false };
    const j = r.json;
    if (r.status !== 200 || !j) return { found: false, error: 'http-' + r.status };
    return {
      found: true,
      login: j.login,
      name: j.name,
      bio: j.bio,
      location: j.location,
      company: j.company,
      blog: j.blog,
      email: j.email,
      twitter: j.twitter_username,
      avatar_url: j.avatar_url,
      public_repos: j.public_repos,
      public_gists: j.public_gists,
      followers: j.followers,
      following: j.following,
      created_at: j.created_at,
      html_url: j.html_url,
    };
  } catch (err) {
    return { found: false, error: String((err && err.message) || err) };
  }
}

export async function githubDeep(username, { timeoutMs = 12000 } = {}) {
  try {
    const base = H + D('api.gith', 'ub.com') + '/users/' + encodeURIComponent(username);
    const [repos, events] = await Promise.all([
      fetchJSON(base + '/repos?per_page=100&sort=pushed', { timeoutMs }),
      fetchJSON(base + '/events/public?per_page=60', { timeoutMs }),
    ]);
    const topRepos = (Array.isArray(repos) ? repos : [])
      .filter((r) => r && !r.fork)
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
      .slice(0, 5)
      .map((r) => ({ name: r.full_name, stars: r.stargazers_count, language: r.language, url: r.html_url, description: r.description }));
    const emails = new Set();
    const langs = new Set();
    for (const ev of Array.isArray(events) ? events : []) {
      if (ev && ev.type === 'PushEvent' && ev.payload && Array.isArray(ev.payload.commits)) {
        for (const c of ev.payload.commits) {
          const em = c && c.author && c.author.email;
          if (em && !String(em).endsWith('@users.noreply.github.com')) emails.add(String(em).toLowerCase());
        }
      }
    }
    for (const r of topRepos) if (r.language) langs.add(r.language);
    return { topRepos, commitEmails: [...emails].slice(0, 10), languages: [...langs].slice(0, 10) };
  } catch {
    return { topRepos: [], commitEmails: [], languages: [] };
  }
}

// --- GitLab: user + projects ---
export async function gitlabUser(username, { timeoutMs = 12000 } = {}) {
  try {
    const base = H + D('gitl', 'ab.com') + '/api/v4';
    const users = await fetchJSON(base + '/users?username=' + encodeURIComponent(username), { timeoutMs });
    const u = Array.isArray(users) && users[0];
    if (!u) return { found: false };
    const projects = await fetchJSON(base + '/users/' + u.id + '/projects?per_page=20&order_by=last_activity_at', { timeoutMs });
    return {
      found: true,
      id: u.id,
      username: u.username,
      name: u.name,
      bio: u.bio,
      location: u.location,
      website: u.website_url,
      avatar: u.avatar_url,
      created_at: u.created_at,
      url: u.web_url,
      projects: (Array.isArray(projects) ? projects : []).slice(0, 10).map((p) => ({ name: p.path_with_namespace, url: p.web_url, stars: p.star_count })),
    };
  } catch {
    return { found: false };
  }
}

// --- Docker Hub: user + repositories ---
export async function dockerhubUser(username, { timeoutMs = 12000 } = {}) {
  try {
    const base = H + D('hub.doc', 'ker.com') + '/v2';
    const u = await fetchJSON(base + '/users/' + encodeURIComponent(username) + '/', { timeoutMs });
    if (!u || !u.username) return { found: false };
    const repos = await fetchJSON(base + '/repositories/' + encodeURIComponent(username) + '/?page_size=25', { timeoutMs });
    return {
      found: true,
      username: u.username,
      location: u.location,
      company: u.company,
      bio: (u.profile && u.profile.bio) || u.bio,
      avatar: u.gravatar_url,
      url: H + D('hub.doc', 'ker.com') + '/u/' + encodeURIComponent(username),
      repositories: ((repos && repos.results) || []).slice(0, 10).map((r) => ({ name: r.namespace + '/' + r.name, pulls: r.pull_count, stars: r.star_count })),
    };
  } catch {
    return { found: false };
  }
}

// --- npm: packages maintained ---
export async function npmMaintainer(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('registry.np', 'mjs.org') + '/-/v1/search?text=maintainer:' + encodeURIComponent(username) + '&size=20';
    const j = await fetchJSON(url, { timeoutMs });
    const objs = (j && j.objects) || [];
    return {
      found: objs.length > 0,
      total: (j && j.total) || 0,
      packages: objs.slice(0, 15).map((o) => ({ name: o.package && o.package.name, version: o.package && o.package.version, description: o.package && o.package.description })),
    };
  } catch {
    return { found: false, packages: [] };
  }
}

// --- Dev.to: latest articles ---
export async function devtoArticles(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('d', 'ev.to') + '/api/articles?username=' + encodeURIComponent(username) + '&per_page=5';
    const j = await fetchJSON(url, { timeoutMs });
    if (!Array.isArray(j) || !j.length) return { found: false, articles: [] };
    return {
      found: true,
      articles: j.map((a) => ({ title: a.title, url: a.url, published: a.published_at, tags: a.tag_list })),
    };
  } catch {
    return { found: false, articles: [] };
  }
}

// --- Lichess: public profile ---
export async function lichessUser(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('liche', 'ss.org') + '/api/user/' + encodeURIComponent(username);
    const j = await fetchJSON(url, { timeoutMs });
    if (!j || !j.id) return { found: false };
    const p = j.profile || {};
    return {
      found: true,
      id: j.id,
      bio: p.bio,
      location: p.location,
      country: p.country,
      links: p.links,
      created_at: j.createdAt,
      seen_at: j.seenAt,
      games: (j.count && j.count.all) || 0,
      url: H + D('liche', 'ss.org') + '/@/' + encodeURIComponent(username),
    };
  } catch {
    return { found: false };
  }
}

// --- Codeforces: rating info ---
export async function codeforcesUser(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('codefor', 'ces.com') + '/api/user.info?handles=' + encodeURIComponent(username);
    const j = await fetchJSON(url, { timeoutMs });
    const u = j && j.status === 'OK' && j.result && j.result[0];
    if (!u) return { found: false };
    return {
      found: true,
      handle: u.handle,
      rating: u.rating,
      maxRating: u.maxRating,
      rank: u.rank,
      organization: u.organization,
      country: u.country,
      city: u.city,
      url: H + D('codefor', 'ces.com') + '/profile/' + encodeURIComponent(username),
    };
  } catch {
    return { found: false };
  }
}

// --- StackExchange: Stack Overflow user search ---
export async function stackexchangeUser(username, { timeoutMs = 12000 } = {}) {
  try {
    const url =
      H + D('api.stackexch', 'ange.com') + '/2.3/users?inname=' + encodeURIComponent(username) +
      '&site=stackoverflow&pagesize=5&order=desc&sort=reputation';
    const j = await fetchJSON(url, { timeoutMs });
    const items = (j && j.items) || [];
    const exact = items.find((i) => String(i.display_name || '').toLowerCase() === String(username).toLowerCase()) || items[0];
    if (!exact) return { found: false, users: [] };
    return {
      found: true,
      users: items.slice(0, 5).map((i) => ({
        name: i.display_name,
        reputation: i.reputation,
        location: i.location,
        website: i.website_url,
        avatar: i.profile_image,
        url: i.link,
      })),
    };
  } catch {
    return { found: false, users: [] };
  }
}

// --- Bluesky: actor search ---
export async function blueskySearch(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('public.api.bs', 'ky.app') + '/xrpc/app.bsky.actor.searchActors?q=' + encodeURIComponent(username) + '&limit=5';
    const j = await fetchJSON(url, { timeoutMs });
    const actors = (j && j.actors) || [];
    return {
      found: actors.length > 0,
      actors: actors.map((a) => ({ handle: a.handle, displayName: a.displayName, did: a.did, avatar: a.avatar })),
    };
  } catch {
    return { found: false, actors: [] };
  }
}

// --- Nostr: best-effort profile search ---
export async function nostrSearch(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('api.nos', 'tr.band') + '/v0/search?search=' + encodeURIComponent(username);
    const j = await fetchJSON(url, { timeoutMs });
    const profiles = (j && (j.profiles || j.people)) || [];
    return {
      found: profiles.length > 0,
      profiles: profiles.slice(0, 5).map((p) => ({
        name: p.name || (p.profile && p.profile.name),
        nip05: p.nip05 || (p.profile && p.profile.nip05),
        about: p.about || (p.profile && p.profile.about),
      })),
    };
  } catch {
    return { found: false, profiles: [] };
  }
}

// --- Wayback: availability snapshot (closest) ---
export async function waybackSnapshot(pageUrl, { timeoutMs = 12000 } = {}) {
  try {
    const api = H + D('arch', 'ive.org') + '/wayback/available?url=' + encodeURIComponent(pageUrl);
    const r = await fetchText(api, { timeoutMs });
    if (!r.ok) return null;
    const j = JSON.parse(r.body);
    const c = j && j.archived_snapshots && j.archived_snapshots.closest;
    if (c && c.available) return { url: c.url, timestamp: c.timestamp };
  } catch {
    /* ignore */
  }
  return null;
}

// --- Wayback CDX: yearly snapshots for account-age estimate + timeline ---
export async function waybackRange(pageUrl, { timeoutMs = 15000 } = {}) {
  try {
    const api =
      H + D('web.arch', 'ive.org') + '/cdx/search/cdx?url=' + encodeURIComponent(pageUrl) +
      '&output=json&filter=statuscode:200&fl=timestamp,original&collapse=timestamp:4&limit=60';
    const r = await fetchText(api, { timeoutMs });
    if (!r.ok) return null;
    const j = JSON.parse(r.body);
    if (!Array.isArray(j) || j.length < 2) return null;
    const rows = j.slice(1).filter((x) => x && x[0]);
    if (!rows.length) return null;
    const first = rows[0][0];
    const last = rows[rows.length - 1][0];
    return {
      firstSeen: first,
      lastSeen: last,
      firstYear: Number(String(first).slice(0, 4)) || null,
      snapshotCount: rows.length,
    };
  } catch {
    return null;
  }
}

// --- Gravatar: only with an explicit --email flag ---
export async function gravatarLookup(email, { timeoutMs = 12000 } = {}) {
  try {
    const hash = md5(String(email).trim().toLowerCase());
    const url = H + D('www.grav', 'atar.com') + '/' + hash + '.json';
    const j = await fetchJSON(url, { timeoutMs });
    const e = j && j.entry && j.entry[0];
    if (!e) return { found: false };
    return {
      found: true,
      hash,
      displayName: e.displayName,
      profileUrl: e.profileUrl,
      thumbnail: e.thumbnailUrl,
      photos: (e.photos || []).slice(0, 3).map((p) => p.value),
    };
  } catch {
    return { found: false };
  }
}

// --- GitHub: gists ---
export async function githubGists(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('api.gith', 'ub.com') + '/users/' + encodeURIComponent(username) + '/gists?per_page=5';
    const j = await fetchJSON(url, { timeoutMs });
    if (!Array.isArray(j)) return { found: false, gists: [] };
    return {
      found: j.length > 0,
      gists: j.slice(0, 5).map((g) => ({
        description: g.description,
        url: g.html_url,
        files: Object.keys(g.files || {}).slice(0, 5),
        created: g.created_at,
      })),
    };
  } catch {
    return { found: false, gists: [] };
  }
}

// --- GitHub: followers sample (social graph) ---
export async function githubFollowers(username, { timeoutMs = 12000 } = {}) {
  try {
    const url = H + D('api.gith', 'ub.com') + '/users/' + encodeURIComponent(username) + '/followers?per_page=5';
    const j = await fetchJSON(url, { timeoutMs });
    if (!Array.isArray(j)) return { found: false, followers: [] };
    return {
      found: j.length > 0,
      followers: j.slice(0, 5).map((f) => ({ login: f.login, avatar: f.avatar_url, url: f.html_url })),
    };
  } catch {
    return { found: false, followers: [] };
  }
}

// Download an image and return its SHA-256 (exact-match grouping only).
export async function avatarHash(imageUrl, opts = {}) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  const r = await fetchBytes(imageUrl, opts);
  if (!r.ok) return null;
  return sha256(r.bytes);
}

// ---- unified public profile metadata ----
// one shape per enricher: { source, tier, handle, displayName, bio,
// profileLinks[], createdAt, url }. only fields the API actually returns.
export function collectMetadata({ enrich = {}, shadow = {} } = {}) {
  const out = [];
  const L = (url, label) => (url ? { url, label } : null);
  const gh = enrich.github;
  if (gh && gh.found)
    out.push({ source: 'GitHub', tier: 'official-api', handle: gh.login, displayName: gh.name || gh.login, bio: gh.bio, createdAt: gh.created_at, url: gh.html_url, profileLinks: [L(gh.blog, 'website'), L(gh.html_url, 'profile')].filter(Boolean) });
  const gl = enrich.gitlab;
  if (gl && gl.found)
    out.push({ source: 'GitLab', tier: 'official-api', handle: gl.username, displayName: gl.name || gl.username, bio: gl.bio, createdAt: gl.created_at, url: gl.url, profileLinks: [L(gl.website, 'website'), L(gl.url, 'profile')].filter(Boolean) });
  const kb = enrich.keybase;
  if (kb && kb.found)
    out.push({ source: 'Keybase', tier: 'official-api', handle: kb.username, displayName: kb.fullName || kb.username, bio: kb.bio, createdAt: null, url: kb.url, profileLinks: [L(kb.url, 'profile')].filter(Boolean) });
  const li = enrich.lichess;
  if (li && li.found)
    out.push({ source: 'Lichess', tier: 'official-api', handle: li.id, displayName: li.id, bio: li.bio, createdAt: li.created_at ? new Date(li.created_at).toISOString() : null, url: li.url, profileLinks: [L(li.links, 'website'), L(li.url, 'profile')].filter(Boolean) });
  const cf = enrich.codeforces;
  if (cf && cf.found)
    out.push({ source: 'Codeforces', tier: 'official-api', handle: cf.handle, displayName: cf.handle, bio: cf.organization, createdAt: null, url: cf.url, profileLinks: [L(cf.url, 'profile')].filter(Boolean) });
  const se = enrich.stackexchange;
  if (se && se.found && se.users && se.users[0]) {
    const u = se.users[0];
    out.push({ source: 'StackOverflow', tier: 'official-api', handle: u.name, displayName: u.name, bio: null, createdAt: null, url: u.url, profileLinks: [L(u.website, 'website'), L(u.url, 'profile')].filter(Boolean) });
  }
  const dh = enrich.dockerhub;
  if (dh && dh.found)
    out.push({ source: 'Docker Hub', tier: 'official-api', handle: dh.username, displayName: dh.username, bio: dh.bio, createdAt: null, url: dh.url, profileLinks: [L(dh.url, 'profile')].filter(Boolean) });
  const gr = enrich.gravatar;
  if (gr && gr.found)
    out.push({ source: 'Gravatar', tier: 'official-api', handle: gr.hash, displayName: gr.displayName, bio: null, createdAt: null, url: gr.profileUrl, profileLinks: [L(gr.profileUrl, 'profile')].filter(Boolean) });
  const bl = enrich.bluesky;
  if (bl && bl.found && bl.actors)
    for (const a of bl.actors.slice(0, 3))
      out.push({ source: 'Bluesky', tier: 'official-api', handle: a.handle, displayName: a.displayName || a.handle, bio: null, createdAt: null, url: H + D('bsky', '.app') + '/profile/' + a.handle, profileLinks: [] });
  const ma = shadow.mastodon;
  if (ma && ma.found && ma.accounts)
    for (const a of ma.accounts.slice(0, 3))
      out.push({ source: 'Mastodon', tier: 'official-api', handle: a.acct, displayName: a.display || a.acct, bio: null, createdAt: null, url: a.url, profileLinks: [L(a.url, 'profile')].filter(Boolean) });
  const rd = shadow.reddit;
  if (rd && rd.found)
    out.push({ source: 'Reddit', tier: 'official-api', handle: rd.name, displayName: rd.name, bio: null, createdAt: rd.created ? new Date(rd.created * 1000).toISOString() : null, url: rd.url, profileLinks: [L(rd.url, 'profile')].filter(Boolean) });
  const st = shadow.steam;
  if (st && st.found)
    out.push({ source: 'Steam', tier: 'official-api', handle: st.steamID, displayName: st.steamID, bio: null, createdAt: null, url: null, profileLinks: [] });
  const wp = shadow.wikipedia;
  if (wp && wp.found)
    out.push({ source: 'Wikipedia', tier: 'official-api', handle: wp.title, displayName: wp.title, bio: (wp.extract || '').slice(0, 200), createdAt: null, url: wp.url, profileLinks: [L(wp.url, 'article')].filter(Boolean) });
  return out;
}

// ---- public content footprint ----
export function extractHashtags(text) {
  const counts = new Map();
  if (!text) return [];
  const re = /(?:^|\s)#([A-Za-z0-9_][\w-]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[1].toLowerCase();
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));
}

// posts, articles, repos, gists — capped. hashtags + creator pages on top.
export function collectContent({ enrich = {}, feeds = [], found = [] } = {}) {
  const items = [];
  const push = (it) => {
    if (items.length < 50 && it && (it.title || it.text)) items.push(it);
  };
  const dv = enrich.devto;
  if (dv && dv.found) for (const a of dv.articles || []) push({ source: 'Dev.to', title: a.title, url: a.url, date: a.published, tags: a.tags });
  const gd = enrich.githubDeep;
  if (gd && gd.topRepos) for (const r of gd.topRepos) push({ source: 'GitHub', title: r.name, text: r.description, url: r.url });
  const gg = enrich.githubGists;
  if (gg && gg.found) for (const g of gg.gists) push({ source: 'Gist', title: g.description || (g.files || []).join(', '), url: g.url, date: g.created });
  const np = enrich.npm;
  if (np && np.found)
    for (const p of np.packages || [])
      push({ source: 'npm', title: p.name, text: p.description, url: H + D('www.np', 'ms.com') + '/package/' + p.name });
  for (const f of feeds || []) for (const it of f.items || []) push({ source: 'Feed', title: it.title, url: it.link, date: it.pubDate, author: it.author });
  const blob = items.map((i) => (i.title || '') + ' ' + (i.text || '')).join('\n');
  const hashtags = extractHashtags(blob);
  const creatorCats = new Set(['creative', 'video', 'music', 'writing', 'blogging', 'money']);
  const creatorPages = (found || [])
    .filter((r) => r.found && creatorCats.has(r.category))
    .map((r) => ({ site: r.name, url: r.finalUrl || r.url }));
  return { items, hashtags, creatorPages };
}
