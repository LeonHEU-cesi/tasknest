# Tasknest — Brief de synthèse

> Side project perso ambitieux : gestionnaire de tâches multi-listes/groupes avec sync agendas mobiles natifs, voué à devenir open source self-hosted.

---

## 🟦 Le projet

- **Nom** : Tasknest
- **Description** : Gestionnaire de tâches permettant de gérer des to-do lists avec paramétrage pour synchronisation directe avec les agendas (Google Calendar, Outlook/Microsoft 365, Apple Calendar, Samsung/Android natif). Utilisable en ligne et hors ligne. Inspiré de Notion et ClickUp dans l'organisation hiérarchique projet > liste > tâche > sous-tâche.
- **Contexte** : Side project perso, voué à devenir un projet **open source self-hosted** publié sur GitHub.
- **But principal** : Pouvoir s'organiser via des listes de tâches et groupes de tâches, avec validation ou report, et synchronisation native avec l'agenda mobile principal de l'utilisateur.
- **Objectifs secondaires** :
  - Sync bidirectionnelle online (Google, Microsoft) et locale via CalDAV/.ics
  - Fonctionnement online + offline sur mobile
  - Concept Notion/ClickUp-like (hiérarchie + vues multiples)
- **Inspirations produit** : Notion, ClickUp
- **Référence externe officielle** : aucune

---

## 🟩 Les utilisateurs

| Acteur | Droits |
|---|---|
| Utilisateurs connectés multiples | Signup public ouvert, CRUD complet sur leurs données, partage opt-in |
| Visiteur anonyme | Mode démo lecture seule (ou local-storage sans compte) |
| Administrateur | Modération comptes, supervision, audit |

- **Public cible** : grand public **international** — i18n **FR + EN** minimum dès le départ
- **Accessibilité** : **WCAG AA**

---

## 🟨 Les fonctionnalités (tout MVP)

### Vues
- Liste classique (to-do épurée)
- Kanban par statut (drag & drop)
- Calendrier (mois / semaine / jour)
- Timeline / Gantt

### Sync agendas
- Google Calendar (OAuth + API v3)
- Outlook / Microsoft 365 (OAuth + Microsoft Graph)
- Apple Calendar (CalDAV iCloud)
- Samsung + Android natif (via Google Calendar API + URL d'abonnement .ics)
- Export .ics universel (auto-inclus)

### Modules
- Sous-tâches + groupes / projets (hiérarchie Notion-like)
- Tags, priorités, étiquettes
- Récurrence + rappels / notifications push (web + mobile)
- Partage / collaboration multi-utilisateurs

### Backlog
- User Stories US-XX-NN rédigées intégralement par Claude

### Hors périmètre v1
- **Aucun** — tout est dans le MVP, architecture pensée scalable dès le départ

---

## 🟧 La technique

| Élément | Décision |
|---|---|
| Surfaces clients | API + Web (PWA installable) + App native iOS + App native Android |
| Style API | REST + OpenAPI / Swagger |
| Pattern archi | Monolithe modulaire + workers dédiés (sync, notifs, récurrence) |
| BDD | PostgreSQL 16 avec RLS multi-tenant |
| Auth | Email/pwd + OAuth2 (Google/Microsoft/Apple) + Magic link/OTP + **2FA TOTP obligatoire** |
| Hébergement | Serveur **Proxmox** auto-hébergé (perso, UE) |

### Stack recommandée — TypeScript end-to-end

| Couche | Techno | Version cible |
|---|---|---|
| Back API | NestJS + Prisma | NestJS 11, Prisma 6 |
| Base de données | PostgreSQL | 16 |
| Cache / Queue | Redis + BullMQ | Redis 7, BullMQ 5 |
| Web | Next.js (App Router) + Tailwind v4 + shadcn/ui + next-intl + next-pwa | Next 16 |
| Mobile | Expo + Expo Router + Reanimated | Expo SDK 53+ |
| Authentification | Better Auth | latest stable |
| Tests | Vitest + Playwright + Detox + k6 + Chromatic | latest |
| Reverse proxy | Traefik 3 + Let's Encrypt | 3.x |
| Containers | Docker Compose | latest |
| Monorepo | pnpm workspaces + Turborepo | pnpm 9+, Turbo 2 |
| License | AGPL-3.0 | — |

### Structure monorepo

```
tasknest/
├── apps/
│   ├── api/                  NestJS — modules auth, tasks, sync, notifs, sharing, admin
│   ├── web/                  Next.js PWA — UI bilingue FR/EN
│   └── mobile/               Expo iOS + Android
├── packages/
│   ├── types/                DTOs partagés (Zod schemas)
│   ├── ui/                   Tokens design + composants partagés web
│   └── config/               eslint / tsconfig / prettier
├── docs/                     MLD, install, etc.
├── .github/
│   ├── workflows/ci.yml
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── LICENSE                   AGPL-3.0
├── JOURNAL.md
└── README.md
```

---

## 🟪 Les contraintes

| Domaine | Décision |
|---|---|
| Délai global | 6 à 12 mois pour la v1 |
| Cadence sprint | Scrum 2 semaines (~12 à 24 sprints) |
| Budget | non applicable (auto-hébergement + open source) |
| RGPD | Hébergement UE, droit à l'oubli (export + suppression), consentement cookies, privacy policy + CGU |
| Sécurité | HTTPS + HSTS preload, argon2id + rate limit Redis, chiffrement symétrique des tokens OAuth, audit logs structurés |
| Accessibilité | WCAG AA |
| Compatibilité | Chrome/Edge/Firefox/Safari 2 dernières majors, iOS 15+, Android 10+ |

---

## 🟫 Les tests

| Type | ID | Outil |
|---|---|---|
| Unitaires | TU-* | Vitest |
| Fonctionnels API | TF-* | Vitest + Supertest sur Postgres réel |
| Non-régression | TNR-* | Sous-ensemble TU+TF rejoué en CI |
| E2E web | TF-WEB-* | Playwright |
| E2E mobile | TM-* | Detox |
| Sécurité | TS-* | Tests automatisés (rate limit, IDOR, JWT, injection) + ZAP scan |
| Performance | TP-* | k6 / Artillery sur endpoints critiques + workers sync |
| Visual regression | TV-* | Chromatic |

**CI/CD** : GitHub Actions, jobs parallèles par surface client, `concurrency` group pour annuler runs précédents.

---

## ⬜ Validation & release

- **DoD** par sprint (checklist DoD cochée en fin de sprint)
- **PV recette** : modèle léger conservé pour traçabilité historique
- **Release** : open source self-hosted à terme
- **License envisagée** : **AGPL-3.0** (copyleft fort, empêche les forks SaaS fermés)

---

## 🔧 Mode de travail

- **Autonomie** : Auto + décisions techniques déléguées
- **Langue** :
  - Bundle `Docs/` en **français**
  - Code, commentaires, commits, PRs en **anglais**
  - UI **bilingue FR/EN** (next-intl)
  - JOURNAL.md en français
- **Récap par sprint** : `Docs/claude/Tasknest/sprints/sprintN-<titre>.md`

### Conventions strictes (rappel méthodologie Léon × Claude)

- **Aucune signature IA** : pas de `Co-Authored-By: Claude`, "Generated with Claude", emoji robot. Pas de fichier `CLAUDE.md` / `AGENTS.md` / `.cursor*` / `.aiderrules` dans le repo (suppression auto si scaffold).
- **JOURNAL.md** : H1 titre / H2 Sprint / H3 Issue, séparateur `---` entre issues, **sans date**.
- **Default branch** : `develop` (PR feature → develop ; PR récap develop → main en fin de sprint).
- **Auto-delete branches** activé.
- **Conventional Commits** avec scope explicite : `feat(api):`, `fix(web):`, `test(api):`, etc.

---

## 🚀 Setup GitHub

| Paramètre | Valeur |
|---|---|
| Compte / org | `LeonHEU-cesi` |
| Repo | `tasknest` |
| Visibility | public dès création |
| Default branch | `develop` |
| Auto-delete branches | activé |
| OS de travail | Windows 11 (PowerShell + Git Bash) |
| IDE | VS Code (config `.vscode/` adaptée TS/ESLint/Prettier/Tailwind) |

### Setup automatique prévu

- **Milestones** : 1 par sprint (M0 à MN)
- **Labels** :
  - `sprint-0`, …, `sprint-N`
  - `scope-api`, `scope-web`, `scope-mobile`, `scope-docs`, `scope-tests`
  - `module-auth`, `module-tasks`, `module-sync`, `module-notifs`, `module-sharing`, `module-admin`, `module-i18n`
  - `priorite-p1` (Must) à `priorite-p4` (Won't) — MoSCoW
  - `type-feat`, `type-fix`, `type-docs`, `type-test`, `type-chore`, `type-refactor`
  - `regression`, `security`
- **Issues** pré-créées (1 par tâche), labellisées + milestone + assignées à `LeonHEU-cesi`
- **Project Board v2** : champs custom `Sprint`, `Priority` (P0/P1/P2), `Size` (XS/S/M/L/XL), `Estimate (h)`, `Start date`, `Target date`
- **Vues Project** : Backlog (Board), Sprint Board (Board grouped by Sprint), Roadmap (Gantt), My items (Table filtered)

---

## 📦 Livrables `Docs/claude/Tasknest/`

| # | Fichier | Contenu |
|---|---|---|
| 1 | `Plan_developpement.md` | Périmètre, stack, archi, conventions, processus |
| 2 | `Planning_Scrum.md` | Gantt, sprints, cérémonies, risques, métriques |
| 3 | `User_stories.md` | Backlog complet US-XX-NN avec critères d'acceptation |
| 4 | `Cahier_de_tests.md` | Plan de tests (TU/TF/TNR/E2E/TS/TP/TV) par module |
| 5 | `mld.md` | Modèle Logique de Données (DBML + DDL Postgres) |
| 6 | `comparatif-techniques.md` | 3 archis × 5 critères avec scoring |
| 7 | `pertinence-solution.md` | Argumentation du choix stack et architecture |
| 8 | `installation.md` | Guide d'installation dev + prod + troubleshooting |
| 9 | `procedure-validation.md` | Procédure de recette (par sprint et globale) |
| 10 | `pv-recette.md` | Modèle vierge de PV (allégé side project) |
| 11 | `dossier_final.md` | Synthèse projet (vision, archi, métriques, retours) |

---

## ⏭️ Prochaines étapes

1. Génération bundle de docs `Docs/claude/Tasknest/` (en cours)
2. Proposition plan de sprints découpé en 12-24 itérations
3. **Validation explicite du plan de sprints** avant bootstrap
4. Bootstrap repo Git + GitHub setup (milestones, labels, issues, Project Board)
5. Démarrage Sprint 0 (init monorepo, Docker Compose, CI baseline)
