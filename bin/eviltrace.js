#!/usr/bin/env node
// EVIL TRACE v4.1 — public digital-footprint auditor.
// Zero dependencies. Node.js 22.5+ (built-in fetch + node:sqlite).
import { runScan, printSummary } from '../src/index.js';
import { printBanner } from '../src/banner.js';
import { makeColors } from '../src/ui.js';

const VERSION = '4.1.0';

// Narrow guard: undici can throw an internal ERR_ASSERTION asynchronously when
// a flaky host drops a connection mid-body (socket-teardown race). The
// affected request is already recorded as failed by the safe fetch helpers,
// so the scan continues. Everything else still crashes loudly.
process.on('uncaughtException', (err) => {
  const stack = String((err && err.stack) || err);
  if (err && err.code === 'ERR_ASSERTION' && stack.includes('undici')) return;
  console.error('  Fatal:', (err && err.message) || err);
  process.exit(1);
});

function help() {
  console.log(`
EVIL TRACE v${VERSION} — username in, footprint out.

usage: eviltrace <username> [options]

  phases: 01 surface sweep · 02 deep trace · 03 shadow methods
          04 exposure autopsy · 05 declared identity

  --quick            only the top 32 sites
  --deep             deep enrichers (implies --shadow, --identity)
  --shadow           10 shadow intel methods
  --no-shadow        skip shadow even with --deep
  --identity         declared-identity phase (rel=me, feeds, schema, link health)
  --no-identity      skip it
  --site URL         seed a personal website for identity analysis
                     (repeatable, max 6)
  --mutations        try username variations on high-signal sites
  --email ADDR       gravatar lookup for this email
  --concurrency N    parallel requests (default 8)
  --timeout MS       per-request timeout ms (default 12000)
  --out DIR          report dir (default ./reports)
  --format LIST      html,json,md (default all)
  --no-color         plain output (also honors NO_COLOR)
  --no-wayback       skip wayback lookups
  --verbose          list misses too
  --help             this

examples:
  eviltrace torvalds --quick
  eviltrace torvalds --quick --deep --mutations
  eviltrace someuser --deep --site https://your-site.com

no install needed. node 22.5+.
public data only — scan usernames you own or are allowed to audit.
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    if (args.length === 0) printBanner({ color: useColor(args) });
    help();
    process.exit(args.length === 0 ? 1 : 0);
  }
  const username = args.find((a) => !a.startsWith('--'));
  if (!username || !/^[a-zA-Z0-9._-]{2,40}$/.test(username)) {
    console.error('  Provide a valid username (letters, numbers, . _ -, 2-40 chars).');
    process.exit(1);
  }
  const num = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) || def : def;
  };
  const str = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
  };
  const email = str('--email', null);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('  Provide a valid email address for --email.');
    process.exit(1);
  }
  const sites = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site' && args[i + 1] && !args[i + 1].startsWith('--')) {
      const u = args[i + 1];
      if (!/^https?:\/\//i.test(u)) {
        console.error(`  --site needs a full URL starting with http(s):// — got "${u}".`);
        process.exit(1);
      }
      sites.push(u);
      i++;
    }
  }
  if (sites.length > 6) {
    console.error('  --site: max 6.');
    process.exit(1);
  }

  const color = useColor(args);
  const colors = makeColors(color);
  printBanner({ color });
  console.log(`  ${colors.dim}Public data only. Scan only usernames you own or are authorized to audit.${colors.reset}`);

  const deep = args.includes('--deep');
  const shadow = !args.includes('--no-shadow') && (args.includes('--shadow') || deep);
  const identity = !args.includes('--no-identity') && (deep || args.includes('--identity') || sites.length > 0);

  const t0 = Date.now();
  try {
    const res = await runScan(username, {
      quick: args.includes('--quick'),
      deep,
      shadow,
      identity,
      sites,
      mutations: args.includes('--mutations'),
      email,
      noWayback: args.includes('--no-wayback'),
      concurrency: num('--concurrency', 8),
      timeoutMs: num('--timeout', 12000),
      outDir: str('--out', undefined),
      format: str('--format', 'html,json,md'),
      verbose: args.includes('--verbose'),
      colors,
    });
    await printSummary(res, username, { colors, verbose: args.includes('--verbose') });
    console.log(`\n  ${colors.dim}Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.${colors.reset}\n`);
  } catch (err) {
    console.error(`  ${colors.red}Scan failed:${colors.reset}`, (err && err.message) || err);
    process.exit(1);
  }
}

function useColor(args) {
  if (args.includes('--no-color')) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return true;
}

main();
