# Auto-École — plateforme multi-écoles (PWA)

Application web progressive **hors-ligne et mobile d'abord** pour auto-écoles au Cameroun, conçue d'abord pour l'**Auto-École La Marseillaise**. Un seul déploiement sert plusieurs écoles ; chaque école a ses propres élèves, paiements, reçus et contenus, isolés au niveau de la base de données.

> **Statut (novembre 2026) :** fondation multi-écoles implémentée et testée localement. Intégration sur l'infrastructure réelle (Neon, Cloudflare, R2) et préparation du pilote en cours — **pas encore prête pour la production**. Voir [feuille de route et critères de mise en production](docs/handoffs/ROADMAP_AND_RELEASE_GATES.md).

## Architecture

| Couche | Technologie | Rôle |
|---|---|---|
| Frontend | Angular 22 (standalone, signals), service worker, Dexie (IndexedDB) | Interface élève et direction, cache hors-ligne, file d'attente d'actions hors-ligne |
| API | Cloudflare Worker, Hono, Better Auth — `backend/src/tenant/worker.ts` | Connexion email/mot de passe, routes `/api/schools/<école>/…`, baux hors-ligne signés Ed25519 |
| Base de données | Neon PostgreSQL — `backend/migrations/001_multitenant.sql` | Isolation par école (RLS), compteurs de reçus sans trou, journal d'audit, paiements non supprimables |
| Fichiers | Cloudflare R2 privé | Supports de cours ; URLs signées de courte durée |

Les URLs de l'application commencent par `/s/<slug-de-l-école>` (ex. `/s/la-marseillaise/connexion`).

> L'ancien serveur Express mono-école (`backend/src/app.ts`, `backend/src/routes/*`) est conservé uniquement pour la migration des anciennes données. **Il n'est pas l'API du frontend actuel.**

## Fonctionnalités

- **Comptes élèves à l'accueil :** l'école inscrit l'élève (nom, téléphone, groupe) et lui remet un code de 6 chiffres (`482 913`, valable 7 jours, envoyable par WhatsApp). L'élève ouvre « J'ai un code », saisit téléphone + code + mot de passe (8 caractères minimum), puis se connecte ensuite avec **téléphone + mot de passe**, sans email. Mot de passe oublié : l'accueil génère un nouveau code (valable 2 jours) depuis la fiche de l'élève. Après 5 échecs, le numéro est bloqué 15 minutes. Le personnel se connecte par email.
- **Équipe (administrateurs) :** depuis le tableau de bord → « Équipe », un administrateur ajoute un collègue (nom + email → code de 6 chiffres valable 7 jours) ou retire un accès. La personne ouvre « J’ai un code » → « Je fais partie de l’équipe » et saisit email + code + mot de passe (compte existant : mot de passe actuel). Impossible de se retirer soi-même ; chaque ajout/retrait est tracé dans le journal d’audit. Plus besoin d’un développeur pour créer un administrateur.
- **Élèves :** inscription en ligne possible, essai gratuit de 14 jours, accès débloqué dès un paiement valide, cours et quiz disponibles hors-ligne, suivi du solde et des reçus.
- **Direction / caisse :** tableau de bord, élèves, groupes, encaissements avec reçu PDF, annulation motivée (jamais de suppression), journal du jour et rapport mensuel, relances WhatsApp manuelles (`wa.me`).
- **Contenus :** catégories de permis, supports privés (PDF, images, MP4 ≤ 25 Mo) et quiz, avec brouillon, aperçu et publication.
- **Hors-ligne :** reçus provisoires `RC-<appareil>-<n>` confirmés au retour du réseau ; un refus du serveur n'est jamais compté comme un paiement.

Hors périmètre du lancement : envoi automatique WhatsApp/SMS, paiement en ligne, moniteurs/planning, facturation SaaS. La connexion par OTP SMS n'est pas implémentée.

## Pages publiques et référencement (SEO)

- **Accueil `/`** : liste des auto-écoles partenaires avec recherche par nom (personne ne tape de code technique). L'école ouverte en dernier sur l'appareil est proposée en premier (« Continuer avec … »).
- **Page d'une école `/s/<école>`** : nom, adresse, formations et tarifs, boutons S'inscrire / Connexion / J'ai un code / WhatsApp.
- Le Worker génère côté serveur, pour ces pages : titre, description, aperçu WhatsApp/Facebook (`og:*`, image `og-default.png` ou logo https de l'école), données `DrivingSchool` (schema.org), `robots.txt` et `sitemap.xml`. Les pages privées (tableau de bord, paiements, fiche élève…) sont servies telles quelles avec `X-Robots-Tag: noindex` ; les pages de connexion aussi.
- **Seule la production est indexée** (`ENVIRONMENT = "production"`) : en staging et en local, `robots.txt` interdit tout et chaque page publique porte `noindex` (données de test). Les aperçus WhatsApp/Facebook restent actifs partout.
- **Une école n'apparaît dans la liste publique et le sitemap que si `schools.listed = true`** (désactivé par défaut ; `tenant:bootstrap` l'active sauf `SCHOOL_LISTED=false`). Une école non listée reste accessible par son lien direct, sans être indexée.
- Ces pages nécessitent le déploiement **même origine** (Worker + fichiers Angular, binding `ASSETS`, voir `wrangler.staging.toml`). En local : `SERVE_FRONTEND=1 npm run dev:tenant:node` après `npm run build --prefix frontend`, puis `http://localhost:8788/` (ajouter `http://localhost:8788` à `TRUSTED_ORIGINS`).
- Le plus important pour être trouvé localement reste la **fiche Google Business Profile** de chaque école, avec un lien vers sa page `/s/<école>`.

## Démarrage local

Prérequis : Node 24, npm, PostgreSQL 16+.

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

1. **Base de données jetable** — créez une base locale, puis appliquez le schéma avec un compte propriétaire :
   ```bash
   MIGRATION_DATABASE_URL=postgresql://postgres:<mdp>@127.0.0.1:5432/aemdev npm run db:migrate:tenant --prefix backend
   ```
2. **Deux comptes restreints** (jamais superuser ni propriétaire des tables) :
   ```sql
   create role dev_app login password '<mdp-app>';  grant aem_tenant_runtime  to dev_app;
   create role dev_id  login password '<mdp-id>';   grant aem_identity_runtime to dev_id;
   ```
3. **Configuration** — copiez `backend/.dev.vars.example` vers `backend/.dev.vars` et renseignez `DATABASE_URL` (dev_app), `AUTH_DATABASE_URL` (dev_id), `BETTER_AUTH_SECRET` (aléatoire), `BETTER_AUTH_URL=http://localhost:8788`, `TRUSTED_ORIGINS=http://localhost:4200`, `ENVIRONMENT=development` et une clé privée Ed25519 PKCS#8 dans `OFFLINE_PRIVATE_KEY_PEM`. R2 et Turnstile peuvent rester vides en local (pas d'envoi de fichiers ni d'inscription publique).
4. **Première école et son administrateur** (mot de passe ≥ 12 caractères, à choisir vous-même) :
   ```bash
   MIGRATION_DATABASE_URL=… AUTH_DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:8788 \
   TRUSTED_ORIGINS=http://localhost:4200 SCHOOL_NAME="Auto-École La Marseillaise" SCHOOL_SLUG=la-marseillaise \
   ADMIN_EMAIL=admin@example.cm ADMIN_PASSWORD='<mot de passe fort>' npm run tenant:bootstrap --prefix backend
   ```
5. **Lancer** l'API puis l'interface, et ouvrez `http://localhost:4200/s/la-marseillaise/connexion` :
   ```bash
   npm run dev:tenant:node --prefix backend
   ```
   ```bash
   npm start --prefix frontend
   ```

Ouvrez bien `localhost` et non `127.0.0.1` : la connexion n'est acceptée que depuis les adresses listées dans `TRUSTED_ORIGINS`.

## Dépannage de la connexion

L'écran de connexion affiche la cause exacte :

| Message | Cause | Correction |
|---|---|---|
| « Email ou mot de passe incorrect. » | Identifiants erronés | Vérifier ou réinitialiser le mot de passe |
| « Numéro ou mot de passe incorrect. » | Élève : téléphone ou mot de passe erroné | Vérifier le numéro ; sinon nouveau code depuis la fiche élève |
| « Code ou numéro incorrect, déjà utilisé ou expiré. » | Code d'accueil invalide | Générer un nouveau code depuis la fiche élève |
| « Trop d'essais pour ce numéro… » | 5 échecs pour ce numéro | Attendre 15 minutes ou donner un nouveau code |
| « Connexion refusée… adresse non autorisée » | L'adresse du navigateur n'est pas dans `TRUSTED_ORIGINS` / `BETTER_AUTH_URL` | Mettre l'adresse exacte (en `https://` hors local) |
| « Ce compte n'est pas encore rattaché à cette école » | Compte sans adhésion à l'école | Rattacher via `backend/src/tenant/link-admin.ts` |
| « Impossible de joindre le serveur » | API arrêtée ou injoignable | Démarrer / vérifier le Worker |

## Tests

```bash
npm run lint --prefix frontend && npm test --prefix frontend
```
```bash
npm run test:e2e --prefix frontend
```
```bash
npm run build --prefix backend && npm run build:worker --prefix backend
```
```bash
npm run test:tenant --prefix backend
```

`test:tenant` exige une base PostgreSQL locale jetable (`TENANT_TEST_DATABASE_URL`, par défaut `127.0.0.1:55436`) et refuse tout hôte distant. Ne lancez jamais les tests sur une base d'école.

## Production

Frontend et Worker sont servis sur la **même origine HTTPS** (`/api/*` routé vers le Worker) pour que les cookies de session fonctionnent. Secrets via `wrangler secret put`. Pour des temps de réponse corrects :

- **Hyperdrive** pour `APP_DB` et `AUTH_DB` (connexions réutilisées, voir `backend/wrangler.toml`) ;
- **Smart Placement** activé (le Worker s'exécute près de la base) ;
- base Neon en **`aws-eu-central-1`** (Francfort), la région la plus proche du Cameroun. Sur l'offre gratuite, Neon se met en veille après 5 minutes : la première requête suivante prend 1 à 3 s de plus.

Détails : [mise en place](docs/FRONTEND_SETUP.md) · [staging](docs/STAGING_DEPLOYMENT.md) · [migration des anciennes données](docs/MULTITENANT_MIGRATION.md) · [sauvegarde/restauration](docs/BACKUP_RESTORE.md) · [contrat d'API](docs/TENANT_API_CONTRACT.md) · [portail de contenus](docs/CONTENT_PORTAL_VALIDATION.md) · [répartition des tâches](docs/handoffs/README.md).

## Identité visuelle

Bleu Marseillaise `#3D8BCD` (clair `#5BA4E5`, foncé `#2B6CA8`), corail `#D94E28`, or `#EAB308`, fond `#F4F7FB` avec cartes blanches. Maquettes dans `stitch-designs/`.
