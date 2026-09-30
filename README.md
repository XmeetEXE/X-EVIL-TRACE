# EVIL TRACE

```
             ◈
          ╱  │  ╲
       ◇─────┼─────◇
          ╲  │  ╱
      ━━━━━━ ◉ ━━━━━━
          ╲  │  ╱
       ◇─────┼─────◇
          ╲  │  ╱
             ◈
        ╱╲   │   ╱╲
       ╱  ╲  │  ╱  ╲
      ◈─────◉─────◈
       ╲  ╱  │  ╲  ╱
        ╲╱   │   ╲╱

          E V I L
          T R A C E
```

Give it a username, it tells you where that handle lives on the internet.
5 phases: surface sweep → deep trace → shadow methods → exposure autopsy →
declared identity. Then a blood-red danger panel with your threat rank.

No install. No dependencies. No API keys. Node 22.5+ and you're in.

## run it

fresh clone? run the setup first — checks node, wires up the command, self-tests:

```bash
git clone <repo-url>
cd evil-trace
setup.bat      # windows — double-click works too
./setup.sh     # linux/mac
```

then:

```bash
eviltrace torvalds --quick
eviltrace torvalds --quick --deep --mutations
eviltrace someuser --deep --site https://your-site.com
```

(no setup? `node bin/eviltrace.js` works too. setup just makes the command nicer.)

`--quick` checks the top 32 sites. Default (no flags) checks all 171.
`--deep` adds the enrichers and implies `--shadow` and `--identity`.

## flags

```
--quick            top 32 sites only
--deep             deep enrichers (implies --shadow, --identity)
--shadow           10 shadow intel methods
--no-shadow        skip shadow even with --deep
--identity         declared-identity phase
--no-identity      skip it
--site URL         seed a personal website for identity analysis (max 6, repeatable)
--mutations        username variations on high-signal sites
--email ADDR       gravatar lookup
--concurrency N    default 8
--timeout MS       default 12000
--out DIR          report dir (default ./reports)
--format LIST      html,json,md (default all)
--no-color         plain output (also honors NO_COLOR)
--no-wayback       skip wayback lookups
--verbose          show misses too
```

## phases

| | phase | what it does |
|---|---|---|
| 01 | surface sweep | 171-site existence check, live progress bar, `[HIGH 82%]` trace lines |
| 02 | deep trace | keyless enrichers — keybase proofs, github (repos, commit emails, gists, followers), gitlab, docker hub, npm, dev.to, lichess, codeforces, stackexchange, bluesky, nostr, gravatar; avatar cross-matching; wayback |
| 03 | shadow methods | 10 independent intel sources, corroborated when 2+ agree |
| 04 | exposure autopsy | 0–100 score with itemized breakdown, threat rank, danger panel |
| 05 | declared identity | rel=me two-way verification, RSS/Atom feeds, schema.org profiles, author attribution, identity graph, link health, profile diffs |

## shadow methods

| `via:` | source |
|---|---|
| cert-transparency | crt.sh — domains in public cert logs |
| dns+geo | cloudflare DoH + ip-api geolocation |
| urlscan | urlscan.io archived scans |
| search-surface | duckduckgo quoted-handle mentions |
| news-intel | GDELT news/blog mentions |
| code-search | grep.app public code hits |
| fediverse | mastodon account search |
| reddit-api | karma, account age |
| steam-xml | steamID, member-since, location |
| wikipedia | notable-article match |

## confidence

Every finding gets a tier and a label. HIGH = official API. MEDIUM = page check.
LOW = search surface or news. `conflicting` fires when two HIGH-tier sources
disagree on the display name; `unverified` when something rests on a single
LOW-tier source alone. Scores are heuristics, not proof — a "found" means the
handle exists there, not that it's your guy.

## threat ranks

| score | rank |
|---|---|
| 0–19 | GHOST |
| 20–39 | WHISPER |
| 40–59 | EXPOSED |
| 60–79 | HUNTED |
| 80–100 | DOOMED |

## reports

`reports/` gets a timestamped HTML (danger theme, SVG identity graph, link-health
and diff tables), JSON (everything), and Markdown (the short version).

Scans are stored in `data/evil-trace.db`. Run it again later and you get
`NEW since last scan` plus a profile diff (bio changes, links added/removed).

## declared identity rules

Phase 05 only uses what people publicly declare: rel=me links, schema.org
sameAs, feed authors, profile website fields. rel=me links get fetched both
ways — the target has to link back or it stays "one-way". Nothing is inferred,
ever. If the author string doesn't match a known name it's flagged "mismatch"
and left alone.

## known issues

- reddit blocks most datacenter IPs. nothing I can do about that.
- some sites time out from VPS IPs; residential works better.
- confidence scores are heuristics. treat them like a tip, not a verdict.
- github commit emails only show up if the person didn't use a noreply address.

## layout

```
bin/eviltrace.js   CLI
src/index.js       orchestrator
src/declared.js    phase 05: rel=me, feeds, schema, identity graph
src/confidence.js  tiers, handle matching, confidence scoring
src/links.js       link health checks
src/deep.js        enrichers + metadata + content footprint
src/shadow.js      10 intel methods + corroboration
src/score.js       0-100 scoring + threat ranks
src/db.js          sqlite history + profile snapshots
src/report.js      html/json/md writers
src/checker.js     site existence checks
src/fx.js          the danger aesthetic
data/sites.json    171 site definitions
test/smoke.test.js node --test suite (31 tests)
```

## license

© 2026 XMEET — XMEET License 2026. See LICENSE. Public data only; scan usernames you own or are allowed to audit.
