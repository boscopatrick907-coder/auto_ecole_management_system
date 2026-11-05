# Auto-École La Marseillaise (AEM) — Plateforme PWA & Gestion Administrative

Application Progressive Web App (PWA) **Offline-First & Mobile-First** conçue pour l'**Auto-École La Marseillaise (AEM)** au Cameroun.

---

## 🎨 Identité Visuelle Officielle (`AEM Clair — Bleu Marseillaise`)

L'interface adopte un thème clair haute-lisibilité inspiré de la charte officielle AEM et des standards d'ingénierie mobile (Apple Light UX / Emil Kowalski) :
- **Bleu Marseillaise Principal** : `#3D8BCD` (`#5BA4E5` clair, `#2B6CA8` foncé)
- **Corail-Vermillon Officiel** : `#D94E28`
- **Étoile Or AEM** : `#EAB308`
- **Toile Daylight Alabaster** : `#F4F7FB` avec cartes `#FFFFFF` et barres givrées (`backdrop-filter: blur(20px) saturate(180%)`)

---

## 🏗️ Architecture Technique (100% Free-Tier)

| Couche | Technologie | Rôle |
|---|---|---|
| **Base de données** | **Neon Serverless PostgreSQL 16** | RLS (`current_user_id()`), triggers d'essai 14j, reçus séquentiels sans trou (`LM-YYYY-NNNNNN`), journal d'audit financier inaltérable |
| **Backend API** | **Node.js + Express + TypeScript** | Authentification téléphone `+237` / OTP, jetons de bail hors-ligne signés (`HS256`), intégration WhatsApp Cloud API & liens 1-clic `wa.me` |
| **Frontend PWA** | **Angular 19 Standalone + Service Worker** | Cache hors-ligne (`@angular/service-worker`), base locale **Dexie.js (IndexedDB)**, garde d'horloge monotone anti-triche |
| **Exports & Reçus** | **jsPDF + SheetJS (`xlsx`)** | Génération instantanée de reçus officiels PDF A5 et export des listes d'élèves en Excel (`.xlsx`) et PDF A4 |

---

## ✨ Fonctionnalités Clés

### 1. Espace Élève (Mobile-First & Hors-Ligne)
- **Inscription en 30 secondes** avec numéro Cameroun (`+237`) et validation par code OTP à 6 chiffres.
- **Activation Code Agence (8 caractères)** pour les élèves inscrits physiquement au secrétariat.
- **14 jours d'essai gratuit automatiques** : accès immédiat aux cours d'aperçu et quiz d'évaluation.
- **Déblocage illimité automatique** dès le 1er versement enregistré par la caisse (`student_has_access()`).
- **Lecteur de Cours & Téléchargement Hors-Ligne** dans IndexedDB pour réviser sans forfait Internet.
- **Moteur de Quiz & Examens Blancs** chronométrés avec explications pédagogiques et synchronisation automatique des scores.
- **Suivi financier transparent** : barre de progression, échéancier des 3 tranches et téléchargement des reçus PDF.

### 2. Espace Direction & Caisse
- **Tableau de bord temps réel** : Encaissé ce mois, Encaissé aujourd'hui, Reste à recouvrer, Élèves en essai 14j, Élèves confirmés.
- **Liste d'actions prioritaires (« À traiter aujourd'hui »)** : relance WhatsApp en 1 clic (`wa.me`) avec message pré-rempli en FCFA ou encaissement direct.
- **Guichet d'encaissement en 3 clics (< 10 secondes)** : sélection de l'élève, montant (avec boutons rapides `15 000 F`, `25 000 F`, `30 000 F`, `50 000 F`), mode (`Espèces`, `Orange Money`, `MTN MoMo`), génération du reçu PDF et envoi WhatsApp.
- **Mode Caisse Hors-Ligne** : émission de reçus provisoires (`LM-D1-0001`) en cas de coupure Internet et réconciliation automatique au retour de la connexion.
- **Inaltérabilité comptable** : aucune suppression de paiement (`trg_payments_guard`) ; annulation possible uniquement avec motif obligatoire tracé dans `audit_log`.

---

## 🚀 Démarrage Rapide

### 1. Configuration de l'environnement
Copiez `.env.example` vers `.env` et renseignez votre URL **Neon PostgreSQL** :
```bash
cp .env.example .env
```

### 2. Initialisation de la base Neon & Données Cameroun
```bash
cd backend
npm install
npm run db:migrate
```

### 3. Lancement du serveur API Backend (Port 3000)
```bash
cd backend
npm run dev
```

### 4. Tests de Sécurité Automatisés (OWASP API Top 10)
```bash
cd backend
npm run test:security
```

### 5. Lancement / Build de la PWA Angular 19
```bash
cd frontend
npm install
npm start
# Ou pour compiler le build de production avec Service Worker PWA :
npm run build
```

---

## 🔐 Identifiants de Démonstration (Pré-initialisés)

- **Compte Super-Admin / Direction** :
  - **Téléphone** : `+237699000001` (ou `direction@lamarseillaise.cm`)
  - **Mot de passe** : `Admin@Marseillaise2026!`
  - *(Un bouton « Admin Démo » en 1 clic est également disponible sur l'écran de connexion).*
