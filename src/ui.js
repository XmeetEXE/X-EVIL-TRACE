// Terminal UI primitives: colors, progress bar, spinner, box tables, gauges.
// No emojis. Respects NO_COLOR / --no-color.

export function makeColors(enabled) {
  const on = (code) => (enabled ? code : '');
  return {
    enabled,
    reset: on('\x1b[0m'),
    bold: on('\x1b[1m'),
    dim: on('\x1b[2m'),
    red: on('\x1b[91m'),
    darkRed: on('\x1b[31m'),
    green: on('\x1b[92m'),
    yellow: on('\x1b[93m'),
    magenta: on('\x1b[95m'),
    cyan: on('\x1b[96m'),
    gray: on('\x1b[90m'),
    white: on('\x1b[97m'),
  };
}

// Live progress bar: [██████░░░░] 71/150 · found 12
export class Progress {
  constructor(total, colors, { width = 24 } = {}) {
    this.total = total;
    this.done = 0;
    this.found = 0;
    this.c = colors;
    this.width = width;
    this.lastLen = 0;
  }
  tick(wasFound) {
    this.done++;
    if (wasFound) this.found++;
    this.render();
  }
  render() {
    const { c } = this;
    const ratio = this.total ? this.done / this.total : 0;
    const filled = Math.round(ratio * this.width);
    const bar = '█'.repeat(filled) + '░'.repeat(this.width - filled);
    const line =
      `  ${c.dim}[${c.reset}${c.red}${bar}${c.reset}${c.dim}]${c.reset}` +
      ` ${String(this.done).padStart(3)}/${this.total}` +
      ` ${c.dim}·${c.reset} found ${c.bold}${c.green}${this.found}${c.reset}`;
    const pad = ' '.repeat(Math.max(0, this.lastLen - line.replace(/\x1b\[[0-9]+m/g, '').length));
    process.stdout.write('\r' + line + pad);
    this.lastLen = line.replace(/\x1b\[[0-9]+m/g, '').length;
  }
  finish() {
    process.stdout.write('\n');
  }
}

// Minimal spinner for sequential phases.
export class Spinner {
  constructor(colors) {
    this.c = colors;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.i = 0;
    this.timer = null;
    this.label = '';
  }
  start(label) {
    this.label = label;
    if (!this.c.enabled) {
      process.stdout.write('  ' + label + '...\n');
      return;
    }
    this.timer = setInterval(() => {
      const f = this.frames[this.i++ % this.frames.length];
      process.stdout.write(`\r  ${this.c.red}${f}${this.c.reset} ${this.label}...`);
    }, 80);
  }
  stop(ok = true) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      const mark = ok ? this.c.green + 'done' + this.c.reset : this.c.yellow + 'done' + this.c.reset;
      process.stdout.write(`\r  ${mark}  ${this.label}${' '.repeat(20)}\n`);
    }
  }
}

export function section(colors, title) {
  console.log(`\n  ${colors.dim}──${colors.reset} ${colors.bold}${colors.white}${title}${colors.reset} ${colors.dim}${'─'.repeat(Math.max(4, 46 - title.length))}${colors.reset}`);
}

// Box-drawing table. rows: array of arrays of strings. opts: headers, colors, align.
export function table(rows, { headers = null, colors, colWidths = null } = {}) {
  const c = colors;
  const all = headers ? [headers, ...rows] : rows;
  if (!all.length) return '';
  const ncols = Math.max(...all.map((r) => r.length));
  const widths = [];
  for (let i = 0; i < ncols; i++) {
    let w = colWidths && colWidths[i] ? colWidths[i] : 0;
    for (const r of all) {
      const cell = String(r[i] ?? '');
      w = Math.max(w, stripAnsi(cell).length);
    }
    widths.push(Math.min(w, 72));
  }
  const line = (l, m, rj, r) => l + widths.map((w) => m.repeat(w + 2)).join(rj) + r;
  const top = c.dim + line('┌', '─', '┬', '┐') + c.reset;
  const mid = c.dim + line('├', '─', '┼', '┤') + c.reset;
  const bot = c.dim + line('└', '─', '┴', '┘') + c.reset;
  const fmtRow = (r) =>
    c.dim + '│' + c.reset +
    r.map((cell, i) => {
      const s = String(cell ?? '');
      const padLen = Math.max(0, widths[i] - stripAnsi(s).length);
      let clipped = s;
      if (stripAnsi(s).length > widths[i]) clipped = truncateAnsi(s, widths[i]);
      return ' ' + clipped + ' '.repeat(padLen) + ' ' + c.dim + '│' + c.reset;
    }).join('');
  const out = [top];
  if (headers) {
    out.push(fmtRow(headers.map((h) => c.bold + c.white + h + c.reset)));
    out.push(mid);
  }
  for (const r of rows) out.push(fmtRow(r));
  out.push(bot);
  return out.join('\n');
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]+m/g, '');
}

function truncateAnsi(s, maxLen) {
  let out = '';
  let len = 0;
  const re = /\x1b\[[0-9;]+m|./gsu;
  let m;
  while ((m = re.exec(s))) {
    const tok = m[0];
    if (tok.startsWith('\x1b')) {
      out += tok;
      continue;
    }
    if (len >= maxLen) break;
    out += tok;
    len++;
  }
  return out + '…';
}

// ASCII exposure gauge 0-100 with green→yellow→red coloring.
export function gauge(score, colors, width = 40) {
  const c = colors;
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const filled = Math.round((s / 100) * width);
  const barColor = s < 35 ? c.green : s < 70 ? c.yellow : c.red;
  const bar = barColor + '█'.repeat(filled) + c.reset + c.dim + '░'.repeat(width - filled) + c.reset;
  const label = s < 35 ? 'LOW' : s < 70 ? 'MODERATE' : 'HIGH';
  const labelColor = s < 35 ? c.green : s < 70 ? c.yellow : c.red;
  return `  ${bar}  ${c.bold}${barColor}${s}/100${c.reset} ${labelColor}[${label}]${c.reset}`;
}

export function exposureLabel(score, colors) {
  const c = colors;
  if (score < 35) return c.green + 'LOW' + c.reset;
  if (score < 70) return c.yellow + 'MODERATE' + c.reset;
  return c.red + 'HIGH' + c.reset;
}
