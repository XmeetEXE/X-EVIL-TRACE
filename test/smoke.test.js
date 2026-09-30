import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usernameMutations } from '../src/mutations.js';
import { computeExposure, extractEmails, extractPhones, threatRank } from '../src/score.js';
import { renderBanner, ART } from '../src/banner.js';
import { getSites, getQuickSites, siteUrl } from '../src/sites.js';
import { makeColors, gauge } from '../src/ui.js';
import { parseCrtsh, filterDomainsForUser, extractDdgResults, parseSteamXml, corroborateIdentities, normalizeIdentity } from '../src/shadow.js';
import { bloodRed, glitchFrames, dangerGauge, traceLine, SKULL } from '../src/fx.js';

test('mutations: base excluded, variants generated, trailing digits present', () => {
  const m = usernameMutations('torvalds');
  assert.ok(m.length > 20, 'should generate a healthy variant set');
  assert.ok(!m.includes('torvalds'), 'base username must be excluded');
  assert.ok(m.includes('torvalds123'), 'trailing-digit variant expected');
  assert.ok(m.includes('torvalds1'), 'trailing-digit variant expected');
  assert.ok(m.includes('thetorvalds') || m.includes('the_torvalds'), 'prefix variant expected');
  assert.ok(m.every((s) => s.length >= 3 && s.length <= 30), 'length bounds respected');
  assert.equal(usernameMutations('').length, 0, 'empty input -> no variants');
});

test('scoring: math is transparent and capped at 100', () => {
  const results = Array.from({ length: 30 }, (_, i) => ({ found: true, category: 'cat' + (i % 10) }));
  const r = computeExposure({
    results,
    avatarGroups: [{ hash: 'x', sites: ['a', 'b', 'c', 'd'] }],
    pii: { realName: 'Jane Doe', location: 'Berlin', emails: ['j@x.io'], phones: ['+491234567890'] },
    linkedCount: 5,
    oldestSnapshotYear: 2010,
  });
  assert.ok(r.score <= 100 && r.score >= 0, 'score within 0-100');
  const sum = r.breakdown.reduce((a, b) => a + b.points, 0);
  assert.equal(r.score, Math.min(100, sum), 'score equals capped breakdown sum');
  assert.ok(r.flags.length >= 5, 'expected several risk flags');
  const empty = computeExposure({ results: [], avatarGroups: [], pii: {}, linkedCount: 0 });
  assert.equal(empty.score, 0, 'no signals -> score 0');
});

test('scoring: PII extractors behave', () => {
  assert.deepEqual(extractEmails('mail me at foo@bar.com ok'), ['foo@bar.com']);
  assert.deepEqual(extractEmails('x@users.noreply.github.com'), [], 'noreply addresses are not PII');
  assert.ok(extractPhones('tel +1 (555) 123-4567').length === 1);
  assert.deepEqual(extractPhones('no digits here'), []);
});

test('banner: renders without throwing, art preserved exactly', () => {
  assert.equal(ART.length, 16, 'art must keep all 16 lines');
  assert.ok(ART[0].includes('◈') && ART[15].includes('E V I L'), 'glyphs preserved');
  const plain = renderBanner({ color: false });
  assert.ok(plain.includes('T R A C E'), 'TRACE line present');
  assert.ok(plain.includes('◈') && plain.includes('◇') && plain.includes('◉'), 'glyphs in output');
  const colored = renderBanner({ color: true });
  assert.ok(colored.includes('\x1b['), 'color mode emits ANSI');
  assert.ok(!plain.includes('\x1b['), 'plain mode emits no ANSI');
});

test('sites.json: valid, >=140 sites, required fields', () => {
  const sites = getSites();
  assert.ok(sites.length >= 140, `expected >=140 sites, got ${sites.length}`);
  const names = new Set();
  for (const s of sites) {
    assert.ok(s.name && typeof s.name === 'string', 'name required');
    assert.ok(s.url && typeof s.url === 'string', 'url required');
    assert.ok(s.category && typeof s.category === 'string', `category required for ${s.name}`);
    assert.ok(!names.has(s.name), `duplicate site name: ${s.name}`);
    names.add(s.name);
    const u = siteUrl(s, 'someuser');
    assert.ok(u.includes('someuser'), `URL template must contain username: ${s.name}`);
  }
  const quick = getQuickSites();
  assert.ok(quick.length >= 30 && quick.length <= 34, `quick set should be ~32, got ${quick.length}`);
});

test('ui: colors toggle and gauge render', () => {
  const off = makeColors(false);
  assert.equal(off.red, '', 'no-color disables codes');
  const on = makeColors(true);
  assert.ok(on.red.includes('\x1b['), 'color enabled emits codes');
  const g = gauge(85, off);
  assert.ok(g.includes('85/100') && g.includes('HIGH'));
});

test('scoring: threat rank boundaries', () => {
  assert.equal(threatRank(0), 'GHOST');
  assert.equal(threatRank(19), 'GHOST');
  assert.equal(threatRank(20), 'WHISPER');
  assert.equal(threatRank(39), 'WHISPER');
  assert.equal(threatRank(40), 'EXPOSED');
  assert.equal(threatRank(59), 'EXPOSED');
  assert.equal(threatRank(60), 'HUNTED');
  assert.equal(threatRank(79), 'HUNTED');
  assert.equal(threatRank(80), 'DOOMED');
  assert.equal(threatRank(100), 'DOOMED');
  assert.equal(threatRank(150), 'DOOMED');
  assert.equal(threatRank(-5), 'GHOST');
});

test('scoring: shadow signals feed the breakdown and stay capped', () => {
  const r = computeExposure({
    results: Array.from({ length: 10 }, () => ({ found: true, category: 'dev' })),
    pii: {},
    shadow: {
      domains: ['torvalds.example.com', 'x-torvalds.net'],
      newsCount: 3,
      codeHits: 42,
      geoCount: 2,
      geoCountries: ['United States', 'Germany'],
      corroborated: [{ identity: 'torvalds', via: ['github', 'keybase:github'], sources: 2 }],
    },
  });
  assert.ok(r.score <= 100 && r.score >= 0);
  const sum = r.breakdown.reduce((a, b) => a + b.points, 0);
  assert.equal(r.score, Math.min(100, sum));
  assert.ok(r.rank, 'rank present');
  assert.ok(r.flags.some((f) => f.includes('Certificate transparency')), 'domain flag');
  assert.ok(r.flags.some((f) => f.includes('Corroborated identity')), 'corroboration flag');
  assert.ok(r.flags.some((f) => f.includes('United States')), 'geo flag');
});

test('shadow: crt.sh fixture parsing', () => {
  const fixture = [
    { name_value: 'torvalds.example.com\nwww.torvalds.example.com' },
    { name_value: '*.wild.example.net' },
    { name_value: 'unrelated.org' },
    { name_value: '' },
    {},
  ];
  const parsed = parseCrtsh(fixture);
  assert.ok(parsed.includes('torvalds.example.com'));
  assert.ok(parsed.includes('www.torvalds.example.com'));
  assert.ok(parsed.includes('wild.example.net'), 'wildcard stripped');
  assert.ok(!parsed.some((d) => d.startsWith('*.')), 'no wildcards remain');
  assert.deepEqual(parseCrtsh(null), []);
  assert.deepEqual(parseCrtsh('nope'), []);
  const filtered = filterDomainsForUser(parsed, 'torvalds');
  assert.ok(filtered.length >= 2 && filtered.every((d) => d.includes('torvalds')));
  assert.ok(!filterDomainsForUser(parsed, 'torvalds').includes('unrelated.org'));
});

test('shadow: DDG html anchor extraction', () => {
  const DDG = 'duckduck' + 'go.com';
  const target = 'http' + 's://example.com/profile/x';
  const html =
    '<div><a rel="nofollow" class="result__a" href="//' + DDG + '/l/?uddg=' +
    encodeURIComponent(target) + '&amp;rut=abc">Example Profile</a></div>' +
    '<div><a class="result__a" rel="nofollow" href="//example.org/x">Second <b>Hit</b></a></div>' +
    '<div><a class="other" href="//example.net/nope">Ignored</a></div>';
  const res = extractDdgResults(html);
  assert.equal(res.length, 2, 'only result__a anchors extracted');
  assert.equal(res[0].url, target, 'uddg wrapper unwrapped');
  assert.equal(res[0].title, 'Example Profile');
  assert.equal(res[0].domain, 'example.com');
  assert.equal(res[1].url, 'https://example.org/x', 'protocol-relative fixed');
  assert.equal(res[1].title, 'Second Hit', 'inner tags stripped');
  assert.deepEqual(extractDdgResults(''), []);
  assert.deepEqual(extractDdgResults(null), []);
});

test('shadow: steam XML parsing', () => {
  const xml = '<profile><steamID>SomeUser</steamID><memberSince>March 2019</memberSince><location>Berlin, Germany</location></profile>';
  const p = parseSteamXml(xml);
  assert.equal(p.found, true);
  assert.equal(p.steamID, 'SomeUser');
  assert.equal(p.memberSince, 'March 2019');
  assert.equal(p.location, 'Berlin, Germany');
  assert.deepEqual(parseSteamXml('<profile></profile>').found, false);
  assert.deepEqual(parseSteamXml('').found, false);
});

test('shadow: identity corroboration logic', () => {
  const out = corroborateIdentities([
    { identity: 'torvalds', via: 'github' },
    { identity: 'Torvalds', via: 'keybase:github' },
    { identity: 'torvalds', via: 'github' },
    { identity: 'someone-else', via: 'reddit-api' },
    { identity: 'x', via: 'wikipedia' },
  ]);
  const torv = out.find((o) => normalizeIdentity(o.identity) === 'torvalds');
  assert.ok(torv, 'torvalds grouped');
  assert.equal(torv.corroborated, true, '2 distinct via -> corroborated');
  assert.deepEqual(torv.via.sort(), ['github', 'keybase:github']);
  const solo = out.find((o) => normalizeIdentity(o.identity) === 'someoneelse');
  assert.equal(solo.corroborated, false, 'single source -> not corroborated');
  assert.ok(!out.some((o) => normalizeIdentity(o.identity) === 'x'), 'too-short identities dropped');
  assert.deepEqual(corroborateIdentities([]), []);
});

test('fx: effects no-op cleanly without color', () => {
  const off = makeColors(false);
  assert.equal(bloodRed('hello', off), 'hello');
  assert.deepEqual(glitchFrames('DOOMED', off), ['DOOMED']);
  const g = dangerGauge(85, off);
  assert.equal(g.rank, 'DOOMED');
  assert.ok(g.line.includes('85/100') && g.line.includes('DOOMED'));
  assert.ok(!g.line.includes('\x1b['), 'no ANSI when disabled');
  assert.ok(SKULL.length >= 6, 'skull art present');
  const t = traceLine({ name: 'GitHub', found: true, confidence: 95, finalUrl: 'u' }, off);
  assert.ok(t.includes('[+]') && t.includes('FOUND'));
  assert.equal(traceLine({ name: 'X', found: false, status: 404 }, off, { verbose: false }), null);
});

test('fx: glitch frames are deterministic with seeded rng', () => {
  const on = makeColors(true);
  const seq = [0.99, 0.01, 0.5, 0.99, 0.01, 0.5];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const a = glitchFrames('ABCD', on, { frames: 1, intensity: 0.5, rng });
  i = 0;
  const b = glitchFrames('ABCD', on, { frames: 1, intensity: 0.5, rng });
  assert.deepEqual(a, b, 'same seed -> same frames');
  assert.ok(a[0].includes('\x1b['), 'colored frames carry ANSI');
});

await test('http: fetchJSONStatus reads status/json; timeouts fail gracefully', async () => {
  const http = await import('node:http');
  const { fetchJSONStatus, fetchText } = await import('../src/http.js');
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') return; // never respond -> connect timeout path
    if (req.url === '/stall') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '1000' });
      res.write('partial');
      return; // headers sent, body stalls -> body-timeout path
    }
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const ok = await fetchJSONStatus(base + '/x', { timeoutMs: 3000 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true });
    const nf = await fetchJSONStatus(base + '/missing', { timeoutMs: 3000 });
    assert.equal(nf.status, 404);
    assert.deepEqual(nf.json, { ok: true }); // status-aware: body still parsed
    const slow = await fetchJSONStatus(base + '/slow', { timeoutMs: 500 });
    assert.equal(slow, null);
    const stalled = await fetchText(base + '/stall', { timeoutMs: 600 });
    assert.equal(stalled.ok, false);
    assert.equal(stalled.error, 'timeout');
  } finally {
    server.closeAllConnections(); // drop keep-alive sockets so the runner exits
    server.close();
  }
});

await test('shadow: skipped entirely when opts.shadow is false', async () => {
  const { runShadow } = await import('../src/shadow.js');
  const r = await runShadow('x', {
    shadow: false,
    onMethod() { throw new Error('must not run'); },
  });
  assert.equal(r.ran, false);
  assert.deepEqual(r.corroborated, []);
});

// ── v4.0 // DECLARED IDENTITY ──

test('confidence: normalizeHandle + classifyMatch', async () => {
  const { normalizeHandle, levenshtein, classifyMatch } = await import('../src/confidence.js');
  assert.equal(normalizeHandle('Torvalds_1991'), 'torvalds1991');
  assert.equal(normalizeHandle('  X-Meet  '), 'xmeet');
  assert.equal(levenshtein('torvalds', 'torvalds'), 0);
  assert.equal(levenshtein('torvalds', 'torvolds'), 1);
  assert.equal(levenshtein('abc', 'xyz'), 3);
  assert.equal(classifyMatch('torvalds', 'torvalds'), 'exact');
  assert.equal(classifyMatch('Torvalds_', 'torvalds'), 'normalized');
  assert.equal(classifyMatch('torvolds', 'torvalds'), 'lookalike');
  assert.equal(classifyMatch('linus', 'torvalds'), 'different');
});

test('confidence: scoreFinding tiers and labels', async () => {
  const { scoreFinding, confLabel, tierRank } = await import('../src/confidence.js');
  const hi = scoreFinding({ tier: 'official-api', matchClass: 'exact' });
  assert.ok(hi.score >= 75 && hi.label === 'HIGH', `expected HIGH, got ${hi.label} ${hi.score}`);
  const lo = scoreFinding({ tier: 'news-intel', matchClass: 'different' });
  assert.ok(lo.score < 45 && lo.label === 'LOW', `expected LOW, got ${lo.label} ${lo.score}`);
  assert.equal(confLabel(75), 'HIGH');
  assert.equal(confLabel(45), 'MED');
  assert.equal(confLabel(44), 'LOW');
  assert.equal(tierRank('official-api'), 'HIGH');
  assert.equal(tierRank('page-check'), 'MEDIUM');
  assert.equal(tierRank('search-surface'), 'LOW');
  const withCorr = scoreFinding({ tier: 'page-check', matchClass: 'exact', corroboratedSources: 3 });
  assert.ok(withCorr.score > scoreFinding({ tier: 'page-check', matchClass: 'exact' }).score, 'corroboration raises confidence');
  assert.ok(hi.lastChecked && hi.lastChecked.includes('T'), 'lastChecked is ISO');
});

test('confidence: assessIdentityClaims flags conflicts and unverified', async () => {
  const { assessIdentityClaims } = await import('../src/confidence.js');
  const conflict = assessIdentityClaims([
    { source: 'GitHub', tier: 'official-api', displayName: 'Linus Torvalds', handle: 'torvalds' },
    { source: 'GitLab', tier: 'official-api', displayName: 'Some Other Guy', handle: 'torvalds' },
  ]);
  assert.equal(conflict.conflicting, true);
  assert.equal(conflict.conflictingNames.length, 2);
  const agree = assessIdentityClaims([
    { source: 'GitHub', tier: 'official-api', displayName: 'Linus Torvalds', handle: 'torvalds' },
    { source: 'GitLab', tier: 'official-api', displayName: 'linus torvalds', handle: 'torvalds' },
  ]);
  assert.equal(agree.conflicting, false);
  const unv = assessIdentityClaims([
    { source: 'ddg', tier: 'search-surface', displayName: 'torvalds fan', handle: 'torvalds' },
  ]);
  assert.deepEqual(unv.unverified, ['ddg'], 'single LOW-tier claim is unverified');
  const backed = assessIdentityClaims([
    { source: 'GitHub', tier: 'official-api', displayName: 'Linus Torvalds', handle: 'torvalds' },
    { source: 'ddg', tier: 'search-surface', displayName: 'torvalds fan', handle: 'torvalds' },
  ]);
  assert.deepEqual(backed.unverified, [], 'LOW-tier claim backed by HIGH-tier is fine');
});

test('declared: extractRelMe parses link+a tags, space-separated rel, relative urls', async () => {
  const { extractRelMe } = await import('../src/declared.js');
  const html = `
    <html><head>
      <link rel="me" href="https://example-one.test/u/x">
      <link rel="me author" href="/relative">
    </head><body>
      <a href="https://example-two.test/@x" rel="me">me</a>
      <a href="https://example-three.test/" rel="author">not me</a>
      <a href="https://example-one.test/u/x" rel="me">dup</a>
    </body></html>`;
  const out = extractRelMe(html, 'https://seed.test/');
  assert.equal(out.length, 3, `expected 3 deduped links, got ${out.length}`);
  assert.ok(out.some((l) => l.url === 'https://example-one.test/u/x' && l.tag === 'link'));
  assert.ok(out.some((l) => l.url === 'https://seed.test/relative' && l.tag === 'link'), 'relative resolved');
  assert.ok(out.some((l) => l.url === 'https://example-two.test/@x' && l.tag === 'a'));
  assert.deepEqual(extractRelMe('', 'https://seed.test/'), []);
});

test('declared: verifyRelMe checks both ways via local server', async () => {
  const http = await import('node:http');
  const { extractRelMe, verifyRelMe } = await import('../src/declared.js');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/a') res.end('<link rel="me" href="/b">');
    else if (req.url === '/b') res.end('<a rel="me" href="/a">back</a>');
    else if (req.url === '/c') res.end('<a rel="me" href="/d">one way</a>');
    else if (req.url === '/d') res.end('<p>no backlink here</p>');
    else { res.writeHead(404); res.end(''); }
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const fromA = extractRelMe('<link rel="me" href="/b">', base + '/a');
    const va = await verifyRelMe(fromA[0], { timeoutMs: 3000 });
    assert.equal(va.verified, true, 'backlink present -> verified');
    assert.ok(va.evidence.includes('backlink'));
    const fromC = extractRelMe('<a rel="me" href="/d">x</a>', base + '/c');
    const vc = await verifyRelMe(fromC[0], { timeoutMs: 3000 });
    assert.equal(vc.verified, false, 'no backlink -> one-way');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('declared: feed links + RSS/Atom parsing', async () => {
  const { extractFeedLinks, parseFeed } = await import('../src/declared.js');
  const html = '<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="alternate" type="application/atom+xml" href="https://feeds.test/a"></head>';
  const feeds = extractFeedLinks(html, 'https://blog.test/');
  assert.deepEqual(feeds, ['https://blog.test/feed.xml', 'https://feeds.test/a']);
  const rss = `<?xml version="1.0"?><rss><channel><title>My Blog</title><link>https://blog.test</link>
    <managingEditor>jane@test.io</managingEditor><lastBuildDate>Mon, 01 Jan 2024 00:00:00 GMT</lastBuildDate>
    <item><title>First post</title><link>https://blog.test/1</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
    <item><title>Second</title><link>https://blog.test/2</link><dc:creator>jane</dc:creator></item></channel></rss>`;
  const p = parseFeed(rss);
  assert.equal(p.kind, 'rss');
  assert.equal(p.title, 'My Blog');
  assert.equal(p.author, 'jane@test.io');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[1].author, 'jane');
  const atom = `<feed><title>Atom Feed</title><author><name>John Doe</name></author>
    <entry><title>Entry one</title><link href="https://blog.test/e1"/><published>2024-01-01</published></entry></feed>`;
  const pa = parseFeed(atom);
  assert.equal(pa.kind, 'atom');
  assert.equal(pa.items[0].link, 'https://blog.test/e1');
  assert.equal(parseFeed('garbage'), null);
});

test('declared: schemaProfiles reads Person + @graph', async () => {
  const { schemaProfiles } = await import('../src/declared.js');
  const html = `<script type="application/ld+json">{
    "@context": "https://schema.org",
    "@graph": [
      {"@type": "Person", "name": "Jane Doe", "alternateName": "janedoe",
       "url": "https://jane.test", "sameAs": ["https://github.com/janedoe", "https://twitter.com/janedoe"],
       "description": "dev"},
      {"@type": "WebSite", "name": "blog"}
    ]}</script>
    <script type="application/ld+json">{"@type":"Person","name":"Jane Doe","url":"https://jane.test","sameAs":["https://github.com/janedoe"]}</script>`;
  const out = schemaProfiles(html);
  assert.equal(out.length, 1, `dedupe expected 1, got ${out.length}`);
  assert.equal(out[0].type, 'Person');
  assert.equal(out[0].name, 'Jane Doe');
  assert.deepEqual(out[0].sameAs, ['https://github.com/janedoe', 'https://twitter.com/janedoe']);
});

test('declared: authorAttribution never infers', async () => {
  const { authorAttribution } = await import('../src/declared.js');
  const out = authorAttribution(
    [{ author: 'Jane Doe', source: 'feed' }, { author: 'someone else', source: 'feed' }, { author: '', source: 'feed' }],
    ['Jane Doe', 'janedoe']
  );
  assert.equal(out[0].verdict, 'consistent');
  assert.equal(out[1].verdict, 'mismatch');
  assert.equal(out[2].verdict, 'unknown');
  const handleInString = authorAttribution([{ author: 'posts by janedoe', source: 'f' }], ['janedoe']);
  assert.equal(handleInString[0].verdict, 'consistent', 'handle inside author string counts');
});

test('declared: identity graph only uses declared evidence', async () => {
  const { buildIdentityGraph, graphToAscii } = await import('../src/declared.js');
  const g = buildIdentityGraph({
    seeds: [{
      url: 'https://jane.test',
      relMe: [{ url: 'https://github.com/janedoe', verified: true }, { url: 'https://mastodon.test/@jane', verified: false }],
      schemas: [{ sameAs: ['https://twitter.com/janedoe'], url: null }],
      feeds: [{ link: 'https://jane.test/feed.xml' }],
      profileLinks: [{ url: 'https://blog.jane.test' }],
    }],
  });
  const ev = new Set(g.edges.map((e) => e.evidence));
  assert.ok(ev.has('rel=me verified') && ev.has('rel=me one-way') && ev.has('schema:sameAs') && ev.has('profile:website') && ev.has('feed:link'));
  assert.ok(![...ev].some((e) => /infer|guess|similar/i.test(e)), 'no inferred edge types');
  assert.equal(g.edges.length, 5);
  const ascii = graphToAscii(g);
  assert.ok(ascii.includes('https://jane.test') && ascii.includes('rel=me verified'));
  assert.equal(graphToAscii({ nodes: [], edges: [] }), '(empty graph)');
});

test('links: checkLink alive/redirected/broken', async () => {
  const http = await import('node:http');
  const { checkLink, analyzeLinks } = await import('../src/links.js');
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('hi'); }
    else if (req.url === '/r1') { res.writeHead(301, { Location: '/r2' }); res.end(); }
    else if (req.url === '/r2') { res.writeHead(302, { Location: '/ok' }); res.end(); }
    else if (req.url === '/gone') { res.writeHead(404); res.end(); }
    else { res.writeHead(500); res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const alive = await checkLink(base + '/ok', { timeoutMs: 3000 });
    assert.equal(alive.status, 'alive');
    const moved = await checkLink(base + '/r1', { timeoutMs: 3000 });
    assert.equal(moved.status, 'redirected');
    assert.equal(moved.hops, 2);
    assert.ok(moved.outdated && moved.outdated.includes('2 hops'), '2-hop chain flagged outdated');
    assert.ok(moved.finalUrl.endsWith('/ok'));
    const dead = await checkLink(base + '/gone', { timeoutMs: 3000 });
    assert.equal(dead.status, 'broken');
    const multi = await analyzeLinks([base + '/ok', base + '/gone', 'not-a-url', base + '/ok'], { timeoutMs: 3000 });
    assert.equal(multi.length, 2, 'deduped + invalid filtered');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('deep: collectMetadata normalizes enrichers', async () => {
  const { collectMetadata, extractHashtags, collectContent } = await import('../src/deep.js');
  const enrich = {
    github: { found: true, login: 'janedoe', name: 'Jane Doe', bio: 'dev', created_at: '2020-01-01T00:00:00Z', html_url: 'https://github.com/janedoe', blog: 'https://jane.test' },
    gitlab: { found: false },
  };
  const shadow = { reddit: { found: true, name: 'janedoe', karma: 42, created: 1577836800, url: 'https://reddit.com/u/janedoe' } };
  const md = collectMetadata({ enrich, shadow });
  assert.equal(md.length, 2);
  const gh = md.find((m) => m.source === 'GitHub');
  assert.equal(gh.displayName, 'Jane Doe');
  assert.equal(gh.tier, 'official-api');
  assert.ok(gh.profileLinks.some((l) => l.url === 'https://jane.test' && l.label === 'website'));
  const rd = md.find((m) => m.source === 'Reddit');
  assert.ok(rd.createdAt.startsWith('2020-01-01'));
  for (const m of md) assert.ok(m.source && m.tier && 'displayName' in m && 'profileLinks' in m, 'uniform shape');
});

test('deep: extractHashtags + collectContent', async () => {
  const { extractHashtags, collectContent } = await import('../src/deep.js');
  const tags = extractHashtags('loving #rust and #Rust, also #linux #linux #linux');
  assert.deepEqual(tags[0], { tag: 'linux', count: 3 });
  assert.deepEqual(tags[1], { tag: 'rust', count: 2 });
  const c = collectContent({
    enrich: { devto: { found: true, articles: [{ title: 'Hello #world', url: 'https://dev.to/x', published: '2024-01-01', tags: [] }] } },
    feeds: [{ title: 'blog', url: 'https://b.test/f', items: [{ title: 'post #one', link: 'https://b.test/1', pubDate: null, author: 'jane' }] }],
    found: [{ found: true, name: 'Patreon', category: 'money', url: 'https://p.test/x', finalUrl: 'https://p.test/x' }, { found: false, name: 'X', category: 'social' }],
  });
  assert.ok(c.items.length >= 2);
  assert.ok(c.hashtags.some((h) => h.tag === 'world' || h.tag === 'one'));
  assert.deepEqual(c.creatorPages, [{ site: 'Patreon', url: 'https://p.test/x' }]);
  assert.ok(c.items.length <= 50, 'item cap');
});

test('db: snapshots diff detects changes', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  process.env.EVILTRACE_DB = path.join(os.tmpdir(), 'et-test-' + Date.now() + '.db');
  const { saveSnapshot, diffSnapshots } = await import('../src/db.js');
  const user = '__test_user_' + Date.now();
  const first = diffSnapshots(user, []);
  assert.equal(first.isFirst, true);
  saveSnapshot(user, 'GitHub:janedoe', { displayName: 'Jane', bio: 'dev', links: ['https://jane.test'] });
  const d1 = diffSnapshots(user, [{ key: 'GitHub:janedoe', displayName: 'Jane', bio: 'dev', links: ['https://jane.test'] }]);
  assert.equal(d1.isFirst, false);
  assert.equal(d1.changes.length, 0, 'no changes');
  const d2 = diffSnapshots(user, [{ key: 'GitHub:janedoe', displayName: 'Jane Doe', bio: 'dev', links: ['https://jane.test', 'https://blog.jane.test'] }]);
  assert.ok(d2.changes.some((c) => c.field === 'display name' && c.old === 'Jane' && c.new === 'Jane Doe'));
  assert.ok(d2.changes.some((c) => c.field === 'links added' && c.new.includes('blog.jane.test')));
  const d3 = diffSnapshots(user, [{ key: 'GitHub:janedoe', displayName: 'Jane Doe', bio: 'dev', links: ['https://blog.jane.test'] }]);
  assert.ok(d3.changes.some((c) => c.field === 'links removed' && c.old.includes('jane.test')));
  await import('node:fs').then((fs) => fs.unlinkSync(process.env.EVILTRACE_DB));
});

test('scoring: declared identity signals add points, still capped at 100', async () => {
  const { computeExposure } = await import('../src/score.js');
  const base = {
    results: [{ found: true, category: 'code' }],
    avatarGroups: [],
    pii: {},
    linkedCount: 0,
    shadow: { domains: [], newsCount: 0, codeHits: 0, geoCount: 0, geoCountries: [], corroborated: [], declared: { verifiedRelMe: 3, corroboratedDeclared: 2 } },
  };
  const r = computeExposure(base);
  const sec = r.breakdown.find((b) => b.label.startsWith('Declared identity'));
  assert.ok(sec, 'declared section present');
  assert.equal(sec.points, 10, '3*2 + 2*2 capped at 10');
  assert.ok(r.flags.some((f) => f.includes('rel=me')), 'flag mentions rel=me');
  const noDec = computeExposure({ ...base, shadow: { ...base.shadow, declared: {} } });
  assert.equal(noDec.breakdown.find((b) => b.label.startsWith('Declared identity')).points, 0);
  const huge = computeExposure({
    results: Array.from({ length: 40 }, () => ({ found: true, category: 'code' })),
    avatarGroups: [{ hash: 'x', sites: ['a', 'b', 'c'] }],
    pii: { realName: 'Jane Doe', emails: ['j@x.io'], phones: ['+491234567890'] },
    linkedCount: 10,
    oldestSnapshotYear: 2008,
    shadow: { domains: ['a.com', 'b.com'], newsCount: 5, codeHits: 30, geoCount: 3, geoCountries: ['US', 'DE'], corroborated: [{ identity: 'x', sources: 2, via: ['a', 'b'] }], declared: { verifiedRelMe: 10, corroboratedDeclared: 10 } },
  });
  assert.ok(huge.score <= 100, 'still capped');
});

test('sites.json: 165+ sites after v4.0 additions', async () => {
  const { getSites } = await import('../src/sites.js');
  const sites = getSites();
  assert.ok(sites.length >= 165, `expected >=165, got ${sites.length}`);
  const names = sites.map((s) => s.name);
  for (const n of ['Carrd', 'Bio.link', 'Read.cv', 'HTB Forum', 'StackBlitz', 'Packagist']) {
    assert.ok(names.includes(n), `missing new site: ${n}`);
  }
});
