// EVIL TRACE v4.0 orchestrator — 5 phases:
//   PHASE 01 // SURFACE SWEEP    — site existence checks
//   PHASE 02 // DEEP TRACE       — keyless enrichers
//   PHASE 03 // SHADOW METHODS   — multi-method intelligence
//   PHASE 04 // EXPOSURE AUTOPSY — scoring, flags, DANGER PANEL
//   PHASE 05 // DECLARED IDENTITY — rel=me, feeds, schema, link health
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getSites, getQuickSites, HIGH_SIGNAL, siteUrl } from './sites.js';
import { checkSite, extractOgImage, extractOgMeta } from './checker.js';
import { pool } from './http.js';
import { usernameMutations } from './mutations.js';
import {
  githubProfile, githubDeep, githubGists, githubFollowers, keybaseLookup,
  gitlabUser, dockerhubUser, npmMaintainer, devtoArticles, lichessUser,
  codeforcesUser, stackexchangeUser, blueskySearch, nostrSearch,
  waybackSnapshot, waybackRange, gravatarLookup, avatarHash,
  collectMetadata, collectContent,
} from './deep.js';
import { runShadow, corroborateIdentities } from './shadow.js';
import {
  analyzeDeclared, buildIdentityGraph, graphToAscii, authorAttribution,
  extractRelMe, verifyRelMe, schemaProfiles, extractFeedLinks, fetchFeed,
} from './declared.js';
import { analyzeLinks } from './links.js';
import { scoreFinding, classifyMatch, confLabel, assessIdentityClaims } from './confidence.js';
import { saveScan, lastFoundSites, saveSnapshot, diffSnapshots } from './db.js';
import { writeReports } from './report.js';
import { computeExposure, extractEmails, extractPhones, looksLikeRealName, threatRank } from './score.js';
import { Progress, Spinner, makeColors, section, table } from './ui.js';
import { phaseBanner, scanline, traceLine, printDangerPanel } from './fx.js';

export async function runScan(username, opts = {}) {
  const c = opts.colors || makeColors(true);
  const startedAt = new Date().toISOString();
  const concurrency = opts.concurrency || 8;
  const timeoutMs = opts.timeoutMs || 12000;
  const verbose = !!opts.verbose;

  // ── PHASE 01 // SURFACE SWEEP ──────────────────────────────────────────
  phaseBanner(c, '01', `SURFACE SWEEP — "${username}"`);
  const sites = opts.quick ? getQuickSites() : getSites();
  console.log(`  ${c.dim}Sweeping ${sites.length} sites for handle "${username}"…${c.reset}`);
  const progress = new Progress(sites.length, c);
  const results = await pool(sites, concurrency, async (site) => {
    const r = await checkSite(site, username, { timeoutMs });
    progress.tick(r.found);
    return r;
  });
  progress.finish();

  // Confidence scoring (confidence.js): tier + handle match + signals.
  for (const r of results) {
    if (!r.found) {
      r.confidence = 0;
      r.confLabel = 'LOW';
      continue;
    }
    let signalPoints = 0;
    if (HIGH_SIGNAL.has(r.name)) signalPoints += 8;
    const meta = extractOgMeta(r.body || '');
    const hay = `${meta.title || ''} ${meta.description || ''}`.toLowerCase();
    if (hay.includes(username.toLowerCase())) signalPoints += 4;
    const cf = scoreFinding({ tier: 'page-check', matchClass: 'exact', signalPoints });
    r.confidence = cf.score;
    r.confLabel = cf.label;
    r.confTier = 'page-check';
    r.lastChecked = cf.lastChecked;
    r.ogTitle = meta.title;
    r.ogDescription = meta.description;
  }
  const found = results.filter((r) => r.found).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  // Trace lines for every finding.
  scanline(c);
  for (const r of found) console.log(traceLine(r, c, { verbose }));
  if (verbose) {
    for (const r of results.filter((r) => !r.found)) {
      const line = traceLine(r, c, { verbose });
      if (line) console.log(line);
    }
  } else {
    const errors = results.filter((r) => r.status === 'error');
    if (errors.length) console.log(`  ${c.yellow}[!] ${errors.length} sites unreachable (timeout/blocked) — --verbose to list.${c.reset}`);
  }
  console.log(`  ${c.dim}${found.length}/${results.length} traces acquired.${c.reset}`);

  // ── PHASE 02 // DEEP TRACE ─────────────────────────────────────────────
  phaseBanner(c, '02', 'DEEP TRACE');
  const spin = new Spinner(c);
  spin.start('Identity basics (GitHub, Keybase)');
  const [github, keybase] = await Promise.all([
    githubProfile(username, { timeoutMs }),
    keybaseLookup(username, { timeoutMs }),
  ]);
  spin.stop();

  let deep = {};
  if (opts.deep) {
    const jobs = {
      githubDeep: () => githubDeep(username, { timeoutMs }),
      githubGists: () => githubGists(username, { timeoutMs }),
      githubFollowers: () => githubFollowers(username, { timeoutMs }),
      gitlab: () => gitlabUser(username, { timeoutMs }),
      dockerhub: () => dockerhubUser(username, { timeoutMs }),
      npm: () => npmMaintainer(username, { timeoutMs }),
      devto: () => devtoArticles(username, { timeoutMs }),
      lichess: () => lichessUser(username, { timeoutMs }),
      codeforces: () => codeforcesUser(username, { timeoutMs }),
      stackexchange: () => stackexchangeUser(username, { timeoutMs }),
      bluesky: () => blueskySearch(username, { timeoutMs }),
      nostr: () => nostrSearch(username, { timeoutMs }),
    };
    if (opts.email) jobs.gravatar = () => gravatarLookup(opts.email, { timeoutMs });
    const keys = Object.keys(jobs);
    spin.start(`Deep trace (${keys.length} keyless enrichers)`);
    const vals = await pool(keys, 4, (k) => jobs[k]().catch(() => null));
    keys.forEach((k, i) => { deep[k] = vals[i] || null; });
    spin.stop();
  }
  const enrich = { github, keybase, ...deep };

  // Avatar cross-matching: og:image from found pages + enriched avatars.
  spin.start('Cross-matching avatars');
  const avatarUrls = [];
  for (const r of found) {
    const img = extractOgImage(r.body || '');
    r.avatarUrl = img;
    if (img) avatarUrls.push({ site: r.name, url: img });
  }
  const extraAvatars = [];
  if (github.found && github.avatar_url) extraAvatars.push({ site: 'GitHub', url: github.avatar_url });
  if (keybase.found && keybase.avatar) extraAvatars.push({ site: 'Keybase', url: keybase.avatar });
  if (deep.gitlab && deep.gitlab.found && deep.gitlab.avatar) extraAvatars.push({ site: 'GitLab', url: deep.gitlab.avatar });
  if (deep.stackexchange && deep.stackexchange.found) {
    for (const u of deep.stackexchange.users.slice(0, 2)) if (u.avatar) extraAvatars.push({ site: 'StackOverflow', url: u.avatar });
  }
  if (deep.bluesky && deep.bluesky.found) {
    for (const a of deep.bluesky.actors.slice(0, 2)) if (a.avatar) extraAvatars.push({ site: 'Bluesky', url: a.avatar });
  }
  if (deep.gravatar && deep.gravatar.found && deep.gravatar.thumbnail) extraAvatars.push({ site: 'Gravatar', url: deep.gravatar.thumbnail });
  const allAvatars = [...avatarUrls, ...extraAvatars];
  const hashes = await pool(allAvatars, concurrency, async ({ site, url }) => ({ site, hash: await avatarHash(url, { timeoutMs }) }));
  const groups = new Map();
  for (const { site, hash } of hashes) {
    if (!hash) continue;
    if (!groups.has(hash)) groups.set(hash, []);
    if (!groups.get(hash).includes(site)) groups.get(hash).push(site);
  }
  const avatarGroups = [...groups.entries()]
    .filter(([, s]) => s.length >= 2)
    .map(([hash, sites]) => ({ hash, sites }));
  const groupedSites = new Set(avatarGroups.flatMap((g) => g.sites));
  for (const r of found) {
    if (groupedSites.has(r.name)) {
      r.confidence = Math.min((r.confidence || 0) + 10, 99);
      r.confLabel = confLabel(r.confidence);
    }
  }
  spin.stop(avatarGroups.length > 0);

  // Wayback snapshots (unless --no-wayback).
  let wayback = [];
  if (!opts.noWayback) {
    spin.start('Wayback Machine lookups');
    const targets = found.slice(0, 12);
    wayback = (
      await pool(targets, 4, async (r) => {
        const pageUrl = r.finalUrl || r.url;
        const [snapshot, range] = await Promise.all([
          waybackSnapshot(pageUrl, { timeoutMs }),
          waybackRange(pageUrl, { timeoutMs: Math.min(timeoutMs + 3000, 20000) }),
        ]);
        return snapshot || range ? { site: r.name, snapshot, range } : null;
      })
    ).filter(Boolean);
    spin.stop(wayback.length > 0);
  }

  // ── PHASE 03 // SHADOW METHODS ─────────────────────────────────────────
  let shadow = {};
  if (opts.shadow) {
    phaseBanner(c, '03', 'SHADOW METHODS');
    console.log(`  ${c.dim}Ten independent intel methods. No single source of truth.${c.reset}`);
    scanline(c);
    shadow = await runShadow(username, {
      timeoutMs: Math.min(timeoutMs + 3000, 20000),
      concurrency: 4,
      onMethod: (via) => console.log(`  ${c.red}>>>${c.reset} ${c.bold}${via}${c.reset}`),
    });
    scanline(c);
    const hits = Object.entries(shadow).filter(([, v]) => v && (v.found || (v.domains && v.domains.length) || (v.records && v.records.length)));
    console.log(`  ${c.dim}${hits.length}/10 shadow methods returned intel.${c.reset}`);
  }

  // Username mutations on high-signal sites (opt-in).
  let mutationHits = [];
  if (opts.mutations) {
    const variants = usernameMutations(username);
    phaseBanner(c, '03' + (opts.shadow ? 'b' : ''), `MUTATION SWEEP — ${variants.length} variations`);
    const jobs = [];
    for (const v of variants) {
      for (const site of getSites().filter((s) => HIGH_SIGNAL.has(s.name))) jobs.push({ site, variant: v });
    }
    const mprog = new Progress(jobs.length, c);
    const mres = await pool(jobs, concurrency, async ({ site, variant }) => {
      const r = await checkSite(site, variant, { timeoutMs });
      mprog.tick(r.found);
      return r;
    });
    mprog.finish();
    mres.forEach((r, i) => {
      if (r.found) {
        const mc = classifyMatch(jobs[i].variant, username);
        const cf = scoreFinding({ tier: 'page-check', matchClass: mc, signalPoints: HIGH_SIGNAL.has(r.name) ? 8 : 0 });
        mutationHits.push({ variant: jobs[i].variant, site: r.name, url: r.finalUrl || r.url, matchClass: mc, confidence: cf.score, confLabel: cf.label });
      }
    });
    for (const m of mutationHits.slice(0, 15)) {
      console.log(`  ${c.dim}${m.variant}${c.reset} → ${c.green}${m.site}${c.reset}`);
    }
    if (mutationHits.length > 15) console.log(`  ${c.dim}…and ${mutationHits.length - 15} more (see report)${c.reset}`);
  }

  // ── PHASE 05 // DECLARED IDENTITY ─────────────────────────────────────
  let identity = null;
  if (opts.identity) {
    phaseBanner(c, '05', 'DECLARED IDENTITY');
    console.log(`  ${c.dim}Declared links only. Nothing inferred.${c.reset}`);
    const autoSeeds = autoSeedsFromEnrich(enrich);
    const seeds = [...(opts.sites || []), ...autoSeeds]
      .filter((u) => u && /^https?:\/\//i.test(u))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, 6);
    spin.start(`Analyzing ${seeds.length} seed site(s)`);
    const analyzed = await analyzeDeclared({ seeds, timeoutMs, concurrency: 3, onStep: () => {} });
    spin.stop();

    // Reuse phase-01 page bodies: rel=me + schema from HTML we already fetched.
    const profilePages = await declaredFromProfiles(found, { timeoutMs });

    const allRelMe = [...analyzed.flatMap((a) => a.relMe || []), ...profilePages.relMe];
    const allSchemas = [...analyzed.flatMap((a) => a.schemas || []), ...profilePages.schemas];
    const allFeeds = [...analyzed.flatMap((a) => a.feeds || []), ...profilePages.feeds];
    const metadata = collectMetadata({ enrich, shadow });

    const graphSeeds = [
      ...analyzed.map((a) => ({ url: a.url, relMe: a.relMe, schemas: a.schemas, feeds: a.feeds, profileLinks: [] })),
      ...profilePages.pages.map((p) => ({ url: p.url, relMe: p.relMe, schemas: p.schemas, feeds: p.feeds, profileLinks: [] })),
    ];
    for (const m of metadata) {
      const g = graphSeeds.find((s) => s.url === m.url);
      if (g) g.profileLinks = m.profileLinks || [];
      else if (m.url && graphSeeds.length < 14) graphSeeds.push({ url: m.url, relMe: [], schemas: [], feeds: [], profileLinks: m.profileLinks || [] });
    }
    const graph = buildIdentityGraph({ seeds: graphSeeds });

    // Author attribution: declared names vs known display names.
    const declaredAuthors = [];
    for (const f of allFeeds) {
      if (f.author) declaredAuthors.push({ author: f.author, source: 'feed: ' + (f.title || f.url || '').slice(0, 60) });
      for (const it of f.items || []) {
        if (it.author) declaredAuthors.push({ author: it.author, source: 'post: ' + (it.title || '').slice(0, 60) });
      }
    }
    const knownNames = [username, ...metadata.map((m) => m.displayName), ...metadata.map((m) => m.handle)];
    const authors = authorAttribution(declaredAuthors, knownNames);

    // Link health: every outbound declared link.
    const outbound = [];
    for (const m of metadata) for (const pl of m.profileLinks || []) outbound.push(pl.url);
    for (const r of allRelMe) outbound.push(r.url);
    for (const p of allSchemas) {
      for (const sa of p.sameAs || []) outbound.push(sa);
      if (p.url) outbound.push(p.url);
    }
    for (const f of allFeeds) if (f.link) outbound.push(f.link);
    spin.start('Checking outbound link health');
    const linkHealth = await analyzeLinks(outbound, { timeoutMs: Math.min(timeoutMs, 10000), concurrency: 4 });
    spin.stop();

    // Profile history: diff vs the previous scan's snapshot.
    const snapCurrent = metadata.map((m) => ({
      key: m.source + ':' + (m.handle || m.url || 'profile'),
      displayName: m.displayName,
      bio: m.bio,
      links: (m.profileLinks || []).map((pl) => pl.url),
    }));
    const profileDiff = diffSnapshots(username, snapCurrent);
    for (const s of snapCurrent) saveSnapshot(username, s.key, s);

    // Confidence over identity claims.
    const now = new Date().toISOString();
    const claims = metadata.map((m) => ({ source: m.source, tier: m.tier, displayName: m.displayName, handle: m.handle, lastChecked: now }));
    for (const r of found) {
      claims.push({ source: r.name, tier: 'page-check', displayName: r.ogTitle || null, handle: username, lastChecked: r.lastChecked || now });
    }
    const assessment = assessIdentityClaims(claims);

    // Declared identities corroborated by independent methods.
    const declaredCorr = corroborateIdentities([
      ...allRelMe.map((r) => ({ identity: r.url, via: 'rel=me' })),
      ...allSchemas.flatMap((p) => (p.sameAs || []).map((sa) => ({ identity: sa, via: 'schema:sameAs' }))),
    ]).filter((x) => x.corroborated);

    const content = collectContent({ enrich, feeds: allFeeds, found });
    identity = {
      seedUrls: seeds,
      relMe: allRelMe,
      schemas: allSchemas,
      feeds: allFeeds,
      graph,
      graphAscii: graphToAscii(graph),
      authors,
      linkHealth,
      profileDiff,
      metadata,
      claims,
      assessment,
      content,
      corroboratedDeclared: declaredCorr,
    };
    console.log(`  ${c.dim}done: ${allRelMe.length} rel=me (${allRelMe.filter((r) => r.verified).length} verified), ${allSchemas.length} schema profiles, ${allFeeds.length} feeds, ${linkHealth.length} links checked${c.reset}`);
  }

  const finishedAt = new Date().toISOString();

  // Cross-method corroboration.
  const corroborated = corroborateIdentities(buildIdentitySources({ username, enrich, shadow })).filter((x) => x.corroborated);

  // PII aggregation + exposure score.
  const pii = aggregatePII({ username, found, enrich, shadow });
  const linkedCount = keybase.found && keybase.proofs ? keybase.proofs.filter((p) => p.state === 'ok').length : 0;
  const years = wayback.map((w) => w.range && w.range.firstYear).filter(Boolean);
  const oldestSnapshotYear = years.length ? Math.min(...years) : null;
  const geoRecords = (shadow.dnsgeo && shadow.dnsgeo.records ? shadow.dnsgeo.records : []).filter((r) => r.ip);
  const score = computeExposure({
    results,
    avatarGroups,
    pii,
    linkedCount,
    oldestSnapshotYear,
    shadow: {
      domains: (shadow.crtsh && shadow.crtsh.domains) || [],
      newsCount: (shadow.gdelt && shadow.gdelt.count) || 0,
      codeHits: (shadow.grepapp && shadow.grepapp.total) || 0,
      geoCount: geoRecords.length,
      geoCountries: [...new Set(geoRecords.map((r) => r.country).filter(Boolean))],
      corroborated,
      declared: identity
        ? {
            verifiedRelMe: identity.relMe.filter((r) => r.verified).length,
            corroboratedDeclared: identity.corroboratedDeclared.length,
          }
        : {},
    },
  });

  // Diff vs previous scan (before saving this one).
  const prev = lastFoundSites(username);
  const nowNames = found.map((r) => r.name);
  const prevSet = new Set(prev.sites);
  const diff = {
    isFirst: prev.isFirst,
    newSites: nowNames.filter((n) => !prevSet.has(n)),
    goneSites: prev.sites.filter((n) => !nowNames.includes(n)),
  };

  // Persist + reports.
  const outDir = resolve(opts.outDir || join(process.cwd(), 'reports'));
  mkdirSync(outDir, { recursive: true });
  const scanId = saveScan(username, startedAt, finishedAt, results, score.score, opts.deep);
  const formats = (opts.format || 'html,json,md').split(',').map((f) => f.trim().toLowerCase()).filter(Boolean);
  const reportFiles = writeReports({
    username, startedAt, finishedAt, results, avatarGroups, enrich, shadow, corroborated,
    score, wayback, mutations: mutationHits, diff, identity, outDir, formats,
  });
  const jsonRaw = join(outDir, `${username}-latest.json`);
  writeFileSync(jsonRaw, JSON.stringify({ username, startedAt, finishedAt, scanId, exposure: score, results: results.map(strip), avatarGroups, enrich, shadow, corroborated, wayback, mutationHits, diff, identity }, null, 2));

  return { results, found, avatarGroups, enrich, shadow, corroborated, score, wayback, mutationHits, diff, identity, reportFiles, jsonRaw, scanId, startedAt, finishedAt };
}

function strip(r) {
  const { body, ...rest } = r;
  return rest;
}

// Personal websites declared in enriched profiles — good identity seeds.
function autoSeedsFromEnrich(enrich) {
  const out = [];
  const blog = enrich.github && enrich.github.found && enrich.github.blog;
  if (blog && /^https?:\/\//i.test(blog)) out.push(blog);
  const ws = enrich.gitlab && enrich.gitlab.found && enrich.gitlab.website;
  if (ws && /^https?:\/\//i.test(ws)) out.push(ws);
  const se = enrich.stackexchange;
  if (se && se.found && se.users && se.users[0] && /^https?:\/\//i.test(se.users[0].website || '')) out.push(se.users[0].website);
  return out;
}

// rel=me + schema from phase-01 page bodies we already have. Verifies the
// rel=me targets (cap 12) and fetches up to 3 discovered feeds.
async function declaredFromProfiles(found, { timeoutMs }) {
  const pages = [];
  for (const r of found) {
    if (!r.body || pages.length >= 20) continue;
    const base = r.finalUrl || r.url;
    pages.push({
      site: r.name,
      url: base,
      relMe: extractRelMe(r.body, base),
      schemas: schemaProfiles(r.body),
      feedUrls: extractFeedLinks(r.body, base),
      feeds: [],
    });
  }
  const relMe = await pool(
    pages.flatMap((p) => p.relMe.map((l) => ({ ...l, sourceSite: p.site }))).slice(0, 12),
    3,
    (l) => verifyRelMe(l, { timeoutMs: Math.min(timeoutMs, 10000) })
  );
  const feedUrls = [...new Set(pages.flatMap((p) => p.feedUrls))].slice(0, 3);
  const feeds = (await pool(feedUrls, 2, (u) => fetchFeed(u, { timeoutMs }))).filter(Boolean);
  const schemas = pages.flatMap((p) => p.schemas);
  return { pages: pages.map(({ feedUrls, ...p }) => p), relMe, feeds, schemas };
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return String(u || '').slice(0, 40);
  }
}

// Gather every identity string observed, tagged with its `via` method,
// for cross-method corroboration.
function buildIdentitySources({ username, enrich, shadow }) {
  const sources = [];
  const push = (identity, via) => { if (identity && String(identity).trim()) sources.push({ identity: String(identity).trim(), via }); };
  const gh = enrich.github || {};
  if (gh.found && gh.login && gh.login.toLowerCase() !== username.toLowerCase()) push(gh.login, 'github');
  const kb = enrich.keybase || {};
  if (kb.found && kb.proofs) for (const pr of kb.proofs) push(pr.username, 'keybase:' + (pr.service || 'proof'));
  const gl = enrich.gitlab || {};
  if (gl.found) push(gl.username, 'gitlab');
  const dh = enrich.dockerhub || {};
  if (dh.found) push(dh.username, 'dockerhub');
  const sh = shadow || {};
  for (const d of ((sh.crtsh && sh.crtsh.domains) || [])) push(d, 'cert-transparency');
  for (const r of ((sh.grepapp && sh.grepapp.results) || [])) {
    if (r.repo && String(r.repo).includes('/')) push(String(r.repo).split('/')[0], 'code-search');
  }
  for (const a of ((sh.mastodon && sh.mastodon.accounts) || [])) push(a.acct, 'fediverse');
  if (sh.reddit && sh.reddit.found) push(sh.reddit.name, 'reddit-api');
  if (sh.steam && sh.steam.found) push(sh.steam.steamID, 'steam-xml');
  if (sh.wikipedia && sh.wikipedia.found) push(sh.wikipedia.title, 'wikipedia');
  return sources;
}

function aggregatePII({ username, found, enrich, shadow }) {
  const texts = [];
  const push = (v) => { if (v && String(v).trim()) texts.push(String(v)); };
  const gh = enrich.github || {};
  const kb = enrich.keybase || {};
  const gl = enrich.gitlab || {};
  const dh = enrich.dockerhub || {};
  const li = enrich.lichess || {};
  const cf = enrich.codeforces || {};
  const se = enrich.stackexchange || {};
  const gd = enrich.githubDeep || {};
  const gg = enrich.githubGists || {};

  let realName = null;
  if (gh.found && looksLikeRealName(gh.name)) realName = gh.name;
  else if (kb.found && looksLikeRealName(kb.fullName)) realName = kb.fullName;
  else if (gl.found && looksLikeRealName(gl.name)) realName = gl.name;

  const location = gh.location || kb.location || gl.location || li.location || cf.city || se.users?.[0]?.location || dh.location || null;

  push(gh.bio); push(gh.blog); push(kb.bio); push(gl.bio);
  push(li.bio); push(dh.bio); push(cf.organization);
  for (const r of found) { push(r.ogTitle); push(r.ogDescription); }
  if (se.users) for (const u of se.users) { push(u.website); push(u.location); }
  if (gd.topRepos) for (const r of gd.topRepos) push(r.description);
  if (gg.gists) for (const g of gg.gists) push(g.description);

  // Shadow-method text surfaces (news titles, search titles, fediverse bios).
  const sh = shadow || {};
  if (sh.gdelt && sh.gdelt.articles) for (const a of sh.gdelt.articles) push(a.title);
  if (sh.ddg && sh.ddg.results) for (const r of sh.ddg.results) push(r.title);
  if (sh.mastodon && sh.mastodon.accounts) for (const a of sh.mastodon.accounts) { push(a.display); push(a.acct); }
  if (sh.wikipedia && sh.wikipedia.found) push(sh.wikipedia.extract);

  const blob = texts.join('\n');
  const emails = [...new Set([...extractEmails(blob), ...(gd.commitEmails || []), ...(gh.email ? [gh.email.toLowerCase()] : [])])].slice(0, 10);
  const phones = extractPhones(blob);
  return { realName, location, emails, phones };
}

// ── PHASE 04 // EXPOSURE AUTOPSY ─────────────────────────────────────────
// Prints the autopsy: breakdown, flags, intel sections, then the DANGER PANEL.
export async function printSummary(data, username, opts = {}) {
  const c = opts.colors || makeColors(true);
  const { found, avatarGroups, score, corroborated, shadow, mutationHits, diff, reportFiles } = data;

  phaseBanner(c, '04', 'EXPOSURE AUTOPSY');

  console.log(`\n  ${c.dim}Exposure breakdown${c.reset}`);
  for (const b of score.breakdown) {
    console.log(`  ${c.dim}${b.label.padEnd(44)}${c.reset} ${c.bold}+${b.points}${c.reset}`);
  }
  console.log('');
  if (score.flags.length) {
    for (const f of score.flags) console.log(`  ${c.red}!${c.reset} ${f}`);
  } else {
    console.log(`  ${c.dim}No risk flags.${c.reset}`);
  }

  if (corroborated && corroborated.length) {
    console.log(`\n  ${c.bold}Corroborated identities${c.reset} ${c.dim}(2+ independent methods agree)${c.reset}`);
    for (const ci of corroborated.slice(0, 8)) {
      console.log(`  ${c.green}◈${c.reset} "${ci.identity}" ${c.dim}← ${ci.via.join(', ')}${c.reset}`);
    }
  }

  if (avatarGroups.length) {
    console.log(`\n  ${c.bold}Avatar matches${c.reset} ${c.dim}(same picture, multiple sites)${c.reset}`);
    for (const g of avatarGroups) console.log(`  ${c.magenta}◈${c.reset} ${g.sites.join(`  ${c.dim}·${c.reset}  `)}`);
  }

  const kb = data.enrich && data.enrich.keybase;
  if (kb && kb.found && kb.proofs && kb.proofs.length) {
    console.log(`\n  ${c.bold}Linked identities${c.reset} ${c.dim}(Keybase proofs)${c.reset}`);
    for (const pr of kb.proofs) {
      const mark = pr.state === 'ok' ? c.green + 'verified' + c.reset : c.yellow + pr.state + c.reset;
      console.log(`  ${c.cyan}${pr.service}${c.reset}: ${pr.username}  [${mark}]`);
    }
  }

  if (shadow && Object.keys(shadow).length) {
    console.log(`\n  ${c.bold}Shadow intel${c.reset}`);
    const rows = [];
    if (shadow.crtsh && shadow.crtsh.domains && shadow.crtsh.domains.length) {
      rows.push([c.red + 'cert-transparency' + c.reset, `${shadow.crtsh.domains.length} domains`, shadow.crtsh.domains.slice(0, 3).join(', ') + (shadow.crtsh.domains.length > 3 ? '…' : '')]);
    }
    if (shadow.dnsgeo && shadow.dnsgeo.records && shadow.dnsgeo.records.length) {
      const geo = shadow.dnsgeo.records.filter((r) => r.ip);
      if (geo.length) rows.push([c.red + 'dns+geo' + c.reset, `${geo.length} resolved`, geo.slice(0, 3).map((r) => `${r.domain} → ${r.country || r.ip}`).join('; ') + (geo.length > 3 ? '…' : '')]);
    }
    if (shadow.urlscan && shadow.urlscan.found) rows.push([c.red + 'urlscan' + c.reset, `${shadow.urlscan.total} pages`, (shadow.urlscan.results[0] && shadow.urlscan.results[0].domain) || '']);
    if (shadow.ddg && shadow.ddg.found) rows.push([c.red + 'search-surface' + c.reset, `${shadow.ddg.mentionCount} mentions`, (shadow.ddg.results[0] && shadow.ddg.results[0].domain) || '']);
    if (shadow.gdelt && shadow.gdelt.found) rows.push([c.red + 'news-intel' + c.reset, `${shadow.gdelt.count} articles`, (shadow.gdelt.articles[0] && shadow.gdelt.articles[0].title || '').slice(0, 60)]);
    if (shadow.grepapp && shadow.grepapp.found) rows.push([c.red + 'code-search' + c.reset, `${shadow.grepapp.total} hits`, (shadow.grepapp.results[0] && shadow.grepapp.results[0].repo) || '']);
    if (shadow.mastodon && shadow.mastodon.found) rows.push([c.red + 'fediverse' + c.reset, `${shadow.mastodon.accounts.length} accounts`, shadow.mastodon.accounts.map((a) => '@' + a.acct).slice(0, 3).join(', ')]);
    if (shadow.reddit && shadow.reddit.found) rows.push([c.red + 'reddit-api' + c.reset, `${shadow.reddit.karma} karma`, 'u/' + shadow.reddit.name]);
    if (shadow.steam && shadow.steam.found) rows.push([c.red + 'steam-xml' + c.reset, shadow.steam.memberSince || 'profile', shadow.steam.location || '']);
    if (shadow.wikipedia && shadow.wikipedia.found) rows.push([c.red + 'wikipedia' + c.reset, 'article match', shadow.wikipedia.title]);
    for (const [m, n, d] of rows) console.log(`  ${m}  ${c.dim}│${c.reset} ${n}  ${c.dim}${String(d).slice(0, 80)}${c.reset}`);
    if (!rows.length) console.log(`  ${c.dim}No shadow intel returned (methods unreachable or no hits).${c.reset}`);
  }

  const gf = data.enrich && data.enrich.githubFollowers;
  if (gf && gf.found && gf.followers && gf.followers.length) {
    console.log(`\n  ${c.bold}Social graph${c.reset} ${c.dim}(GitHub followers sample)${c.reset}`);
    for (const f of gf.followers) console.log(`  ${c.dim}→${c.reset} ${f.login}  ${c.dim}${f.url}${c.reset}`);
  }

  if (mutationHits.length) {
    console.log(`\n  ${c.bold}Username variation hits (${mutationHits.length})${c.reset}`);
    for (const m of mutationHits.slice(0, 15)) console.log(`  ${c.dim}${m.variant}${c.reset} → ${c.green}${m.site}${c.reset}`);
    if (mutationHits.length > 15) console.log(`  ${c.dim}…and ${mutationHits.length - 15} more (see report)${c.reset}`);
  }

  if (diff && !diff.isFirst && diff.newSites.length) {
    console.log(`\n  ${c.bold}New since last scan${c.reset}`);
    for (const n of diff.newSites) console.log(`  ${c.green}+${c.reset} ${n}`);
  }

  // ── PHASE 05 // DECLARED IDENTITY ─────────────────────────────────────
  const id = data.identity;
  if (id) {
    phaseBanner(c, '05', 'DECLARED IDENTITY');
    console.log(`  ${c.dim}Declared links only. Nothing inferred.${c.reset}`);

    if (id.relMe.length) {
      const verified = id.relMe.filter((r) => r.verified).length;
      section(c, `Declared links (rel=me) — ${verified}/${id.relMe.length} verified both ways`);
      for (const r of id.relMe.slice(0, 12)) {
        const mark = r.verified ? c.green + '✓' + c.reset : c.red + '✗' + c.reset;
        console.log(`  ${mark} ${r.url}`);
        console.log(`    ${c.dim}via <${r.tag || 'a'}> on ${hostOf(r.source)}${r.sourceSite ? ' (' + r.sourceSite + ')' : ''} — ${r.evidence}${c.reset}`);
      }
      if (id.relMe.length > 12) console.log(`  ${c.dim}…and ${id.relMe.length - 12} more (see report)${c.reset}`);
    } else {
      console.log(`  ${c.dim}No rel=me links found on seeds or profile pages.${c.reset}`);
    }

    if (id.schemas.length) {
      section(c, `Schema.org profiles (${id.schemas.length})`);
      for (const p of id.schemas.slice(0, 8)) {
        const nm = p.name || p.alternateName || '(unnamed)';
        console.log(`  ${c.cyan}${p.type}${c.reset}  ${nm}${p.url ? '  ' + c.dim + p.url + c.reset : ''}`);
        for (const sa of (p.sameAs || []).slice(0, 5)) console.log(`    ${c.dim}sameAs →${c.reset} ${sa}`);
      }
    }

    if (id.feeds.length) {
      section(c, `Author feeds (${id.feeds.length})`);
      for (const f of id.feeds.slice(0, 5)) {
        console.log(`  ${c.bold}${f.title || f.url}${c.reset}  ${c.dim}[${f.kind}]${f.author ? ' by ' + f.author : ''}${c.reset}`);
        for (const it of (f.items || []).slice(0, 3)) console.log(`    ${c.dim}·${c.reset} ${(it.title || '').slice(0, 70)}`);
      }
    }

    if (id.authors && id.authors.length) {
      section(c, 'Author attribution');
      for (const a of id.authors.slice(0, 10)) {
        const mark =
          a.verdict === 'consistent'
            ? c.green + 'consistent' + c.reset
            : a.verdict === 'mismatch'
              ? c.yellow + 'mismatch' + c.reset
              : c.dim + 'unknown' + c.reset;
        console.log(`  "${String(a.author).slice(0, 50)}"  [${mark}]  ${c.dim}${a.source}${c.reset}`);
      }
    }

    if (id.graph && id.graph.edges.length) {
      section(c, `Identity graph (${id.graph.nodes.length} nodes, ${id.graph.edges.length} edges — declared evidence only)`);
      for (const line of id.graphAscii.split('\n').slice(0, 20)) console.log(`  ${c.dim}${line}${c.reset}`);
    }

    if (id.linkHealth && id.linkHealth.length) {
      section(c, 'Link health');
      const rows = id.linkHealth.slice(0, 15).map((l) => {
        const st = l.status === 'alive' ? c.green + 'alive' + c.reset : l.status === 'redirected' ? c.yellow + 'moved' + c.reset : c.red + 'dead' + c.reset;
        const note = l.outdated || l.note || (l.status === 'redirected' ? '→ ' + (l.finalUrl || '') : '');
        return [st, hostOf(l.url), String(note).slice(0, 60)];
      });
      console.log(table(rows, { headers: ['status', 'link', 'note'], colors: c }));
    }

    if (id.profileDiff) {
      const pd = id.profileDiff;
      if (pd.isFirst) {
        section(c, 'Profile diff');
        console.log(`  ${c.dim}first snapshot recorded — changes will show up next scan${c.reset}`);
      } else if (pd.changes.length) {
        section(c, `Profile diff since ${String(pd.checkedAt || '').slice(0, 10)}`);
        for (const ch of pd.changes.slice(0, 15)) {
          console.log(`  ${c.yellow}~${c.reset} ${ch.profile} — ${ch.field}`);
          if (ch.old) console.log(`    ${c.dim}- ${String(ch.old).slice(0, 90)}${c.reset}`);
          if (ch.new) console.log(`    ${c.green}+ ${String(ch.new).slice(0, 90)}${c.reset}`);
        }
      } else {
        section(c, 'Profile diff');
        console.log(`  ${c.dim}no changes since ${String(pd.checkedAt || '').slice(0, 10)}${c.reset}`);
      }
    }

    if (id.assessment) {
      const a = id.assessment;
      section(c, 'Confidence');
      const hc = id.claims.filter((x) => x.tier === 'official-api').length;
      console.log(`  ${c.dim}${id.claims.length} identity claims — ${hc} from official APIs${c.reset}`);
      if (a.conflicting) console.log(`  ${c.yellow}[!]${c.reset} conflicting display names across HIGH-tier sources: ${a.conflictingNames.join(' / ')}`);
      if (a.unverified.length) console.log(`  ${c.yellow}[!]${c.reset} unverified (single low-tier source): ${a.unverified.join(', ')}`);
      if (!a.conflicting && !a.unverified.length) console.log(`  ${c.green}no conflicts, no unverified claims${c.reset}`);
    }

    if (id.content && (id.content.hashtags.length || id.content.creatorPages.length)) {
      section(c, 'Content footprint');
      if (id.content.hashtags.length) console.log('  ' + id.content.hashtags.slice(0, 10).map((h) => `${c.cyan}#${h.tag}${c.reset}${c.dim}×${h.count}${c.reset}`).join('  '));
      for (const cp of id.content.creatorPages.slice(0, 8)) console.log(`  ${c.cyan}${cp.site}${c.reset}  ${c.dim}${cp.url}${c.reset}`);
      console.log(`  ${c.dim}${id.content.items.length} public posts/articles/repos indexed${c.reset}`);
    }
  }

  console.log(`\n  ${c.bold}Reports${c.reset}`);
  for (const [fmt, file] of Object.entries(reportFiles)) {
    if (file) console.log(`  ${c.dim}${fmt.padEnd(5)}${c.reset} ${file}`);
  }
  console.log(`  ${c.dim}json ${c.reset} ${data.jsonRaw} ${c.dim}(latest)${c.reset}`);

  // The DANGER PANEL.
  await printDangerPanel(c, { score: score.score, flags: score.flags });
}
