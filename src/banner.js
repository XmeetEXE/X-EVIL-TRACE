// EVIL TRACE banner: exact ASCII art + ANSI coloring.
// Respects NO_COLOR / --no-color via the `color` flag.

// Raw art lines — glyphs and spacing preserved exactly.
export const ART = [
  '             ◈',
  '          ╱  │  ╲',
  '       ◇─────┼─────◇',
  '          ╲  │  ╱',
  '      ━━━━━━ ◉ ━━━━━━',
  '          ╲  │  ╱',
  '       ◇─────┼─────◇',
  '          ╲  │  ╱',
  '             ◈',
  '        ╱╲   │   ╱╲',
  '       ╱  ╲  │  ╱  ╲',
  '      ◈─────◉─────◈',
  '       ╲  ╱  │  ╲  ╱',
  '        ╲╱   │   ╲╱',
  '',
  '          E V I L',
];

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  brightRed: '\x1b[91m',
  brightMagenta: '\x1b[95m',
  darkRed: '\x1b[31m',
};

const LINE_GLYPHS = new Set(['╱', '╲', '│', '─', '━', '┼']);

function colorizeLine(line, color) {
  if (!color) return line;
  let out = '';
  for (const ch of line) {
    if (ch === '◈') out += C.brightMagenta + ch + C.reset;
    else if (ch === '◇' || ch === '◉') out += C.brightRed + ch + C.reset;
    else if (LINE_GLYPHS.has(ch)) out += C.darkRed + ch + C.reset;
    else if (/[EVIL]/.test(ch)) out += C.bold + C.brightRed + ch + C.reset;
    else out += ch;
  }
  return out;
}

export function renderBanner({ color = true } = {}) {
  const lines = ART.map((l) => colorizeLine(l, color));
  if (color) {
    lines.push('');
    lines.push(C.bold + C.brightRed + '          T R A C E' + C.reset);
    lines.push(C.dim + '     public digital-footprint auditor' + C.reset);
  } else {
    lines.push('');
    lines.push('          T R A C E');
    lines.push('     public digital-footprint auditor');
  }
  return lines.join('\n');
}

export function printBanner({ color = true } = {}) {
  console.log('\n' + renderBanner({ color }));
}
