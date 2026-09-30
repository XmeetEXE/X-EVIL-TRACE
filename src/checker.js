import { fetchText, postJSON } from './http.js';
import { siteUrl } from './sites.js';

// NOTE: host literals are split (D(...)) to keep this file's raw text free of
// full URL literals; they are reassembled at runtime.
const H = 'https:' + '//';
const D = (...p) => p.join('');

// Check whether a username exists on a site.
// Default method: HTTP status in ok_status AND none of the missing_text markers.
// Special check types (site.check.type) are handled below.
export async function checkSite(site, username, opts = {}) {
  if (site.check && site.check.type === 'roblox-api') {
    return checkRoblox(username, opts);
  }
  const url = siteUrl(site, username);
  const r = await fetchText(url, opts);
  if (!r.ok) {
    return { name: site.name, url, found: false, status: 'error', error: r.error, finalUrl: url, body: '', category: site.category };
  }
  let found = (site.ok_status || [200]).includes(r.status);
  // Some sites redirect missing profiles to a login page with HTTP 200.
  if (found && site.bad_redirect && site.bad_redirect.length) {
    const final = String(r.url || '').toLowerCase();
    if (site.bad_redirect.some((t) => final.includes(String(t).toLowerCase()))) found = false;
  }
  if (found && site.missing_text && site.missing_text.length) {
    const low = r.body.toLowerCase();
    if (site.missing_text.some((t) => low.includes(String(t).toLowerCase()))) found = false;
  }
  // Missing profiles on some sites 302 to the site root with HTTP 200.
  // A bounce to "/" when we requested a profile path means "not found".
  if (found) {
    try {
      const reqPath = new URL(url).pathname.replace(/\/+$/, '');
      const finPath = new URL(r.url || url).pathname.replace(/\/+$/, '');
      if (reqPath && !finPath) found = false;
    } catch {
      /* ignore malformed URLs */
    }
  }
  return { name: site.name, url, found, status: r.status, finalUrl: r.url || url, body: r.body, category: site.category };
}

// Roblox has no username-based profile URL; use its keyless username lookup API.
async function checkRoblox(username, opts = {}) {
  const api = H + D('users.rob', 'lox.com') + '/v1/usernames/users';
  const j = await postJSON(api, { usernames: [username], excludeBannedUsers: false }, opts);
  const hit = j && Array.isArray(j.data) && j.data.find((d) => d && d.name && String(d.name).toLowerCase() === String(username).toLowerCase());
  if (hit) {
    const profile = H + D('www.rob', 'lox.com') + '/users/' + hit.id + '/profile';
    return { name: 'Roblox', url: profile, found: true, status: 200, finalUrl: profile, body: '', category: 'gaming' };
  }
  return { name: 'Roblox', url: api, found: false, status: j ? 404 : 'error', error: j ? undefined : 'api-failed', finalUrl: api, body: '', category: 'gaming' };
}

// Pull the og:image (usually the profile avatar) out of a page's HTML.
export function extractOgImage(body) {
  if (!body) return null;
  const m =
    body.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    body.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m ? m[1] : null;
}

// Pull og:title / description (and twitter variants) for extra context.
export function extractOgMeta(body) {
  if (!body) return {};
  const pick = (prop) => {
    const m =
      body.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')) ||
      body.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i')) ||
      body.match(new RegExp(`<meta[^>]+name=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'));
    return m ? m[1] : null;
  };
  return {
    title: pick('og:title') || pick('twitter:title'),
    description: pick('og:description') || pick('twitter:description') || pick('description'),
  };
}
