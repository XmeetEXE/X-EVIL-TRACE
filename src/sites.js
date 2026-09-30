import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SITES = JSON.parse(readFileSync(join(here, '..', 'data', 'sites.json'), 'utf8'));

export function getSites() {
  return SITES;
}

export function getQuickSites() {
  const q = SITES.filter((s) => s.quick);
  return q.length ? q : SITES.slice(0, 32);
}

export function siteUrl(site, username) {
  return site.url.replace('{u}', encodeURIComponent(username));
}

export function categories() {
  return [...new Set(SITES.map((s) => s.category || 'misc'))].sort();
}

// Sites whose profiles carry the most identifying value (used for mutation
// sweeps and confidence boosts).
export const HIGH_SIGNAL = new Set([
  'GitHub',
  'X',
  'Instagram',
  'YouTube',
  'Reddit',
  'TikTok',
  'Twitch',
  'Medium',
  'Dev.to',
  'Bluesky',
  'Threads',
  'LinkedIn',
  'Keybase',
  'Steam',
  'GitLab',
  'npm',
  'TryHackMe',
  'HuggingFace',
]);
