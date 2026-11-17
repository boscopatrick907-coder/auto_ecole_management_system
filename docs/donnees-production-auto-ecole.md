# Cahier des Données de Production (Production Readiness)
## Plateforme de Gestion Multi-Tenant d'Auto-Écoles

**Projet :** Auto-École Management System (AEM)  
**Date :** Novembre 2026  
**Version :** 1.0 — Production Readiness Checklist  
**Conformité :** Ministère des Transports du Cameroun (MINT) & Normes OHADA  

---

### Introduction & Objectif

Ce document répertorie l'intégralité des données réelles indispensables à la mise en exploitation de la plateforme en environnement de production. Il sert de **cahier de collecte et de validation** auprès de la direction de l'auto-école et de l'équipe technique.

---

## 1. Données Administratives & Légales de l'Établissement (Tenant)

Ces informations identifient juridiquement l'auto-école sur la plateforme et sont reportées sur les quittances de paiement et l'interface candidat :

| Donnée | Type / Contrainte | Exemple concret | Statut |
| :--- | :--- | :--- | :---: |
| **Raison sociale / Nom commercial** | Texte (max 150 car.) | *Auto-école La Marseillaise* | [ ] |
| **Identifiant unique (Slug URL)** | Regex `^[a-z0-9][a-z0-9-]{1,62}$` | `la-marseillaise` | [ ] |
| **Numéro d'Agrément ministériel** | Numéro officiel délivré par le MINT | `AGR-MINTRANSPORT-2026-LM/048` | [ ] |
| **Numéro d'Identifiant Fiscal (NIU)** | Identifiant Unique Direction des Impôts | `M051812345678A` | [ ] |
| **Registre de Commerce (RCCM)** | Immatriculation au greffe du tribunal | `RC/YAO/2026/B/1042` | [ ] |
| **Préfixe des Reçus de Caisse** | 1 à 8 lettres majuscules/chiffres | `LM` (ex: `LM-2026-0001`) | [ ] |
| **Adresse physique officielle** | Siège et agences de formation | `Bastos, Rue 1.825, Yaoundé` | [ ] |
| **Téléphone d'appel officiel** | Format `+237[26]XXXXXXXX` | `+237 699 00 11 22` | [ ] |
| **Numéro WhatsApp Business** | Ligne support & relances candidats | `+237 677 33 44 55` | [ ] |
| **Adresse e-mail de contact** | Email de contact public | `contact@lamarseillaise.cm` | [ ] |
| **Couleurs de marque** | Codes HEX `#RRGGBB` | Primaire: `#1F4E8C` / Accent: `#F5A623` | [ ] |
| **Logo officiel haute définition** | Fichier vectoriel SVG ou PNG transparent | `logo_la_marseillaise.svg` | [ ] |

---

## 2. Catalogue des Permis & Sessions de Formation (Groupes)

Ces données structurent l'offre pédagogique et les conditions financières :

### A. Catégories de Permis Activées
- [ ] **Permis A :** Motocycles et tricycles à moteur.
- [ ] **Permis B :** Véhicules légers de tourisme (catégorie principale).
- [ ] **Permis C :** Véhicules poids lourds de transport de marchandises (> 3,5 tonnes).
- [ ] **Permis D :** Véhicules de transport en commun de personnes.

### B. Promotions Ouvertes à l'Enregistrement (`groups`)
Pour chaque groupe ouvert, préciser :
1. **Intitulé de la promotion :** *(ex. Promotion Décembre 2026 — Permis B Cours du Soir)*
2. **Catégorie de permis liée :** *(A, B, C ou D)*
3. **Capacité maximale d'accueil :** *(ex. 25 ou 30 candidats)*
4. **Date officielle de démarrage des cours :** *(Format AAAA-MM-JJ)*
5. **Planning et horaires :** *(ex. Lundi, Mercredi, Vendredi de 18h00 à 20h00)*
6. **Tarif global forfaitaire :** *(en FCFA / XAF, ex. 120 000 FCFA)*

### C. Échéancier de Paiement par Tranches (`installments`)
Découpage obligatoire des règlements par promotion :
- **1re Tranche (Inscription & Code) :** Montant (ex. 50 000 FCFA) — Échéance : à l'inscription.
- **2e Tranche (Début Conduite Pratique) :** Montant (ex. 40 000 FCFA) — Échéance : +30 jours.
- **3e Tranche (Solde avant présentation à l'examen) :** Montant (ex. 30 000 FCFA) — Échéance : +60 jours.

---

## 3. Matériel Pédagogique & Banques de Quiz d'Examen

Ce contenu permet l'apprentissage autonome et l'entraînement hors-ligne des élèves :

### A. Bibliothèque de Cours & Documentation (PDF)
- [ ] **Module 1 :** Signalisation routière (Panneaux de danger, interdiction, obligation, indication).
- [ ] **Module 2 :** Règles de circulation, priorités et carrefours à sens giratoire.
- [ ] **Module 3 :** Vitesses réglementaires, croisements, dépassements et arrêts/stationnements.
- [ ] **Module 4 :** Notions de sécurité routière, alcool, téléphone au volant et premiers secours.
- [ ] **Module 5 :** Notions élémentaires de mécanique automobile et contrôles journaliers.

### B. Banque de Questions d'Entraînement & Examens Blancs
- [ ] **Nombre de questions minimum :** 150 questions officielles conformes au Code de la Route de la zone CEMAC / Cameroun.
- [ ] **Structure de chaque question :**
  - Énoncé textuel précis.
  - Image de mise en situation (format 16:9 ou 4:3 optimisé pour mobile).
  - 2 à 4 propositions de réponse.
  - Identification de la bonne réponse.
  - Explication pédagogique optionnelle.
- [ ] **Paramétrage des examens blancs :**
  - Nombre de questions par test (ex. 40 questions).
  - Durée limite de l'épreuve (ex. 45 minutes).
  - Seuil d'admissibilité (ex. minimum 32/40 soit 80 %).

---

## 4. Données Candidats à Migrer (Roster Initial)

Fichier tabulaire (Excel / CSV) des étudiants déjà inscrits et en cours de scolarité :

| Champ requis | Format attendu | Exemple |
| :--- | :--- | :--- |
| **Nom et Prénom** | Nom d'état civil complet | `Mballa Noah Christian` |
| **Téléphone mobile** | Format camerounais `+2376XXXXXXXX` | `+237699445566` |
| **Adresse e-mail** | Email valide (authentification) | `christian.mballa@gmail.com` |
| **Catégorie de permis** | A, B, C ou D | `B` |
| **Groupe / Session** | Nom de la promotion rattachée | `Session Novembre — Soir` |
| **Date d'inscription** | Format AAAA-MM-JJ | `2026-11-02` |
| **Montant total payé à date** | En FCFA | `50 000` |
| **Solde restant dû** | En FCFA | `70 000` |
| **Référence dernier reçu physique** | Numéro de carnet à souche | `LM-2026-REC-0089` |

---

## 5. Personnel Administratif & Droits d'Accès (RBAC)

Identité des collaborateurs disposant d'un compte sur le portail :

### A. Direction & Administration Générale (`admin`)
- [ ] **Directeur d'agence :** Nom, téléphone, email professionnel (Droits : Validation financière, création des groupes, édition des paramètres).
- [ ] **Secrétaire / Caissier(ère) :** Nom, téléphone, email (Droits : Inscription des élèves, enregistrement et réimpression des reçus de caisse).

### B. Super-Administrateurs Techniques (`platform_admin`)
- [ ] **Administrateurs système :** Comptes d'exploitation technique pour la surveillance de la plateforme et l'audit multi-tenant.

---

## 6. Secrets d'Infrastructure & Production DevOps

Variables à configurer dans l'environnement Cloudflare Workers & Neon PostgreSQL :

| Clé de configuration | Rôle | Source d'obtention |
| :--- | :--- | :--- |
| `DATABASE_URL` | Accès PostgreSQL Neon de production (Pooler PgBouncer) | Console Neon (Branche `main`) |
| `AUTH_DATABASE_URL` | Accès PostgreSQL restreint au schéma `identity` | Rôle SQL dédié `identity_user` |
| `BETTER_AUTH_SECRET` | Clé secrète de signature des sessions web (64 car. hex) | Générateur cryptographique CSPRNG |
| `OFFLINE_PRIVATE_KEY_PEM` | Clé privée Ed25519 PKCS#8 pour baux hors-ligne (72h) | Commande `crypto.generateKeyPairSync` |
| `TURNSTILE_SITE_KEY` | Clé publique antirobot Cloudflare Turnstile | Dashboard Cloudflare (Zone du domaine) |
| `TURNSTILE_SECRET_KEY` | Clé secrète antirobot Cloudflare Turnstile | Dashboard Cloudflare |
| `R2_ACCOUNT_ID` | Identifiant de compte Cloudflare R2 | Dashboard Cloudflare |
| `R2_ACCESS_KEY_ID` | Clé d'accès API R2 (Stockage PDF et Images) | Gestion des tokens R2 |
| `R2_SECRET_ACCESS_KEY` | Secret d'API Cloudflare R2 | Gestion des tokens R2 |
| `R2_BUCKET_NAME` | Nom du compartiment de stockage privé | Ex. : `aem-prod-media` |
| `TRUSTED_ORIGINS` | Origines HTTPS autorisées (CORS) | Ex. : `https://auto-ecole.cm` |
| `AUTH_EMAIL_WEBHOOK` | Endpoint webhook d'envoi d'e-mails transactionnels | Fournisseur SMTP (Resend, Brevo) |
| `AUTH_EMAIL_TOKEN` | Jeton d'autorisation du service email | Fournisseur SMTP |

---

## 7. Modalités de Règlement & Comptes d'Encaissement

Paramétrage des canaux de paiement acceptés pour la trésorerie de l'auto-école :

- [ ] **Espèces en caisse :** Enregistrement direct au guichet avec quittance horodatée.
- [ ] **Orange Money Cameroun :** Compte marchand ou numéro de compte professionnel habilité.
- [ ] **MTN Mobile Money Cameroun :** Compte Marchand / MoMo Pay officiel.
- [ ] **Virement / Versement Bancaire :** Coordonnées bancaires (RIB, Banque, IBAN local).
