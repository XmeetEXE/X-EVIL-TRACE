import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

// EVILTRACE_DB override exists so tests don't touch the real db.
const db = new DatabaseSync(process.env.EVILTRACE_DB || join(dataDir, 'evil-trace.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY,
    username TEXT,
    started_at TEXT,
    finished_at TEXT,
    sites_checked INTEGER,
    found_count INTEGER,
    exposure_score INTEGER,
    deep INTEGER
  );
  CREATE TABLE IF NOT EXISTS results (
    scan_id INTEGER,
    site TEXT,
    url TEXT,
    status TEXT,
    found INTEGER,
    confidence INTEGER,
    category TEXT
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    username TEXT,
    profile_key TEXT,
    display_name TEXT,
    bio TEXT,
    links_json TEXT,
    checked_at TEXT,
    PRIMARY KEY (username, profile_key)
  );
`);

export function saveScan(username, startedAt, finishedAt, results, exposureScore, deep) {
  const found = results.filter((r) => r.found).length;
  const info = db
    .prepare(
      'INSERT INTO scans (username, started_at, finished_at, sites_checked, found_count, exposure_score, deep) VALUES (?,?,?,?,?,?,?)'
    )
    .run(username, startedAt, finishedAt, results.length, found, exposureScore | 0, deep ? 1 : 0);
  const scanId = Number(info.lastInsertRowid);
  const stmt = db.prepare(
    'INSERT INTO results (scan_id, site, url, status, found, confidence, category) VALUES (?,?,?,?,?,?,?)'
  );
  for (const r of results) {
    stmt.run(
      scanId,
      r.name,
      r.finalUrl || r.url,
      String(r.status),
      r.found ? 1 : 0,
      r.confidence || 0,
      r.category || 'misc'
    );
  }
  return scanId;
}

// Found-site names from the most recent scan of this username.
// Call BEFORE saveScan for the current run; used for "NEW since last scan" diffs.
export function lastFoundSites(username) {
  const row = db
    .prepare('SELECT id FROM scans WHERE username = ? ORDER BY id DESC LIMIT 1')
    .get(username);
  if (!row) return { isFirst: true, sites: [] };
  const rows = db.prepare('SELECT site FROM results WHERE scan_id = ? AND found = 1').all(row.id);
  return { isFirst: false, sites: rows.map((r) => r.site) };
}

// ---- public profile history ----
// one snapshot per profile per scan. diff vs the previous snapshot set.
export function saveSnapshot(username, key, { displayName = null, bio = null, links = [] } = {}) {
  db.prepare(
    `INSERT INTO snapshots (username, profile_key, display_name, bio, links_json, checked_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(username, profile_key) DO UPDATE SET
       display_name=excluded.display_name, bio=excluded.bio,
       links_json=excluded.links_json, checked_at=excluded.checked_at`
  ).run(username, key, displayName, bio, JSON.stringify(links || []), new Date().toISOString());
}

// current: [{ key, displayName, bio, links[] }]
export function diffSnapshots(username, current = []) {
  const rows = db.prepare('SELECT * FROM snapshots WHERE username = ?').all(username);
  if (!rows.length) return { isFirst: true, checkedAt: null, changes: [] };
  const prev = new Map(rows.map((r) => [r.profile_key, r]));
  const changes = [];
  const checkedAt = rows[0].checked_at;
  for (const c of current) {
    const p = prev.get(c.key);
    if (!p) {
      changes.push({ profile: c.key, field: 'profile', old: null, new: 'first seen this scan' });
      continue;
    }
    if ((p.display_name || '') !== (c.displayName || ''))
      changes.push({ profile: c.key, field: 'display name', old: p.display_name || '—', new: c.displayName || '—' });
    if ((p.bio || '') !== (c.bio || ''))
      changes.push({ profile: c.key, field: 'bio', old: (p.bio || '—').slice(0, 120), new: (c.bio || '—').slice(0, 120) });
    const po = new Set(JSON.parse(p.links_json || '[]'));
    const co = new Set(c.links || []);
    const added = [...co].filter((x) => !po.has(x));
    const removed = [...po].filter((x) => !co.has(x));
    if (added.length) changes.push({ profile: c.key, field: 'links added', old: null, new: added.slice(0, 5).join(', ') });
    if (removed.length) changes.push({ profile: c.key, field: 'links removed', old: removed.slice(0, 5).join(', '), new: null });
  }
  return { isFirst: false, checkedAt, changes };
}
