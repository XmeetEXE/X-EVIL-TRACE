// Username mutation engine: separator swaps, leet-speak, affixes,
// truncations, trailing digits, common prefixes.
export function usernameMutations(username) {
  const base = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (!base) return [];
  const out = new Set();
  const core = base.replace(/[._-]+/g, '');

  // Separator variants: every separator run becomes one consistent separator.
  for (const sep of ['', '.', '_', '-']) out.add(base.replace(/[._-]+/g, sep));
  out.add(core);

  // Leet-speak variant.
  const leet = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };
  out.add(core.split('').map((c) => leet[c] || c).join(''));

  // Common prefixes.
  for (const pre of ['the', 'real', 'its', 'im', 'iam', 'mr', 'ms', 'x', 'official']) {
    out.add(pre + core);
    out.add(pre + '_' + core);
    out.add(pre + '.' + core);
  }

  // Common suffixes.
  for (const suf of ['x', 'xx', 'official', 'real', 'hq', '_']) {
    out.add(core + suf);
  }

  // Trailing-digit variants (people append numbers when the base is taken).
  for (const d of ['1', '2', '3', '7', '01', '07', '12', '99', '123', '1234', '007', '2024', '2025', '2026']) {
    out.add(core + d);
    out.add(core + '_' + d);
  }

  // Truncations (typos / short forms).
  if (core.length > 5) {
    out.add(core.slice(0, -1));
    out.add(core.slice(1));
    out.add(core.slice(0, -2));
  }

  out.delete(base);
  return [...out].filter((s) => s.length >= 3 && s.length <= 30).slice(0, 64);
}
