// Vérifie le projet puis la cohérence du catalogue (LESSONS / REFS) avant chaque déploiement.
// Lancé par « npm run build » (commande de build Cloudflare). Placé à la racine du dépôt.
import { existsSync, readFileSync } from 'node:fs';
const root = new URL('./', import.meta.url);
const required = ['wrangler.jsonc', 'src/index.js', 'public/index.html', 'public/admin/index.html', 'public/404.html', 'public/_headers', 'migrations/0001_init.sql'];
const missing = required.filter((f) => !existsSync(new URL(f, root)));
if (missing.length) {
  console.error('✗ Fichiers ou dossiers absents du dépôt :\n- ' + missing.join('\n- '));
  console.error('\nCause probable : les sous-dossiers (public/, src/, migrations/) n\'ont pas été envoyés sur GitHub.');
  console.error('Envoyez TOUT le contenu du projet avec git (git add -A && git commit && git push) ou glissez les dossiers entiers dans GitHub.');
  process.exit(1);
}
const html = readFileSync(new URL('public/index.html', root), 'utf8').split('\n');
const grab = (start) => {
  const line = html.find((l) => l.startsWith(start));
  if (!line) throw new Error(`Bloc introuvable : ${start}`);
  return JSON.parse(line.slice(start.length).replace(/;\s*$/, ''));
};
const L = grab('const LESSONS = '), R = grab('const REFS = ');
const errors = [], ids = new Set();
for (const d of L) {
  const w = (m) => errors.push(`${d.id || '?'} : ${m}`);
  if (!d.id) w('id manquant'); else if (ids.has(d.id)) w('id en double'); else ids.add(d.id);
  for (const k of ['classe', 'matiere', 'rubrique', 'titre', 'objectif', 'texte', 'exemple', 'activite']) if (!d[k]) w(`champ « ${k} » vide`);
  if (!R[d.source]) w(`source inconnue « ${d.source} »`);
  if (!d.questions?.length) w('aucune question');
  (d.questions || []).forEach((q, i) => {
    const [text, opts, good, why] = q;
    if (!text) w(`Q${i + 1} sans énoncé`);
    if (!Array.isArray(opts) || opts.length < 2) w(`Q${i + 1} : moins de 2 choix`);
    else if (new Set(opts).size !== opts.length) w(`Q${i + 1} : choix en double`);
    if (!Number.isInteger(good) || good < 0 || good >= (opts || []).length) w(`Q${i + 1} : bonne réponse invalide`);
    if (!why || why.length < 8) w(`Q${i + 1} : explication manquante`);
  });
}
const nq = L.reduce((n, d) => n + d.questions.length, 0);
if (errors.length) { console.error(`✗ ${errors.length} problème(s) :\n- ` + errors.join('\n- ')); process.exit(1); }
console.log(`✓ Contenu valide : ${L.length} leçons, ${nq} questions, ${Object.keys(R).length} sources.`);
