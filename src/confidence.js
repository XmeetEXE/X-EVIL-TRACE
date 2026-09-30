// match confidence: how much to trust a finding.
// tiers + handle match + corroboration. heuristics, not proof.

export function normalizeHandle(h) {
  return String(h || '').trim().toLowerCase().replace(/[._-]+/g, '');
}

// levenshtein, no deps
export function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function classifyMatch(foundHandle, target) {
  const f = String(foundHandle || ''), t = String(target || '');
  if (f === t) return 'exact';
  if (normalizeHandle(f) === normalizeHandle(t)) return 'normalized';
  if (levenshtein(normalizeHandle(f), normalizeHandle(t)) <= 2) return 'lookalike';
  return 'different';
}

const TIER_BASE = { 'official-api': 65, 'page-check': 50, 'search-surface': 30, 'news-intel': 30, 'code-search': 35 };
const TIER_RANK = { 'official-api': 'HIGH', 'page-check': 'MEDIUM', 'search-surface': 'LOW', 'news-intel': 'LOW', 'code-search': 'LOW' };
const MATCH_DELTA = { exact: 20, normalized: 12, lookalike: 2, different: -30 };

export function tierRank(tier) {
  return TIER_RANK[tier] || 'MEDIUM';
}

export function confLabel(score) {
  return score >= 75 ? 'HIGH' : score >= 45 ? 'MED' : 'LOW';
}

// finding: { tier, matchClass, corroboratedSources, signalPoints }
export function scoreFinding(f = {}) {
  const base = TIER_BASE[f.tier] ?? 40;
  const delta = MATCH_DELTA[f.matchClass] ?? 0;
  const corr = Math.min((f.corroboratedSources || 0) * 5, 15);
  const score = Math.max(5, Math.min(99, Math.round(base + delta + corr + (f.signalPoints || 0))));
  return {
    score,
    label: confLabel(score),
    tier: f.tier || 'unknown',
    matchClass: f.matchClass || 'unknown',
    lastChecked: new Date().toISOString(),
  };
}

// claims: [{ source, tier, displayName, handle }]
// conflicting: two HIGH-tier sources disagree on display name.
// unverified: a LOW-tier claim with no non-LOW backup for the same handle.
export function assessIdentityClaims(claims = []) {
  const cs = claims.filter((c) => c && c.source);
  const highNames = new Set();
  for (const c of cs) {
    const dn = c.displayName && String(c.displayName).trim();
    if (dn && tierRank(c.tier) === 'HIGH') highNames.add(dn.toLowerCase());
  }
  const backed = new Set();
  for (const c of cs) {
    if (tierRank(c.tier) !== 'LOW') backed.add(normalizeHandle(c.handle));
  }
  const unverified = cs
    .filter((c) => tierRank(c.tier) === 'LOW' && !backed.has(normalizeHandle(c.handle)))
    .map((c) => c.source);
  return {
    conflicting: highNames.size >= 2,
    conflictingNames: [...highNames],
    unverified,
  };
}
