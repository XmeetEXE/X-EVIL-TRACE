// EVIL TRACE v3.0 — "danger" terminal effects.
// Blood-red gradients, glitch text, scanlines, skull art, phase banners,
// the DANGER PANEL. Everything no-ops cleanly under NO_COLOR / --no-color.
// No emojis.

import { threatRank } from './score.js';

const RESET = '\x1b[0m';
// Blood-red ramp: dark red -> red -> bright red -> magenta.
const REDS = ['\x1b[31m', '\x1b[91m', '\x1b[1m\x1b[91m', '\x1b[95m', '\x1b[1m\x1b[31m'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GLYPHS = ['#', '%', 'X', 'x', '/', '\\\\', '!', '?', '*', '+'];

// Per-line blood-red color ramp across a block of text.
export function bloodRed(text, colors) {
  if (!colors.enabled) return String(text);
  const lines = String(text).split('\n');
  return lines
    .map((l, i) => {
      const code = REDS[Math.floor((i / Math.max(1, lines.length - 1)) * (REDS.length - 1))];
      return code + l + RESET;
    })
    .join('\n');
}

// Glitch text: N frames with random char-substitution flicker.
// Deterministic when a custom rng is passed (used by tests).
export function glitchFrames(text, colors, { frames = 2, intensity = 0.12, rng = Math.random } = {}) {
  const t = String(text);
  if (!colors.enabled) return [t];
  const out = [];
  for (let f = 0; f < frames; f++) {
    let s = '';
    for (const ch of t) {
      if (ch === ' ' || ch === '\n') {
        s += ch;
        continue;
      }
      s += rng() < intensity ? GLYPHS[Math.floor(rng() * GLYPHS.length)] : ch;
    }
    out.push(REDS[f % REDS.length] + s + RESET);
  }
  return out;
}

// Animated glitch line: flickers, then settles on clean blood-red text.
// Falls back to static prints when not on a TTY or colors are off.
export async function glitchPrintLine(text, colors) {
  if (!colors.enabled || !process.stdout.isTTY) {
    for (const f of glitchFrames(text, colors)) console.log('  ' + f);
    return;
  }
  const frames = glitchFrames(text, colors, { frames: 2, intensity: 0.3 });
  process.stdout.write('  ' + frames[0] + '\n');
  await sleep(150);
  process.stdout.write('\x1b[1A\r  ' + frames[1] + '\n');
  await sleep(150);
  process.stdout.write('\x1b[1A\r  ' + bloodRed(text, colors) + '\n');
}

// Full-width phase banner (box-drawing). Prints even with --no-color.
export function phaseBanner(colors, num, title) {
  const label = `PHASE ${num} // ${title}`;
  const w = 68;
  const bar = '═'.repeat(w);
  const pad = ' '.repeat(Math.max(1, w - label.length - 4));
  const lines = [`╔${bar}╗`, `║  ${label}${pad}║`, `╚${bar}╝`];
  if (colors.enabled) {
    console.log('\n' + colors.red + lines[0] + colors.reset);
    console.log(colors.bold + colors.red + lines[1] + colors.reset);
    console.log(colors.red + lines[2] + colors.reset);
  } else {
    console.log('\n' + lines.join('\n'));
  }
}

// Thin scanline divider.
export function scanline(colors, width = 68) {
  const line = '─'.repeat(width);
  console.log(colors.enabled ? colors.darkRed + '  ' + line + colors.reset : '  ' + line);
}

// Small skull ASCII art.
export const SKULL = [
  '      .-""-.',
  '     / .--. \\',
  '    | (o)(o) |',
  '     \\  --  /',
  "     | '--' |",
  '     | .--. |',
  "     | '--' |",
  "      '----'",
];

export function printSkull(colors) {
  console.log(bloodRed(SKULL.join('\n'), colors));
}

// Trace lines for phase 01 findings:
//   [+] GitHub ............ FOUND  [HIGH 82%]  https://...
//   [-] Foo ............... not found            (--verbose, dim)
//   [!] Bar ............... unreachable          (yellow)
export function traceLine(r, colors, { verbose = false } = {}) {
  const c = colors;
  const name = String(r.name).slice(0, 20).padEnd(20);
  const dots = '.'.repeat(Math.max(2, 34 - name.length));
  const url = c.dim + (r.finalUrl || r.url || '') + c.reset;
  if (r.found) {
    const conf = r.confidence || 0;
    const label = r.confLabel || (conf >= 75 ? 'HIGH' : conf >= 45 ? 'MED' : 'LOW');
    const confC = label === 'HIGH' ? c.green : label === 'MED' ? c.yellow : c.red;
    return (
      `  ${c.green}[+]${c.reset} ${c.bold}${name}${c.reset} ${c.dim}${dots}${c.reset} ` +
      `${c.bold}${c.green}FOUND${c.reset}  ${confC}[${label} ${conf}%]${c.reset}  ${url}`
    );
  }
  if (r.status === 'error') {
    return `  ${c.yellow}[!]${c.reset} ${c.dim}${name} ${dots} unreachable${c.reset}`;
  }
  if (verbose) {
    return `  ${c.dim}[-]${c.reset} ${c.dim}${name} ${dots} not found${c.reset}`;
  }
  return null;
}

// Wide blood-red gradient gauge for the DANGER PANEL.
export function dangerGauge(score, colors, width = 56) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const rank = threatRank(s);
  const rankC = colors.enabled
    ? s < 40
      ? colors.green
      : s < 60
        ? colors.yellow
        : colors.red
    : '';
  const filled = Math.round((s / 100) * width);
  let bar = '';
  for (let i = 0; i < width; i++) {
    if (!colors.enabled) {
      bar += i < filled ? '#' : '-';
    } else if (i < filled) {
      bar += REDS[Math.floor((i / Math.max(1, width - 1)) * (REDS.length - 1))] + '█';
    } else {
      bar += colors.dim + '░';
    }
  }
  const line =
    `  ${bar}${colors.enabled ? RESET : ''}  ` +
    `${colors.bold}${colors.enabled ? REDS[2] : ''}${s}/100${colors.reset}  ` +
    `${colors.bold}${rankC}[${rank}]${colors.reset}`;
  return { line, rank };
}

// The final DANGER PANEL: banner, gradient gauge, glitch threat rank,
// skull, top 5 risk flags.
export async function printDangerPanel(colors, { score, flags = [] }) {
  const c = colors;
  const w = 68;
  const title = 'D A N G E R   P A N E L';
  const pad = Math.max(0, Math.floor((w - title.length) / 2));
  console.log('');
  const top = '╔' + '═'.repeat(w) + '╗';
  const mid = '║' + ' '.repeat(pad) + title + ' '.repeat(w - pad - title.length) + '║';
  const bot = '╚' + '═'.repeat(w) + '╝';
  if (c.enabled) {
    console.log(c.red + top + c.reset);
    console.log(c.bold + c.red + mid + c.reset);
    console.log(c.red + bot + c.reset);
  } else {
    console.log(top + '\n' + mid + '\n' + bot);
  }

  const { line, rank } = dangerGauge(score, c);
  console.log('\n' + line + '\n');

  // Threat rank in huge glitch text (letter-spaced).
  const big = rank.split('').join(' ');
  await glitchPrintLine(big, c);
  console.log('');
  printSkull(c);
  console.log('');
  const top5 = flags.slice(0, 5);
  if (top5.length) {
    for (const f of top5) console.log(`  ${c.enabled ? c.red : ''}!!${c.reset} ${f}`);
  } else {
    console.log(`  ${c.dim}No risk flags — this handle barely exists.${c.reset}`);
  }
  console.log('');
}
