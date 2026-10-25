# 📚 Révisons

Site éducatif en français : leçons et exercices expliqués du **CI au CM2** (français, mathématiques, découverte du monde, développement durable) et section **Je découvre mon pays** (histoire et géographie du Sénégal).

- Gratuit, sans compte, utilisable hors ligne une fois la page chargée
- Quiz corrigés et expliqués, meilleur score gardé sur l'appareil
- Site statique servi par **Cloudflare Workers (static assets)**, déployé avec `wrangler deploy`

© SDF Technologie — Tous droits réservés.

## Structure

```
public/                 Site publié (servi tel quel)
  index.html            Application complète (HTML, CSS, JS et catalogue de leçons)
  404.html              Page d'erreur
  _headers              En-têtes de sécurité et de cache
  manifest.webmanifest  Installation sur l'écran d'accueil
  admin/index.html      Espace d'administration (/admin/)
  icon.svg, robots.txt
src/index.js            Worker : suivi anonyme des visites + API d'administration
migrations/             Schéma D1 de référence (le Worker crée aussi les tables lui-même)
check-content.mjs       Vérification du projet et du catalogue (commande « npm run build »)
wrangler.jsonc          Configuration Cloudflare Workers
.github/workflows/      Vérification automatique du contenu
```

## Prérequis

- [Node.js](https://nodejs.org) 20 ou plus récent
- Un compte [Cloudflare](https://dash.cloudflare.com) (gratuit) et un compte GitHub

## Utilisation en local

```bash
npm install
cp .dev.vars.example .dev.vars   # puis éditez les valeurs
npm run check     # valide les leçons et questions
npm run dev       # aperçu local (wrangler dev)
```

## Déploiement sur Cloudflare Workers (recommandé : Git → Workers Builds)

1. Envoyez le projet **complet** sur GitHub (branche `main`) — dossiers `public/`, `src/` et `migrations/` compris :
   ```bash
   git init && git add . && git commit -m "Première version de Révisons"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/revisons.git
   git push -u origin main
   ```
   Vérifiez ensuite sur la page GitHub du dépôt que ces dossiers apparaissent. Avec le bouton *Upload files* de GitHub, glissez les **dossiers** eux-mêmes ; un fichier `.zip` n'est pas décompressé par GitHub.
2. Dans Cloudflare : *Workers & Pages* → *Create* → **Import a repository** → choisissez le dépôt. Le nom du Worker doit être **`revisons`** (le même que `name` dans `wrangler.jsonc`).
3. Paramètres de build :

   | Paramètre | Valeur |
   |---|---|
   | Root directory | `/` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Branche de production | `main` |

   Le site est déjà dans le dossier `public/` (aucun framework) : `npm run build` vérifie que tous les fichiers sont présents et valide le catalogue de leçons, sans rien modifier. Si vous renommez le dossier du site, ajustez `assets.directory` dans `wrangler.jsonc`.
4. Enregistrez, puis lancez le build (**Retry build** ou un nouveau `git push`). Le site est publié sur `https://revisons.<votre-sous-domaine>.workers.dev`.
5. **Identifiants administrateur** — Worker `revisons` → *Settings* → *Variables and Secrets* → *Add*, type **Secret** :
   - `ADMIN_EMAIL` : l'e-mail de l'administrateur
   - `ADMIN_PASSWORD` : le mot de passe
   - `SESSION_SECRET` : une longue chaîne aléatoire (ex. `openssl rand -hex 32`)

   Choisissez bien le type *Secret* : les secrets survivent aux déploiements suivants. Sans eux, la page `/admin/` affiche « Configuration serveur incomplète ».

**Base de données D1.** Le binding `DB` est déclaré sans identifiant : Wrangler crée et relie automatiquement la base `revisons-db` au premier déploiement, et le Worker crée lui-même ses tables au premier appel (aucune migration à lancer). Si votre version de Wrangler ou votre compte ne le permet pas, créez la base à la main puis ajoutez son identifiant :
```bash
npx wrangler d1 create revisons-db   # copiez le database_id dans wrangler.jsonc ("database_id": "...")
```

### Déploiement en ligne de commande (alternative)

```bash
npx wrangler login
npm run deploy                         # build (validation) puis « wrangler deploy »
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Nom de domaine personnalisé : Worker `revisons` → *Settings* → *Domains & Routes* → *Add*.

Le workflow GitHub Actions (`.github/workflows/check.yml`) ne fait que vérifier le contenu à chaque `push` et chaque *pull request* ; c'est Cloudflare qui construit et déploie.

## Espace d'administration (`/admin/`)

Accessible à `https://<votre-site>/admin/` (lien « Administration » en bas de page du site) après connexion par e-mail et mot de passe.

- **Tableau de bord** : visites, visiteurs uniques, leçons ouvertes, quiz terminés, score moyen, leçons les plus ouvertes, répartition par classe, pays et appareil (24 h, 7, 30 ou 90 jours).
- **Journal de bord** : chaque visite, ouverture de leçon et quiz terminé, avec filtres, recherche, pagination et **export CSV**.
- **Contenu & site** : bandeau d'annonce, **mode maintenance**, masquage de leçons et modification de leurs textes **sans redéployer**.
- **Sécurité** : journal des connexions (réussies et échouées) et des modifications, purge des anciennes données.

**Sécurité :** authentification côté serveur, session signée (cookie `HttpOnly`, `Secure`, `SameSite=Strict`, 8 h), blocage après 5 échecs en 15 minutes, protection contre les requêtes intersites, comparaison en temps constant. Les identifiants sont des **secrets Cloudflare** : ne les écrivez jamais dans le code. Pour changer le mot de passe : `npx wrangler secret put ADMIN_PASSWORD`.

**Vie privée :** le site enregistre de façon anonyme les visites, ouvertures de leçon et scores de quiz (pays, type d'appareil, source). Aucun nom, aucune adresse IP : le visiteur est représenté par une empreinte aléatoire irréversible. Le texte d'information du site en fait mention. Utilisez la purge pour limiter la durée de conservation.

## Modifier le contenu

Les leçons sont dans `public/index.html`, dans la constante `LESSONS` ; les sources citées sont dans `REFS`. Chaque leçon contient : `id` (unique), `classe`, `matiere`, `rubrique`, `titre`, `objectif`, `texte`, `exemple`, `activite`, `source` et `questions`. Chaque question suit le format `[énoncé, [choix…], 0, explication]` : l'indice `0` désigne la bonne réponse (les choix sont mélangés à l'affichage).

Après chaque modification : `npm run check`.

## Qualité et limites

Les leçons sont des créations pédagogiques originales ; le classement par niveau est une proposition à faire valider par un enseignant. Le catalogue est partiel et ne remplace pas un programme homologué.
