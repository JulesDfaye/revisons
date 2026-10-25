// Révisons — Worker : suivi anonyme des visites + API d'administration protégée.
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const clip = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : null);
const DAY = 864e5;
const DEFAULT = { announcement: '', maintenance: false, maintenanceMessage: 'Le site est en maintenance. Reviens bientôt !', hidden: [], overrides: {} };
const FIELDS = ['titre', 'objectif', 'texte', 'exemple', 'activite'];

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, path TEXT, lesson_id TEXT, classe TEXT, matiere TEXT, score INTEGER, total INTEGER, visitor TEXT, country TEXT, device TEXT, referrer TEXT)',
  'CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)',
  'CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, ts)',
  'CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT, ip_hash TEXT, ok INTEGER NOT NULL DEFAULT 1)',
  'CREATE INDEX IF NOT EXISTS idx_admin_ts ON admin_log(ts)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];
// Crée les tables au premier appel : aucun script de migration à lancer au déploiement.
let ready;
const ensureSchema = (env) => (ready ||= env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { ready = null; throw e; }));

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function isAdmin(req, env) {
  const m = /(?:^|; )rv_admin=([^;]+)/.exec(req.headers.get('cookie') || '');
  if (!m || !env.SESSION_SECRET) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return eq(sig, await hmac(env.SESSION_SECRET, exp));
}
const ipHash = async (req, env) => (await sha((req.headers.get('cf-connecting-ip') || 'local') + (env.SESSION_SECRET || ''))).slice(0, 16);
const adminLog = (env, action, detail, ip, ok = 1) =>
  env.DB.prepare('INSERT INTO admin_log (ts, action, detail, ip_hash, ok) VALUES (?,?,?,?,?)').bind(Date.now(), action, clip(detail, 300), ip, ok).run();

async function getConfig(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key='config'").first();
  try { return { ...DEFAULT, ...(r ? JSON.parse(r.value) : {}) }; } catch { return { ...DEFAULT }; }
}
function cleanConfig(c = {}) {
  const out = { announcement: clip(c.announcement, 300) || '', maintenance: !!c.maintenance, maintenanceMessage: clip(c.maintenanceMessage, 300) || DEFAULT.maintenanceMessage, hidden: [], overrides: {} };
  if (Array.isArray(c.hidden)) out.hidden = c.hidden.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 500);
  if (c.overrides && typeof c.overrides === 'object') {
    for (const [id, f] of Object.entries(c.overrides).slice(0, 500)) {
      const o = {};
      for (const k of FIELDS) if (typeof f?.[k] === 'string' && f[k].trim()) o[k] = f[k].slice(0, 2000);
      if (Object.keys(o).length) out.overrides[id.slice(0, 40)] = o;
    }
  }
  return out;
}
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function track(req, env) {
  const ua = req.headers.get('user-agent') || '';
  if (/bot|crawl|spider|slurp|preview|headless/i.test(ua)) return new Response(null, { status: 204 });
  let b; try { b = JSON.parse((await req.text()).slice(0, 2048)); } catch { return new Response(null, { status: 400 }); }
  if (!['visit', 'lesson_open', 'quiz_done'].includes(b.type)) return new Response(null, { status: 400 });
  const visitor = (await sha(String(b.v || '').slice(0, 40) + (env.SESSION_SECRET || ''))).slice(0, 16);
  const device = /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'ordinateur';
  const num = (n) => (Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null);
  await env.DB.prepare('INSERT INTO events (ts,type,path,lesson_id,classe,matiere,score,total,visitor,country,device,referrer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(Date.now(), b.type, clip(b.path), clip(b.lesson, 40), clip(b.classe, 20), clip(b.matiere, 40), num(b.score), num(b.total), visitor, req.cf?.country || null, device, clip(b.ref, 80)).run();
  return new Response(null, { status: 204 });
}

async function admin(req, env, url) {
  const route = url.pathname.replace('/api/admin/', '');
  const ip = await ipHash(req, env);
  if (route === 'login' && req.method === 'POST') {
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: 'Configuration serveur incomplète (secrets manquants).' }, 500);
    const fails = await env.DB.prepare("SELECT COUNT(*) n FROM admin_log WHERE action='login_fail' AND ip_hash=? AND ts>?").bind(ip, Date.now() - 15 * 60e3).first();
    if (fails.n >= 5) return json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' }, 429);
    let b = {}; try { b = await req.json(); } catch { /* corps invalide */ }
    const okMail = eq(await sha(String(b.email || '').trim().toLowerCase()), await sha(env.ADMIN_EMAIL.trim().toLowerCase()));
    const okPass = eq(await sha(String(b.password || '')), await sha(env.ADMIN_PASSWORD));
    if (!(okMail && okPass)) { await adminLog(env, 'login_fail', `e-mail saisi : ${clip(String(b.email || ''), 80)}`, ip, 0); return json({ error: 'Identifiants incorrects.' }, 401); }
    const exp = String(Date.now() + 8 * 3600e3);
    await adminLog(env, 'login_ok', 'Connexion administrateur', ip);
    return json({ ok: true }, 200, { 'set-cookie': `rv_admin=${exp}.${await hmac(env.SESSION_SECRET, exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
  }
  if (!(await isAdmin(req, env))) return json({ error: 'Non autorisé' }, 401);
  if (req.method === 'POST' && req.headers.get('x-rv-admin') !== '1') return json({ error: 'Requête refusée' }, 403);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days')) || 7, 1), 365);
  const since = Date.now() - days * DAY;
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);

  if (route === 'logout') { await adminLog(env, 'logout', '', ip); return json({ ok: true }, 200, { 'set-cookie': 'rv_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }); }
  if (route === 'stats') {
    const [tot, daily, top, byClasse, byCountry, byDevice, avg] = (await env.DB.batch([
      q("SELECT SUM(type='visit') visits, COUNT(DISTINCT visitor) visitors, SUM(type='lesson_open') lessons, SUM(type='quiz_done') quizzes FROM events WHERE ts>=?", since),
      q("SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') d, SUM(type='visit') visits FROM events WHERE ts>=? GROUP BY d ORDER BY d", since),
      q("SELECT lesson_id k, COUNT(*) n FROM events WHERE type='lesson_open' AND ts>=? AND lesson_id IS NOT NULL GROUP BY lesson_id ORDER BY n DESC LIMIT 10", since),
      q("SELECT classe k, COUNT(*) n FROM events WHERE type='lesson_open' AND ts>=? AND classe IS NOT NULL GROUP BY classe ORDER BY n DESC", since),
      q("SELECT country k, COUNT(DISTINCT visitor) n FROM events WHERE ts>=? AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 10", since),
      q("SELECT device k, COUNT(DISTINCT visitor) n FROM events WHERE ts>=? AND device IS NOT NULL GROUP BY device ORDER BY n DESC", since),
      q("SELECT ROUND(AVG(100.0*score/total),1) avg FROM events WHERE type='quiz_done' AND total>0 AND ts>=?", since),
    ])).map((r) => r.results);
    const t = tot[0] || {};
    return json({ days, visits: t.visits || 0, visitors: t.visitors || 0, lessons: t.lessons || 0, quizzes: t.quizzes || 0, avgScore: avg[0]?.avg ?? null, daily, top, byClasse, byCountry, byDevice });
  }
  if (route === 'events' || route === 'events.csv') {
    const where = ['ts>=?'], a = [since];
    const type = url.searchParams.get('type'), term = (url.searchParams.get('q') || '').slice(0, 40);
    if (type) { where.push('type=?'); a.push(type); }
    if (term) { where.push('(lesson_id LIKE ? OR classe LIKE ? OR matiere LIKE ? OR country LIKE ?)'); const l = `%${term}%`; a.push(l, l, l, l); }
    const w = where.join(' AND ');
    if (route === 'events.csv') {
      const rows = (await q(`SELECT * FROM events WHERE ${w} ORDER BY ts DESC LIMIT 20000`, ...a).all()).results;
      const cols = ['ts', 'type', 'path', 'lesson_id', 'classe', 'matiere', 'score', 'total', 'visitor', 'country', 'device', 'referrer'];
      const body = [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(c === 'ts' ? new Date(r.ts).toISOString() : r[c])).join(','))).join('\n');
      await adminLog(env, 'export_csv', `${rows.length} lignes`, ip);
      return new Response('\ufeff' + body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="journal-revisons.csv"', 'cache-control': 'no-store' } });
    }
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200), offset = Math.max(parseInt(url.searchParams.get('offset')) || 0, 0);
    const rows = (await q(`SELECT * FROM events WHERE ${w} ORDER BY ts DESC LIMIT ? OFFSET ?`, ...a, limit, offset).all()).results;
    const total = (await q(`SELECT COUNT(*) n FROM events WHERE ${w}`, ...a).first()).n;
    return json({ rows, total });
  }
  if (route === 'log') return json({ rows: (await q('SELECT * FROM admin_log ORDER BY ts DESC LIMIT 100').all()).results });
  if (route === 'config' && req.method === 'GET') return json(await getConfig(env));
  if (route === 'config' && req.method === 'POST') {
    const c = cleanConfig(await req.json().catch(() => ({})));
    await q("INSERT INTO settings (key,value) VALUES ('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(c)).run();
    await adminLog(env, 'config_update', `maintenance=${c.maintenance} ; masquées=${c.hidden.length} ; modifiées=${Object.keys(c.overrides).length} ; annonce=${c.announcement ? 'oui' : 'non'}`, ip);
    return json({ ok: true, config: c });
  }
  if (route === 'purge' && req.method === 'POST') {
    const b = await req.json().catch(() => ({})); const d = Math.min(Math.max(parseInt(b.days) || 90, 1), 3650);
    const r = await q('DELETE FROM events WHERE ts<?', Date.now() - d * DAY).run();
    await adminLog(env, 'purge', `événements de plus de ${d} jours supprimés (${r.meta?.changes ?? '?'})`, ip);
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
  }
  return json({ error: 'Introuvable' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) await ensureSchema(env);
      if (url.pathname === '/api/track' && req.method === 'POST') return await track(req, env);
      if (url.pathname === '/api/config' && req.method === 'GET') {
        const c = await getConfig(env);
        return json(c, 200, { 'cache-control': 'public, max-age=60' });
      }
      if (url.pathname.startsWith('/api/admin/')) return await admin(req, env, url);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Introuvable' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Erreur serveur' }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};
