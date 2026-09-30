// Exposure score 0-100 with a transparent, itemized breakdown and
// human-readable risk flags. All inputs are public-data observations.

// Threat ranks: GHOST 0-19, WHISPER 20-39, EXPOSED 40-59, HUNTED 60-79, DOOMED 80-100.
export function threatRank(score) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 19) return 'GHOST';
  if (s <= 39) return 'WHISPER';
  if (s <= 59) return 'EXPOSED';
  if (s <= 79) return 'HUNTED';
  return 'DOOMED';
}

export function computeExposure({ results = [], avatarGroups = [], pii = {}, linkedCount = 0, oldestSnapshotYear = null, shadow = {} }) {
  const found = results.filter((r) => r.found);
  const breakdown = [];
  const flags = [];
  const sh = shadow || {};

  // 1. Accounts found: 4 pts each, capped at 28.
  const accountPts = Math.min(found.length * 4, 28);
  breakdown.push({ label: `Accounts found (${found.length})`, points: accountPts, max: 28 });
  if (found.length >= 15) flags.push(`High account count — ${found.length} profiles use this handle`);

  // 2. Category spread: 3 pts per distinct category, capped at 12.
  const cats = new Set(found.map((r) => r.category || 'misc'));
  const catPts = Math.min(cats.size * 3, 12);
  breakdown.push({ label: `Category spread (${cats.size} categories)`, points: catPts, max: 12 });

  // 3. PII signals, capped at 25.
  let piiPts = 0;
  const p = pii || {};
  if (p.realName) {
    piiPts += 8;
    flags.push(`Real name exposed: "${truncate(p.realName, 40)}"`);
  }
  if (p.location) {
    piiPts += 6;
    flags.push(`Location exposed: "${truncate(p.location, 40)}"`);
  }
  if (p.emails && p.emails.length) {
    piiPts += 10;
    flags.push(`Public email address${p.emails.length > 1 ? 'es' : ''} found (${p.emails.length}): ${p.emails.slice(0, 2).join(', ')}${p.emails.length > 2 ? '…' : ''}`);
  }
  if (p.phones && p.phones.length) {
    piiPts += 10;
    flags.push(`Phone-number pattern in public bio (${p.phones.length})`);
  }
  if (p.realName && p.location) flags.push('Real name + location together — strong de-anonymization signal');
  piiPts = Math.min(piiPts, 25);
  breakdown.push({ label: 'PII signals (name/location/email/phone)', points: piiPts, max: 25 });

  // 4. Avatar reuse: (sites-1)*4 per group, capped at 8.
  let avatarPts = 0;
  for (const g of avatarGroups || []) {
    avatarPts += Math.min((g.sites.length - 1) * 4, 6);
    flags.push(`Same avatar reused on ${g.sites.length} sites (${g.sites.slice(0, 4).join(', ')}${g.sites.length > 4 ? '…' : ''})`);
  }
  avatarPts = Math.min(avatarPts, 8);
  breakdown.push({ label: `Avatar reuse (${(avatarGroups || []).length} groups)`, points: avatarPts, max: 8 });

  // 5. Linked identities (Keybase proofs etc.): 3 pts each, capped at 8.
  const linkedPts = Math.min((linkedCount || 0) * 3, 8);
  breakdown.push({ label: `Linked identities (${linkedCount || 0})`, points: linkedPts, max: 8 });
  if ((linkedCount || 0) >= 2) flags.push(`${linkedCount} cryptographically-linked identities (Keybase proofs)`);

  // 6. Account-age bonus: archived presence older than 5 years.
  let agePts = 0;
  if (oldestSnapshotYear && oldestSnapshotYear <= new Date().getFullYear() - 5) {
    agePts = 3;
    flags.push(`Long-lived footprint — archived profiles date back to ${oldestSnapshotYear}`);
  }
  breakdown.push({ label: 'Account age (archived history)', points: agePts, max: 3 });

  // 7. Shadow: certificate-transparency domains — 2 pts each, capped at 6.
  const domains = sh.domains || [];
  const domainPts = Math.min(domains.length * 2, 6);
  breakdown.push({ label: `Shadow: cert-transparency domains (${domains.length})`, points: domainPts, max: 6 });
  if (domains.length >= 2) flags.push(`Certificate transparency: ${domains.length} domains contain this handle (${domains.slice(0, 3).join(', ')}${domains.length > 3 ? '…' : ''})`);

  // 8. Shadow: news mentions — 2 pts each, capped at 4.
  const newsCount = sh.newsCount || 0;
  const newsPts = Math.min(newsCount * 2, 4);
  breakdown.push({ label: `Shadow: news mentions (${newsCount})`, points: newsPts, max: 4 });
  if (newsCount >= 2) flags.push(`${newsCount} news/blog mentions reference this handle (GDELT)`);

  // 9. Shadow: code-search hits — 1 pt per 5 hits, capped at 4.
  const codeHits = sh.codeHits || 0;
  const codePts = Math.min(Math.floor(codeHits / 5), 4);
  breakdown.push({ label: `Shadow: code-search hits (${codeHits})`, points: codePts, max: 4 });
  if (codeHits >= 20) flags.push(`Handle appears in ${codeHits} public code-search results (grep.app)`);

  // 10. Shadow: geo-located infrastructure — 2 pts each, capped at 4.
  const geoCount = sh.geoCount || 0;
  const geoPts = Math.min(geoCount * 2, 4);
  breakdown.push({ label: `Shadow: geo-located infrastructure (${geoCount})`, points: geoPts, max: 4 });
  if (geoCount > 0 && sh.geoCountries && sh.geoCountries.length) {
    flags.push(`Infrastructure geo-located: ${sh.geoCountries.slice(0, 3).join(', ')}${sh.geoCountries.length > 3 ? '…' : ''}`);
  }

  // 11. Corroborated identities (2+ independent methods agree) — 4 pts each, capped at 8.
  const corroborated = sh.corroborated || [];
  const corrPts = Math.min(corroborated.length * 4, 8);
  breakdown.push({ label: `Corroborated identities (${corroborated.length})`, points: corrPts, max: 8 });
  for (const ci of corroborated.slice(0, 3)) {
    flags.push(`Corroborated identity: "${truncate(ci.identity, 36)}" confirmed by ${ci.sources} independent methods (${ci.via.slice(0, 3).join(', ')})`);
  }

  // 12. Declared identity: verified rel=me edges + corroborated declared links.
  const dec = sh.declared || {};
  const relMePts = Math.min((dec.verifiedRelMe || 0) * 2, 6);
  const declCorrPts = Math.min((dec.corroboratedDeclared || 0) * 2, 4);
  breakdown.push({ label: `Declared identity: verified rel=me (${dec.verifiedRelMe || 0}), corroborated declared (${dec.corroboratedDeclared || 0})`, points: relMePts + declCorrPts, max: 10 });
  if (dec.verifiedRelMe)
    flags.push(`${dec.verifiedRelMe} verified rel=me link${dec.verifiedRelMe > 1 ? 's' : ''} — target site links back, identity confirmed both ways`);
  if (dec.corroboratedDeclared)
    flags.push(`${dec.corroboratedDeclared} declared link${dec.corroboratedDeclared > 1 ? 's' : ''} corroborated by independent methods`);

  const raw = breakdown.reduce((a, b) => a + b.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, rank: threatRank(score), breakdown, flags };
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// --- PII extraction from public text (bios, commit messages, profiles) ---

export function extractEmails(text) {
  const out = new Set();
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let m;
  while ((m = re.exec(text))) {
    const e = m[0].toLowerCase();
    // Skip GitHub's anonymized noreply addresses — not real PII.
    if (e.endsWith('@users.noreply.github.com')) continue;
    out.add(e);
  }
  return [...out].slice(0, 10);
}

export function extractPhones(text) {
  const out = new Set();
  if (!text) return [];
  // Conservative: optional +, then 10-15 digits allowing common separators.
  const re = /\+?\d[\d\s().-]{8,18}\d/g;
  let m;
  while ((m = re.exec(text))) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15 && !/^(\d)\1+$/.test(digits)) {
      out.add(m[0].trim());
    }
  }
  return [...out].slice(0, 5);
}

export function looksLikeRealName(name) {
  if (!name) return false;
  const s = String(name).trim();
  // Two or more capitalized words, no handle-like characters.
  return /^[A-Z][a-zA-Z.'-]{1,30}( [A-Z][a-zA-Z.'-]{1,30}){1,3}$/.test(s);
}
