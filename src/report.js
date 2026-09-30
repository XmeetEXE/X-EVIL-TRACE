// EVIL TRACE v3.0 report — danger theme: near-black, blood-red,
// scanlines, glitch title, skull, animated SVG gauge, per-method `via:` tags.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function confColor(c) {
  if (c >= 80) return '#4ade80';
  if (c >= 60) return '#facc15';
  return '#fb923c';
}

function scoreColor(s) {
  if (s < 35) return '#4ade80';
  if (s < 70) return '#facc15';
  return '#ff1a1a';
}

const SKULL_HTML = `      .-""-.
     / .--. \\
    | (o)(o) |
     \\  --  /
     | '--' |
     | .--. |
     | '--' |
      '----'`;

// Animated SVG gauge: stroke draws itself in via CSS keyframes.
function gaugeSVG(score, rank) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const color = scoreColor(s);
  const r = 80;
  const cx = 100;
  const cy = 95;
  const angle = Math.PI * (1 - s / 100);
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  const large = s > 50 ? 1 : 0;
  const arcLen = Math.PI * r;
  const dash = ((s / 100) * arcLen).toFixed(1);
  return `<svg viewBox="0 0 200 130" width="240" height="156">
    <defs>
      <linearGradient id="blood" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7f1d1d"/><stop offset="0.5" stop-color="#ef4444"/><stop offset="1" stop-color="#ff1a1a"/>
      </linearGradient>
    </defs>
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#1a0505" stroke-width="16" stroke-linecap="round"/>
    <path class="draw" d="M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="url(#blood)" stroke-width="16" stroke-linecap="round"
      stroke-dasharray="${dash} ${arcLen.toFixed(1)}" style="animation: draw 1.6s ease-out forwards"/>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="${color}" font-size="32" font-weight="800" font-family="system-ui">${s}</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="${color}" font-size="13" letter-spacing="4" font-weight="700" font-family="system-ui">${esc(rank || '')}</text>
  </svg>`;
}

export function writeReports({ username, startedAt, finishedAt, results, avatarGroups, enrich, shadow, corroborated, score, wayback, mutations, diff, identity, outDir, formats = ['html', 'json', 'md'] }) {
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = String(username).replace(/[^a-zA-Z0-9._-]/g, '_');
  const out = { html: null, json: null, md: null };

  const found = results.filter((r) => r.found).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const errors = results.filter((r) => r.status === 'error');

  const payload = {
    tool: 'evil-trace',
    version: '4.1.0',
    username,
    startedAt,
    finishedAt,
    exposure: score,
    threatRank: (score && score.rank) || null,
    counts: {
      sitesChecked: results.length,
      found: found.length,
      errors: errors.length,
      avatarGroups: avatarGroups.length,
      mutationHits: (mutations || []).length,
      shadowMethods: shadow ? Object.keys(shadow).length : 0,
      corroborated: (corroborated || []).length,
      relMeVerified: identity ? identity.relMe.filter((r) => r.verified).length : 0,
      schemaProfiles: identity ? identity.schemas.length : 0,
      feeds: identity ? identity.feeds.length : 0,
      linksChecked: identity ? identity.linkHealth.length : 0,
    },
    diff: diff || null,
    identity: identity || null,
    results: results.map(stripBody),
    avatarGroups,
    enrich,
    shadow: shadow || {},
    corroborated: corroborated || [],
    wayback,
    mutations: mutations || [],
  };

  if (formats.includes('json')) {
    out.json = join(outDir, `${safe}-${ts}.json`);
    writeFileSync(out.json, JSON.stringify(payload, null, 2), 'utf8');
  }
  if (formats.includes('html')) {
    out.html = join(outDir, `${safe}-${ts}.html`);
    writeFileSync(out.html, buildHTML(payload, { username, startedAt, finishedAt, found, errors }), 'utf8');
  }
  if (formats.includes('md')) {
    out.md = join(outDir, `${safe}-${ts}.md`);
    writeFileSync(out.md, buildMarkdown(payload, { username, startedAt, finishedAt, found, errors }), 'utf8');
  }
  return out;
}

function stripBody(r) {
  const { body, ...rest } = r;
  return rest;
}

function viaTag(via) {
  return `<span class="via">via: ${esc(via)}</span>`;
}

// identity graph: nodes on a circle, edges labeled with the evidence type.
function graphSVG(graph) {
  const nodes = (graph.nodes || []).slice(0, 14);
  if (!nodes.length) return '<p class="muted">No declared links — empty graph.</p>';
  const W = 920, H = 400, cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 70;
  const pos = new Map();
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.url, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  const edgeColors = {
    'rel=me verified': '#4ade80',
    'rel=me one-way': '#facc15',
    'schema:sameAs': '#22d3ee',
    'profile:website': '#a1a1aa',
    'feed:link': '#c084fc',
    'schema:url': '#a1a1aa',
  };
  const edges = (graph.edges || []).filter((e) => pos.has(e.from) && pos.has(e.to)).slice(0, 24);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#0d0505;border:1px solid #2a0d0d;border-radius:10px">`;
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    const col = edgeColors[e.evidence] || '#71717a';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    s += `<line x1="${a.x.toFixed(0)}" y1="${a.y.toFixed(0)}" x2="${b.x.toFixed(0)}" y2="${b.y.toFixed(0)}" stroke="${col}" stroke-width="1.5" opacity="0.7"/>`;
    s += `<text x="${mx.toFixed(0)}" y="${my.toFixed(0)}" fill="${col}" font-size="10" text-anchor="middle" font-family="Consolas,monospace">${esc(e.evidence)}</text>`;
  }
  for (const n of nodes) {
    const p = pos.get(n.url);
    const isSeed = n.kind === 'seed';
    s += `<circle cx="${p.x.toFixed(0)}" cy="${p.y.toFixed(0)}" r="${isSeed ? 9 : 6}" fill="${isSeed ? '#ff1a1a' : '#1a0a0a'}" stroke="${isSeed ? '#ffb4b4' : '#7f1d1d'}" stroke-width="2"/>`;
    s += `<text x="${p.x.toFixed(0)}" y="${(p.y + 22).toFixed(0)}" fill="#e8e8e8" font-size="11" text-anchor="middle" font-family="Consolas,monospace">${esc((n.label || n.url).slice(0, 22))}</text>`;
  }
  return s + '</svg>';
}

function identityHtml(p) {
  const id = p.identity;
  if (!id) return '<p class="muted">Identity phase was not run (use --deep or --identity).</p>';
  const parts = [];
  parts.push('<p class="muted small">Built from declared evidence only — rel=me links, schema.org metadata, feed links, profile websites. Nothing inferred.</p>');

  // rel=me
  if (id.relMe.length) {
    const verified = id.relMe.filter((r) => r.verified).length;
    parts.push(`<div class="card"><h3>Declared links (rel=me) — ${verified}/${id.relMe.length} verified both ways</h3>
      <table class="mini"><tr><th></th><th>Link</th><th>Declared on</th><th>Evidence</th></tr>
      ${id.relMe.slice(0, 20).map((r) => `<tr>
        <td>${r.verified ? '<span class="pill ok">✓ verified</span>' : '<span class="pill">✗ one-way</span>'}</td>
        <td class="mono"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></td>
        <td class="small dim">${esc(r.source || '')}</td>
        <td class="small dim">${esc(r.evidence || '')}</td></tr>`).join('')}</table></div>`);
  } else {
    parts.push('<p class="muted">No rel=me links found on seeds or profile pages.</p>');
  }

  // schema profiles
  if (id.schemas.length) {
    parts.push(`<div class="card"><h3>Schema.org profiles (${id.schemas.length})</h3>
      ${id.schemas.slice(0, 10).map((p2) => `<div class="crow"><span class="pill">${esc(p2.type)}</span> <strong>${esc(p2.name || p2.alternateName || '(unnamed)')}</strong>
      ${p2.url ? `<a class="small" href="${esc(p2.url)}" target="_blank" rel="noopener">${esc(p2.url)}</a>` : ''}
      ${(p2.sameAs || []).map((sa) => `<div class="small dim">sameAs → <a href="${esc(sa)}" target="_blank" rel="noopener">${esc(sa)}</a></div>`).join('')}</div>`).join('')}</div>`);
  }

  // feeds
  if (id.feeds.length) {
    parts.push(`<div class="card"><h3>Author feeds (${id.feeds.length})</h3>
      ${id.feeds.slice(0, 6).map((f) => `<div class="crow"><strong>${esc(f.title || f.url)}</strong> <span class="dim small">[${esc(f.kind)}]${f.author ? ' by ' + esc(f.author) : ''}</span>
      <ul class="small">${(f.items || []).slice(0, 4).map((it) => `<li>${it.link ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title || it.link)}</a>` : esc(it.title || '')}${it.author ? ` <span class="dim">— ${esc(it.author)}</span>` : ''}</li>`).join('')}</ul></div>`).join('')}</div>`);
  }

  // author attribution
  if (id.authors && id.authors.length) {
    parts.push(`<div class="card"><h3>Author attribution</h3>
      <table class="mini"><tr><th>Declared author</th><th>Verdict</th><th>Source</th></tr>
      ${id.authors.slice(0, 15).map((a) => `<tr><td>${esc(a.author || '—')}</td>
        <td>${a.verdict === 'consistent' ? '<span class="pill ok">consistent</span>' : a.verdict === 'mismatch' ? '<span class="pill">mismatch</span>' : '<span class="dim">unknown</span>'}</td>
        <td class="small dim">${esc(a.source || '')}</td></tr>`).join('')}</table>
      <p class="small dim">String comparison against known display names only — mismatches are flagged, never resolved.</p></div>`);
  }

  // graph
  parts.push(`<div class="card"><h3>Identity graph — ${(id.graph.nodes || []).length} nodes, ${(id.graph.edges || []).length} edges</h3>${graphSVG(id.graph)}</div>`);

  // link health
  if (id.linkHealth && id.linkHealth.length) {
    parts.push(`<div class="card"><h3>Link health (${id.linkHealth.length} checked)</h3>
      <table class="mini"><tr><th>Status</th><th>Link</th><th>Final URL</th><th>Note</th></tr>
      ${id.linkHealth.slice(0, 20).map((l) => `<tr>
        <td>${l.status === 'alive' ? '<span class="pill ok">alive</span>' : l.status === 'redirected' ? '<span class="pill">moved</span>' : '<span class="pill" style="border-color:#991b1b">dead</span>'}</td>
        <td class="mono small"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></td>
        <td class="mono small dim">${esc(l.finalUrl || '—')}</td>
        <td class="small dim">${esc(l.outdated || l.note || '')}</td></tr>`).join('')}</table></div>`);
  }

  // profile diff
  const pd = id.profileDiff;
  if (pd) {
    if (pd.isFirst) {
      parts.push('<div class="card"><h3>Profile diff</h3><p class="muted">First snapshot recorded — changes will show up next scan.</p></div>');
    } else if (pd.changes.length) {
      parts.push(`<div class="card warn"><h3>Profile diff since ${esc((pd.checkedAt || '').slice(0, 10))}</h3>
        <ul>${pd.changes.slice(0, 20).map((ch) => `<li><strong>${esc(ch.profile)}</strong> — ${esc(ch.field)}${ch.old ? `<br><span class="dim">- ${esc(String(ch.old)).slice(0, 120)}</span>` : ''}${ch.new ? `<br><span>+ ${esc(String(ch.new)).slice(0, 120)}</span>` : ''}</li>`).join('')}</ul></div>`);
    } else {
      parts.push(`<div class="card"><h3>Profile diff</h3><p class="muted">No changes since ${esc((pd.checkedAt || '').slice(0, 10))}.</p></div>`);
    }
  }

  // confidence
  if (id.assessment) {
    const a = id.assessment;
    const tierBadge = (t) => (t === 'HIGH' ? '<span class="pill ok">HIGH</span>' : t === 'MEDIUM' ? '<span class="pill">MEDIUM</span>' : '<span class="pill" style="border-color:#991b1b">LOW</span>');
    parts.push(`<div class="card"><h3>Confidence — ${id.claims.length} identity claims</h3>
      <table class="mini"><tr><th>Source</th><th>Tier</th><th>Display name</th><th>Last checked</th></tr>
      ${id.claims.slice(0, 25).map((cl) => `<tr><td>${esc(cl.source)}</td><td>${tierBadge(cl.tier === 'official-api' ? 'HIGH' : cl.tier === 'page-check' ? 'MEDIUM' : 'LOW')}</td>
        <td>${esc(cl.displayName || '—')}</td><td class="small dim mono">${esc((cl.lastChecked || '').slice(0, 19).replace('T', ' '))}</td></tr>`).join('')}</table>
      ${a.conflicting ? `<p class="small" style="color:#facc15">Conflicting display names across HIGH-tier sources: ${esc(a.conflictingNames.join(' / '))}</p>` : ''}
      ${a.unverified.length ? `<p class="small" style="color:#facc15">Unverified (single low-tier source): ${esc(a.unverified.join(', '))}</p>` : ''}
      ${!a.conflicting && !a.unverified.length ? '<p class="small muted">No conflicts, no unverified claims.</p>' : ''}</div>`);
  }

  // content footprint
  const ct = id.content;
  if (ct && (ct.hashtags.length || ct.creatorPages.length || ct.items.length)) {
    parts.push(`<div class="card"><h3>Content footprint — ${ct.items.length} public items indexed</h3>
      ${ct.hashtags.length ? `<p>Tags: ${ct.hashtags.slice(0, 12).map((h) => `<span class="pill">#${esc(h.tag)} ×${h.count}</span>`).join(' ')}</p>` : ''}
      ${ct.creatorPages.length ? `<p class="small">Creator pages: ${ct.creatorPages.map((c2) => `<a href="${esc(c2.url)}" target="_blank" rel="noopener">${esc(c2.site)}</a>`).join(', ')}</p>` : ''}
      <ul class="small">${ct.items.slice(0, 12).map((it) => `<li>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title || it.url)}</a>` : esc(it.title || '')} <span class="dim">[${esc(it.source)}${it.date ? ' · ' + esc(String(it.date).slice(0, 10)) : ''}]</span></li>`).join('')}</ul></div>`);
  }

  return parts.join('\n');
}

function buildHTML(p, ctx) {
  const { username, startedAt, finishedAt, found, errors } = ctx;
  const s = p.exposure || { score: 0, rank: 'GHOST', breakdown: [], flags: [] };
  const sh = p.shadow || {};

  const catCount = {};
  for (const r of found) catCount[r.category || 'misc'] = (catCount[r.category || 'misc'] || 0) + 1;
  const catMax = Math.max(1, ...Object.values(catCount));
  const catBars = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `<div class="catrow"><span class="catname">${esc(cat)}</span>
      <div class="catbar"><div style="width:${Math.round((n / catMax) * 100)}%"></div></div>
      <span class="catnum">${n}</span></div>`)
    .join('');

  const rows = found
    .map((r) => `<tr>
      <td><strong>${esc(r.name)}</strong><div class="small dim">${esc(r.category || '')}</div></td>
      <td><a href="${esc(r.finalUrl || r.url)}" target="_blank" rel="noopener">${esc(r.finalUrl || r.url)}</a></td>
      <td><span class="conf" style="color:${confColor(r.confidence || 0)}">${r.confidence || 0}%</span>
        <div class="bar"><div style="width:${r.confidence || 0}%;background:${confColor(r.confidence || 0)}"></div></div></td>
    </tr>`)
    .join('');

  const flagsHtml = s.flags.length
    ? `<div class="alerts">${s.flags.map((f) => `<div class="alert"><span class="alertmark">!!</span> ${esc(f)}</div>`).join('')}</div>`
    : '<p class="muted">No notable risk flags.</p>';

  const breakdownHtml = (s.breakdown || [])
    .map((b) => `<div class="brow"><span>${esc(b.label)}</span><span class="mono">+${b.points}</span></div>`)
    .join('');

  const corrHtml = (p.corroborated || []).length
    ? `<div class="card danger"><h3>Corroborated identities</h3>
       <p class="muted small">Same identity string confirmed by 2+ independent methods.</p>
       ${(p.corroborated || []).map((ci) => `<div class="crow"><span class="pill ok">${esc(ci.identity)}</span> ${ci.via.map((v) => `<span class="via">${esc(v)}</span>`).join(' ')}</div>`).join('')}</div>`
    : '';

  const kb = p.enrich && p.enrich.keybase;
  const linkedHtml =
    kb && kb.found && kb.proofs && kb.proofs.length
      ? `<div class="card"><h3>Keybase — @${esc(kb.username)}</h3>
         <p class="muted small">${esc(kb.bio || '')}${kb.location ? ' · ' + esc(kb.location) : ''}</p>
         <div>${kb.proofs.map((pr) => `<span class="pill ok">${esc(pr.service)}: ${esc(pr.username)}</span>`).join(' ')}</div>
         <p class="small dim">Cryptographic proofs — these accounts are verified as the same person. ${viaTag('keybase')}</p></div>`
      : '<p class="muted">No Keybase identity with cryptographic proofs found.</p>';

  const avatarHtml = p.avatarGroups.length === 0
    ? '<p class="muted">No shared avatars detected across profiles.</p>'
    : p.avatarGroups.map((g) => `<div class="card">
        <div class="mono small">avatar hash ${esc(g.hash.slice(0, 16))}…</div>
        <div>${g.sites.map((x) => `<span class="pill">${esc(x)}</span>`).join(' ')}</div>
        <p class="muted small">Same profile picture on ${g.sites.length} sites — strong signal these belong to the same person.</p>
      </div>`).join('');

  const gh = p.enrich && p.enrich.github;
  const ghDeep = p.enrich && p.enrich.githubDeep;
  const ghGists = p.enrich && p.enrich.githubGists;
  const ghFol = p.enrich && p.enrich.githubFollowers;
  const githubHtml = gh && gh.found
    ? `<div class="card"><h3>GitHub — @${esc(gh.login)}</h3>
       <p>${esc(gh.name || '')} ${gh.location ? '· ' + esc(gh.location) : ''}</p>
       <p class="muted">${esc(gh.bio || 'No bio')}</p>
       <p class="small">Repos: <strong>${gh.public_repos}</strong> · Followers: <strong>${gh.followers}</strong> · Since ${esc((gh.created_at || '').slice(0, 10))} ${viaTag('github-api')}</p>
       ${ghDeep && ghDeep.topRepos && ghDeep.topRepos.length ? `<p class="small">Top repos: ${ghDeep.topRepos.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> (${r.stars}★)`).join(', ')}</p>` : ''}
       ${ghDeep && ghDeep.commitEmails && ghDeep.commitEmails.length ? `<p class="small" style="color:#ff6b6b">Public commit emails: ${ghDeep.commitEmails.map(esc).join(', ')}</p>` : ''}
       ${ghGists && ghGists.found ? `<p class="small">Gists: ${ghGists.gists.map((g) => `<a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.description || g.files.join(', ') || 'gist')}</a>`).join(', ')}</p>` : ''}
       ${ghFol && ghFol.found ? `<p class="small">Followers sample: ${ghFol.followers.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.login)}</a>`).join(', ')}</p>` : ''}
       </div>`
    : '<p class="muted">No public GitHub profile found for this username.</p>';

  // ── Shadow methods section ──
  const shadowCards = [];
  if (sh.crtsh && sh.crtsh.domains && sh.crtsh.domains.length) {
    shadowCards.push(`<div class="card danger"><h3>Certificate Transparency ${viaTag('cert-transparency')}</h3>
      <p>${sh.crtsh.domains.length} domains in public certificate logs contain this handle.</p>
      <div>${sh.crtsh.domains.slice(0, 20).map((d) => `<span class="pill mono">${esc(d)}</span>`).join(' ')}</div>
      ${sh.crtsh.domains.length > 20 ? `<p class="small dim">…and ${sh.crtsh.domains.length - 20} more (see JSON).</p>` : ''}</div>`);
  }
  if (sh.dnsgeo && sh.dnsgeo.records && sh.dnsgeo.records.length) {
    const recs = sh.dnsgeo.records.filter((r) => r.ip);
    if (recs.length) {
      shadowCards.push(`<div class="card danger"><h3>DNS + IP Geolocation ${viaTag('dns+geo')}</h3>
        <table class="mini"><tr><th>Domain</th><th>IP</th><th>Location</th><th>Org / ISP</th></tr>
        ${recs.map((r) => `<tr><td class="mono">${esc(r.domain)}</td><td class="mono">${esc(r.ip)}</td><td>${esc([r.city, r.region, r.country].filter(Boolean).join(', ') || '—')}</td><td class="small">${esc(r.org || r.isp || '—')}</td></tr>`).join('')}</table></div>`);
    }
  }
  if (sh.urlscan && sh.urlscan.found) {
    shadowCards.push(`<div class="card"><h3>urlscan.io ${viaTag('urlscan')}</h3>
      <p>${sh.urlscan.total} archived page scans match. Top hits:</p>
      <ul class="small">${sh.urlscan.results.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.url)}</a> <span class="dim">${esc(r.domain)}</span></li>`).join('')}</ul></div>`);
  }
  if (sh.ddg && sh.ddg.found) {
    shadowCards.push(`<div class="card"><h3>Web mentions ${viaTag('search-surface')}</h3>
      <p>${sh.ddg.mentionCount} quoted-handle mentions found.</p>
      <ul class="small">${sh.ddg.results.slice(0, 12).map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="dim">${esc(r.domain)}</span></li>`).join('')}</ul></div>`);
  }
  if (sh.gdelt && sh.gdelt.found) {
    shadowCards.push(`<div class="card"><h3>News mentions ${viaTag('news-intel')}</h3>
      <ul class="small">${sh.gdelt.articles.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="dim">${esc(a.domain || '')} · ${esc(a.date || '')}</span></li>`).join('')}</ul></div>`);
  }
  if (sh.grepapp && sh.grepapp.found) {
    shadowCards.push(`<div class="card"><h3>Code search ${viaTag('code-search')}</h3>
      <p>${sh.grepapp.total} public code hits. Top:</p>
      <ul class="small mono">${sh.grepapp.results.slice(0, 12).map((r) => `<li>${esc(r.repo || '?')}/${esc(r.path || '?')}</li>`).join('')}</ul></div>`);
  }
  if (sh.mastodon && sh.mastodon.found) {
    shadowCards.push(`<div class="card"><h3>Fediverse ${viaTag('fediverse')}</h3>
      <div>${sh.mastodon.accounts.map((a) => `<span class="pill">@${esc(a.acct)} <span class="dim">${a.followers || 0} followers</span></span>`).join(' ')}</div></div>`);
  }
  if (sh.reddit && sh.reddit.found) {
    shadowCards.push(`<div class="card"><h3>Reddit ${viaTag('reddit-api')}</h3>
      <p>u/${esc(sh.reddit.name)} · <strong>${sh.reddit.karma}</strong> karma · created ${sh.reddit.created ? new Date(sh.reddit.created * 1000).toISOString().slice(0, 10) : '—'}</p></div>`);
  }
  if (sh.steam && sh.steam.found) {
    shadowCards.push(`<div class="card"><h3>Steam ${viaTag('steam-xml')}</h3>
      <p>${esc(sh.steam.steamID)}${sh.steam.memberSince ? ' · member since ' + esc(sh.steam.memberSince) : ''}${sh.steam.location ? ' · ' + esc(sh.steam.location) : ''}</p></div>`);
  }
  if (sh.wikipedia && sh.wikipedia.found) {
    shadowCards.push(`<div class="card danger"><h3>Wikipedia ${viaTag('wikipedia')}</h3>
      <p><strong>${esc(sh.wikipedia.title)}</strong> — this handle matches a notable article.</p>
      <p class="small muted">${esc(sh.wikipedia.extract)}</p></div>`);
  }
  const shadowHtml = shadowCards.length
    ? shadowCards.join('')
    : '<p class="muted">Shadow methods were not run (use --deep or --shadow), or all returned empty.</p>';

  const wb = p.wayback || [];
  const waybackHtml = wb.length === 0
    ? '<p class="muted">No archived snapshots found.</p>'
    : `<table class="mini"><tr><th>Site</th><th>First seen</th><th>Last seen</th><th>Snapshot</th></tr>${wb.map((w) =>
        `<tr><td><strong>${esc(w.site)}</strong></td><td class="mono">${esc(w.range ? w.range.firstSeen || '—' : '—')}</td><td class="mono">${esc(w.range ? w.range.lastSeen || '—' : '—')}</td><td>${w.snapshot ? `<a href="${esc(w.snapshot.url)}" target="_blank" rel="noopener">${esc(w.snapshot.timestamp)}</a>` : '—'}</td></tr>`).join('')}</table>`;

  const mutHtml = !p.mutations || !p.mutations.length
    ? '<p class="muted">No username variations matched (or mutation scan was skipped).</p>'
    : `<ul>${p.mutations.map((m) => `<li><span class="mono">${esc(m.variant)}</span> → <strong>${esc(m.site)}</strong> <a class="small" href="${esc(m.url)}" target="_blank" rel="noopener">open</a></li>`).join('')}</ul>`;

  const diffHtml = p.diff && p.diff.newSites && p.diff.newSites.length
    ? `<div class="card warn"><strong>NEW since last scan:</strong> ${p.diff.newSites.map(esc).join(', ')}</div>`
    : '';

  const errHtml = errors.length
    ? `<p class="small dim">${errors.length} sites unreachable (timeout/blocked): ${errors.slice(0, 12).map((e) => esc(e.name)).join(', ')}${errors.length > 12 ? '…' : ''}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EVIL TRACE — ${esc(username)}</title>
<style>
  * { box-sizing: border-box; }
  html { background: #030303; }
  body { background: #030303; color: #e8e8e8; font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 24px; position: relative; }
  /* scanline overlay */
  body::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9999;
    background: repeating-linear-gradient(0deg, rgba(255,26,26,.045) 0 1px, transparent 1px 3px); }
  .wrap { max-width: 1120px; margin: 0 auto; position: relative; z-index: 1; }
  .hero { display: flex; gap: 28px; align-items: center; border: 1px solid #7f1d1d; border-radius: 14px;
    padding: 20px 28px; background: linear-gradient(180deg, #120404, #050505); box-shadow: 0 0 60px rgba(255,26,26,.12); }
  .skull { color: #ff1a1a; font-family: Consolas, monospace; font-size: 13px; line-height: 1.25; margin: 0; white-space: pre;
    text-shadow: 0 0 12px rgba(255,26,26,.6); }
  h1.glitch { position: relative; font-size: 34px; letter-spacing: 6px; margin: 0; color: #f8fafc; font-weight: 800; }
  h1.glitch::before, h1.glitch::after { content: attr(data-text); position: absolute; left: 0; top: 0; width: 100%; overflow: hidden; }
  h1.glitch::before { color: #ff1a1a; animation: gl1 2.4s infinite steps(2); clip-path: inset(0 0 55% 0); }
  h1.glitch::after { color: #22d3ee; animation: gl2 3.1s infinite steps(2); clip-path: inset(60% 0 0 0); }
  @keyframes gl1 { 0%,92% { transform: none; opacity: .7; } 93% { transform: translate(-4px,2px); opacity: 1; } 96% { transform: translate(3px,-1px); } 100% { transform: none; opacity: .7; } }
  @keyframes gl2 { 0%,90% { transform: none; opacity: .5; } 91% { transform: translate(4px,1px); opacity: .9; } 95% { transform: translate(-3px,2px); } 100% { transform: none; opacity: .5; } }
  .sub { color: #a1a1aa; margin-top: 8px; }
  h2 { border-bottom: 1px solid #3f0d0d; padding-bottom: 8px; margin-top: 40px; font-size: 18px; letter-spacing: 2px; color: #ffb4b4; text-transform: uppercase; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0; }
  .stat { background: #0d0505; border: 1px solid #3f0d0d; border-radius: 10px; padding: 14px 20px; min-width: 130px; }
  .stat .n { font-size: 26px; font-weight: 700; color: #ff6b6b; }
  .stat .l { color: #a1a1aa; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .gaugewrap { display: flex; gap: 24px; align-items: center; background: #0d0505; border: 1px solid #7f1d1d; border-radius: 12px; padding: 16px 24px; margin: 20px 0; box-shadow: 0 0 40px rgba(255,26,26,.08); }
  @keyframes draw { from { opacity: .2; } to { opacity: 1; } }
  .brow { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #2a0d0d; font-size: 14px; max-width: 600px; }
  .alerts { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .alert { background: #160606; border: 1px solid #991b1b; border-left: 4px solid #ff1a1a; border-radius: 8px; padding: 12px 16px; font-size: 14px; }
  .alertmark { color: #ff1a1a; font-weight: 800; margin-right: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  th, td { text-align: left; padding: 10px; border-bottom: 1px solid #2a0d0d; vertical-align: top; }
  th { color: #a1a1aa; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }
  table.mini { font-size: 13px; }
  a { color: #ff6b6b; text-decoration: none; word-break: break-all; }
  a:hover { text-decoration: underline; }
  .card { background: #0d0505; border: 1px solid #2a0d0d; border-radius: 10px; padding: 16px; margin: 12px 0; }
  .card.danger { border-color: #7f1d1d; box-shadow: 0 0 24px rgba(255,26,26,.07); }
  .card.warn { border-color: #7f1d1d; }
  .pill { display: inline-block; background: #1a0a0a; border: 1px solid #7f1d1d; border-radius: 20px; padding: 3px 12px; margin: 2px; font-size: 13px; }
  .pill.ok { border-color: #166534; background: #052e16; }
  .via { display: inline-block; background: #000; border: 1px dashed #ff1a1a; color: #ff6b6b; border-radius: 4px; padding: 1px 8px; margin-left: 6px; font-size: 11px; font-family: Consolas, monospace; }
  .crow { margin: 8px 0; }
  .muted { color: #a1a1aa; } .dim { color: #71717a; } .small { font-size: 13px; } .mono { font-family: Consolas, monospace; }
  .conf { font-weight: 700; }
  .bar { height: 5px; background: #2a0d0d; border-radius: 3px; margin-top: 4px; max-width: 120px; }
  .bar div { height: 100%; border-radius: 3px; }
  .catrow { display: flex; align-items: center; gap: 10px; margin: 6px 0; font-size: 14px; }
  .catname { width: 130px; color: #a1a1aa; text-transform: capitalize; }
  .catbar { flex: 1; height: 8px; background: #1a0a0a; border-radius: 4px; max-width: 420px; }
  .catbar div { height: 100%; background: linear-gradient(90deg, #7f1d1d, #ff1a1a); border-radius: 4px; }
  .catnum { width: 30px; text-align: right; font-weight: 700; color: #ff6b6b; }
  .rankline { font-size: 15px; letter-spacing: 3px; color: #ff1a1a; font-weight: 700; margin-top: 6px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #2a0d0d; color: #71717a; font-size: 12px; line-height: 1.8; }
  ul { line-height: 1.9; }
</style></head>
<body><div class="wrap">
  <div class="hero">
    <pre class="skull">${SKULL_HTML}</pre>
    <div>
      <h1 class="glitch" data-text="EVIL TRACE">EVIL TRACE</h1>
      <div class="rankline">THREAT RANK: ${esc(s.rank || 'GHOST')}</div>
      <p class="sub">Digital-footprint autopsy for <strong class="mono" style="color:#ff6b6b">${esc(username)}</strong> · ${esc(startedAt)} → ${esc(finishedAt)}</p>
    </div>
  </div>
  ${diffHtml}
  <div class="gaugewrap">
    <div>${gaugeSVG(s.score, s.rank)}</div>
    <div style="flex:1"><h3 style="margin-top:0">Exposure breakdown</h3>${breakdownHtml}</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="n">${p.counts.sitesChecked}</div><div class="l">Sites checked</div></div>
    <div class="stat"><div class="n" style="color:#4ade80">${found.length}</div><div class="l">Profiles found</div></div>
    <div class="stat"><div class="n">${p.counts.corroborated}</div><div class="l">Corroborated</div></div>
    <div class="stat"><div class="n">${p.counts.avatarGroups}</div><div class="l">Avatar matches</div></div>
    <div class="stat"><div class="n" style="color:#facc15">${p.counts.mutationHits}</div><div class="l">Variant hits</div></div>
    <div class="stat"><div class="n" style="color:#4ade80">${p.counts.relMeVerified}</div><div class="l">rel=me verified</div></div>
    <div class="stat"><div class="n" style="color:#a1a1aa">${p.counts.errors}</div><div class="l">Unreachable</div></div>
  </div>
  <h2>Risk flags</h2>
  ${flagsHtml}
  <h2>Shadow methods</h2>
  ${shadowHtml}
  ${corrHtml}
  <h2>Category breakdown</h2>
  ${catBars || '<p class="muted">No profiles found.</p>'}
  <h2>Found profiles</h2>
  ${found.length ? `<table><tr><th>Site</th><th>URL</th><th>Confidence</th></tr>${rows}</table>` : '<p class="muted">No profiles found.</p>'}
  ${errHtml}
  <h2>Linked identities</h2>
  ${linkedHtml}
  <h2>Avatar cross-matching</h2>
  ${avatarHtml}
  <h2>GitHub enrichment</h2>
  ${githubHtml}
  <h2>Archived snapshots (Wayback Machine)</h2>
  ${waybackHtml}
  <h2>Username variation hits</h2>
  ${mutHtml}
  <h2>Declared identity</h2>
  ${identityHtml(p)}
  <div class="footer">
    Generated by EVIL TRACE v4.0 · ${esc(finishedAt)}<br>
    Public data only. Scan only usernames you own or are authorized to audit.
  </div>
</div></body></html>`;
}

function buildMarkdown(p, ctx) {
  const { username, startedAt, finishedAt, found, errors } = ctx;
  const s = p.exposure || { score: 0, rank: 'GHOST', breakdown: [], flags: [] };
  const sh = p.shadow || {};
  const L = [];
  L.push(`# EVIL TRACE — ${username}`);
  L.push('');
  L.push(`Scan: ${startedAt} → ${finishedAt}`);
  L.push('');
  L.push(`## Exposure score: ${s.score}/100 — THREAT RANK: ${s.rank || 'GHOST'}`);
  L.push('');
  for (const b of s.breakdown || []) L.push(`- ${b.label}: +${b.points}`);
  L.push('');
  L.push('## Risk flags');
  L.push('');
  if (s.flags.length) for (const f of s.flags) L.push(`- ${f}`);
  else L.push('- None');
  L.push('');
  if (p.corroborated && p.corroborated.length) {
    L.push('## Corroborated identities');
    L.push('');
    for (const ci of p.corroborated) L.push(`- "${ci.identity}" ← ${ci.via.join(', ')}`);
    L.push('');
  }
  L.push('## Shadow methods');
  L.push('');
  const sm = [];
  if (sh.crtsh && sh.crtsh.domains && sh.crtsh.domains.length) sm.push(`- cert-transparency: ${sh.crtsh.domains.length} domains (${sh.crtsh.domains.slice(0, 5).join(', ')})`);
  if (sh.dnsgeo && sh.dnsgeo.records) { const g = sh.dnsgeo.records.filter((r) => r.ip); if (g.length) sm.push(`- dns+geo: ${g.map((r) => `${r.domain}=${r.country || r.ip}`).slice(0, 5).join(', ')}`); }
  if (sh.urlscan && sh.urlscan.found) sm.push(`- urlscan: ${sh.urlscan.total} archived pages`);
  if (sh.ddg && sh.ddg.found) sm.push(`- search-surface: ${sh.ddg.mentionCount} web mentions`);
  if (sh.gdelt && sh.gdelt.found) sm.push(`- news-intel: ${sh.gdelt.count} articles`);
  if (sh.grepapp && sh.grepapp.found) sm.push(`- code-search: ${sh.grepapp.total} code hits`);
  if (sh.mastodon && sh.mastodon.found) sm.push(`- fediverse: ${sh.mastodon.accounts.map((a) => '@' + a.acct).join(', ')}`);
  if (sh.reddit && sh.reddit.found) sm.push(`- reddit-api: u/${sh.reddit.name} (${sh.reddit.karma} karma)`);
  if (sh.steam && sh.steam.found) sm.push(`- steam-xml: ${sh.steam.steamID}`);
  if (sh.wikipedia && sh.wikipedia.found) sm.push(`- wikipedia: article "${sh.wikipedia.title}"`);
  L.push(...(sm.length ? sm : ['- No shadow intel (not run or no hits).']));
  L.push('');
  L.push(`## Found profiles (${found.length}/${p.counts.sitesChecked})`);
  L.push('');
  L.push('| Site | Category | URL | Confidence |');
  L.push('|---|---|---|---|');
  for (const r of found) L.push(`| ${r.name} | ${r.category || ''} | ${r.finalUrl || r.url} | ${r.confidence || 0}% |`);
  L.push('');
  if (p.avatarGroups.length) {
    L.push('## Avatar matches');
    L.push('');
    for (const g of p.avatarGroups) L.push(`- Same avatar on: ${g.sites.join(', ')}`);
    L.push('');
  }
  const kb = p.enrich && p.enrich.keybase;
  if (kb && kb.found && kb.proofs && kb.proofs.length) {
    L.push('## Linked identities (Keybase proofs)');
    L.push('');
    for (const pr of kb.proofs) L.push(`- ${pr.service}: ${pr.username}`);
    L.push('');
  }
  if (p.mutations && p.mutations.length) {
    L.push('## Username variation hits');
    L.push('');
    for (const m of p.mutations.slice(0, 30)) L.push(`- \`${m.variant}\` → ${m.site} (${m.confLabel || ''} ${m.confidence || ''}%)`);
    L.push('');
  }
  const id = p.identity;
  if (id) {
    L.push('## Declared identity');
    L.push('');
    L.push('_Declared evidence only — nothing inferred._');
    L.push('');
    if (id.relMe.length) {
      const v = id.relMe.filter((r) => r.verified).length;
      L.push(`### rel=me links — ${v}/${id.relMe.length} verified both ways`);
      L.push('');
      for (const r of id.relMe.slice(0, 20)) L.push(`- ${r.verified ? '[verified]' : '[one-way]'} ${r.url} (via ${r.source}) — ${r.evidence}`);
      L.push('');
    }
    if (id.schemas.length) {
      L.push(`### Schema.org profiles (${id.schemas.length})`);
      L.push('');
      for (const p2 of id.schemas.slice(0, 10)) {
        L.push(`- ${p2.type}: ${p2.name || p2.alternateName || '(unnamed)'}${p2.url ? ' — ' + p2.url : ''}`);
        for (const sa of p2.sameAs || []) L.push(`  - sameAs: ${sa}`);
      }
      L.push('');
    }
    if (id.feeds.length) {
      L.push(`### Author feeds (${id.feeds.length})`);
      L.push('');
      for (const f of id.feeds.slice(0, 6)) {
        L.push(`- ${f.title || f.url} [${f.kind}]${f.author ? ' by ' + f.author : ''}`);
        for (const it of (f.items || []).slice(0, 4)) L.push(`  - ${it.title || ''}${it.author ? ' — ' + it.author : ''}`);
      }
      L.push('');
    }
    if (id.authors && id.authors.length) {
      L.push('### Author attribution');
      L.push('');
      for (const a of id.authors.slice(0, 15)) L.push(`- "${a.author}" → ${a.verdict} (${a.source})`);
      L.push('');
    }
    if (id.graph && id.graph.edges.length) {
      L.push(`### Identity graph (${id.graph.nodes.length} nodes, ${id.graph.edges.length} edges)`);
      L.push('');
      L.push('```');
      L.push(id.graphAscii);
      L.push('```');
      L.push('');
    }
    if (id.linkHealth && id.linkHealth.length) {
      L.push(`### Link health (${id.linkHealth.length} checked)`);
      L.push('');
      L.push('| Status | Link | Final URL | Note |');
      L.push('|---|---|---|---|');
      for (const l of id.linkHealth.slice(0, 20)) L.push(`| ${l.status} | ${l.url} | ${l.finalUrl || ''} | ${l.outdated || l.note || ''} |`);
      L.push('');
    }
    if (id.profileDiff && !id.profileDiff.isFirst && id.profileDiff.changes.length) {
      L.push(`### Profile diff since ${String(id.profileDiff.checkedAt || '').slice(0, 10)}`);
      L.push('');
      for (const ch of id.profileDiff.changes.slice(0, 20)) L.push(`- ${ch.profile} — ${ch.field}: ${ch.old || ''} → ${ch.new || ''}`);
      L.push('');
    }
    if (id.assessment) {
      const a = id.assessment;
      L.push(`### Confidence — ${id.claims.length} identity claims`);
      L.push('');
      for (const cl of id.claims.slice(0, 25)) L.push(`- ${cl.source} [${cl.tier}] ${cl.displayName || '—'}`);
      if (a.conflicting) L.push(`- CONFLICT: ${a.conflictingNames.join(' / ')}`);
      if (a.unverified.length) L.push(`- UNVERIFIED: ${a.unverified.join(', ')}`);
      L.push('');
    }
    if (id.content && (id.content.hashtags.length || id.content.creatorPages.length)) {
      L.push(`### Content footprint — ${id.content.items.length} public items`);
      L.push('');
      if (id.content.hashtags.length) L.push('Tags: ' + id.content.hashtags.slice(0, 12).map((h) => `#${h.tag}×${h.count}`).join(' '));
      if (id.content.creatorPages.length) L.push('Creator pages: ' + id.content.creatorPages.map((c2) => `${c2.site} (${c2.url})`).join(', '));
      L.push('');
    }
  }
  if (errors.length) {
    L.push(`## Unreachable (${errors.length})`);
    L.push('');
    L.push(errors.map((e) => e.name).join(', '));
    L.push('');
  }
  L.push('---');
  L.push(`Generated by EVIL TRACE v4.0 · ${finishedAt}`);
  L.push('Public data only. Scan only usernames you own or are authorized to audit.');
  return L.join('\n');
}
