CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
  path TEXT, lesson_id TEXT, classe TEXT, matiere TEXT, score INTEGER, total INTEGER,
  visitor TEXT, country TEXT, device TEXT, referrer TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, ts);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, action TEXT NOT NULL,
  detail TEXT, ip_hash TEXT, ok INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_ts ON admin_log(ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
