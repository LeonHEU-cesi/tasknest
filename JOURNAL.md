# Journal de bord — Tasknest

> Journal narratif du projet, organisé par sprint puis par issue.
> Format : H2 = Sprint, H3 = Issue, séparateur `---` entre issues, **sans date** (l'historique git fait foi).

## Sprint 0 — Foundations

### Issue #1 — [0.1] Init monorepo (pnpm + Turborepo + workspaces)

Finalisation de la structure monorepo avec un `package.json` pour chacun des six workspaces déclarés. Les scaffoldings applicatifs détaillés (NestJS, Next.js, Expo) sont délégués aux issues #3, #4 et #5 — cette issue se concentre sur la mécanique workspaces + Turbo.

- 6 workspaces nommés : `@tasknest/api`, `@tasknest/web`, `@tasknest/mobile`, `@tasknest/types`, `@tasknest/ui`, `@tasknest/config`
- Scripts placeholders couvrant toutes les cibles référencées dans les workflows CI (`lint`, `typecheck`, `test`, `test:unit`, `build`, `prisma:migrate:deploy`, etc.) — ils émettent un message et exit 0 pour ne pas bloquer la CI tant que le vrai code n'est pas posé
- Suppression des six `.gitkeep` désormais inutiles
- `package.json` racine + `pnpm-workspace.yaml` + `turbo.json` déjà posés au commit initial — pas de modification ici

Tests validés :
- Structure des workspaces conforme à `Plan_developpement.md` §4
- Tous les scripts référencés dans `.github/workflows/ci-*.yml` existent dans les `package.json` ciblés (CI peut s'exécuter sans `script not found`)
- `pnpm install` à exécuter en local au premier setup — le lockfile sera commit dans l'issue suivante du Sprint 0

---

### Issue #2 — [0.2] Setup Docker Compose dev (Postgres, Redis, Mailpit, MinIO)

Le `docker-compose.yml` dev a été posé au commit initial (Postgres 16, Redis 7, Mailpit pour les e-mails et MinIO pour le stockage objet S3-compatible). Cette issue ajoute le pendant **production** déployable sur le Proxmox perso.

- `docker-compose.prod.yml` : services `traefik`, `postgres`, `redis`, `api`, `worker`, `web` reliés via un réseau dédié `tasknest`
- Traefik 3 en reverse proxy avec redirection HTTP→HTTPS automatique et résolveur ACME Let's Encrypt (challenge HTTP-01)
- Images `api`/`web` pointées sur GHCR (`ghcr.io/leonheu-cesi/tasknest-{api,web}`) — l'image sera publiée à partir de l'issue #6 (workflow `release`)
- `traefik/traefik.yml` : configuration minimale (dashboard activé en mode sécurisé, fournisseur Docker, ACME)
- `.env.example` complété avec `DOMAIN` et `TASKNEST_VERSION` (utilisés en prod uniquement)
- `traefik/letsencrypt/` ajouté au `.gitignore` (certificats jamais commités)

Tests validés :
- `docker compose -f docker-compose.yml config` valide la configuration dev (services + volumes + healthchecks)
- `docker compose -f docker-compose.prod.yml config` valide la configuration prod (labels Traefik + dépendances saines)

---

### Issue #3 — [0.3] Scaffolding NestJS in apps/api with Health module

Première application réelle du monorepo : un back-end NestJS 11 minimaliste, mais déjà fonctionnel de bout en bout (boot → endpoint → tests verts). Sert de patron pour les apps `web` et `mobile` (issues #4 et #5).

- `apps/api/src/main.ts` : bootstrap NestJS, `ConfigModule` global, préfixe global `/api/v1`, lecture du port via `API_PORT` (défaut `4000`)
- `apps/api/src/app.module.ts` : module racine, importe `ConfigModule` (lit `.env` et `../../.env`) et `HealthModule`
- `apps/api/src/modules/health/health.controller.ts` : `GET /api/v1/health` renvoie `{ status: 'ok', service: '@tasknest/api', version: '...' }`
- `apps/api/tsconfig.json` étend `tsconfig.base.json` racine (decorators + emitDecoratorMetadata) ; `tsconfig.build.json` pour la compilation prod
- `apps/api/nest-cli.json` pour les commandes `nest start --watch` / `nest build`
- `apps/api/eslint.config.mjs` ESLint flat config v9 + `typescript-eslint` 8
- `apps/api/vitest.config.ts` : `include` `**/*.spec.ts` et `**/*.e2e-spec.ts`, env Node, couverture v8
- `apps/api/src/modules/health/health.controller.spec.ts` : test unitaire du controller
- `apps/api/test/health.e2e-spec.ts` : test e2e via `@nestjs/testing` + `supertest` (boot complet + HTTP)
- `apps/api/package.json` mis à jour : dépendances NestJS 11 + Vitest + ESLint 9 ; scripts `dev`, `start`, `build`, `test`, `test:unit`, `test:e2e`, `lint`, `typecheck` réellement opérationnels

Tests validés :
- `pnpm install` (10.7 s, 0 conflit)
- `pnpm --filter @tasknest/api typecheck` (succès)
- `pnpm --filter @tasknest/api lint` (0 erreur, 0 warning)
- `pnpm --filter @tasknest/api test:unit` (1 test, passé en 2 ms)
- `pnpm --filter @tasknest/api test:e2e` (1 test, passé en 249 ms — `GET /api/v1/health` répond `200`)
- `pnpm --filter @tasknest/api build` (sortie `dist/` propre)

---

### Issue #4 — [0.4] Scaffolding Next.js in apps/web with homepage

Front-end web minimaliste reposant sur Next.js 15 (App Router) + React 19. Sprint 0 se contente d'une page d'accueil statique pour valider la pipeline build/test ; la vraie UI Tailwind + shadcn arrive à partir du sprint 7.

- `apps/web/next.config.mjs` : `reactStrictMode`, `poweredByHeader: false`, `experimental.typedRoutes` activé
- `apps/web/src/app/layout.tsx` : layout racine avec `<Metadata>` (titre, description)
- `apps/web/src/app/page.tsx` : page d'accueil statique présentant le pitch
- `apps/web/src/app/globals.css` : styles minimaux (color-scheme + reset léger)
- `apps/web/tsconfig.json` étend `tsconfig.base.json` racine, ajoute le plugin Next et l'alias `@/*` vers `src/`
- `apps/web/eslint.config.mjs` flat config ESLint 9 + `typescript-eslint` 8 (plugin Next à ajouter quand on aura les règles spécifiques utiles)
- `apps/web/vitest.config.ts` configuration Vitest dédiée web (env Node, couverture v8)
- `apps/web/src/lib/format.ts` + `format.spec.ts` : utilitaire `greet` + tests pour prouver que la pipeline test:unit est fonctionnelle
- `apps/web/package.json` : dépendances Next 15 + React 19 + scripts opérationnels

Tests validés :
- `pnpm install` (9.8 s, 17 packages ajoutés, dont sharp précompilé)
- `pnpm --filter @tasknest/web typecheck` (succès)
- `pnpm --filter @tasknest/web lint` (0 erreur, 0 warning sur les sources)
- `pnpm --filter @tasknest/web test:unit` (2 tests, 2 ms)
- `pnpm --filter @tasknest/web build` (compilation réussie en 5.8 s, premier-load JS partagé à 102 kB, route `/` rendue en statique)
- Warning Next « ESLint plugin not detected » non bloquant — sera résolu dans un sprint ultérieur via `eslint-config-next`

---

### Issue #5 — [0.5] Scaffolding Expo in apps/mobile with login screen stub

Application mobile minimaliste basée sur Expo SDK 53 + Expo Router 5 + React Native 0.80 + React 19. Sprint 0 pose juste l'écran d'accueil ; les écrans `(auth)` et `(tabs)` arrivent à partir du sprint 1.

- `apps/mobile/app.json` : configuration Expo (`slug=tasknest`, scheme `tasknest`, `newArchEnabled`, plugin `expo-router`, plateformes iOS + Android, `experiments.typedRoutes`)
- `apps/mobile/app/_layout.tsx` : `Stack` Expo Router racine (sans header) + `StatusBar` Expo
- `apps/mobile/app/index.tsx` : écran d'accueil natif (View + Text + StyleSheet) avec le pitch produit
- `apps/mobile/tsconfig.json` étend `tsconfig.base.json` racine, ajoute `jsx: react-jsx` + alias `@/*` vers `src/`
- `apps/mobile/eslint.config.mjs` flat config ESLint 9 + `typescript-eslint` 8 + globals RN (`__DEV__`, etc.)
- `apps/mobile/vitest.config.ts` env Node (les tests UI viendront avec `@testing-library/react-native` plus tard)
- `apps/mobile/src/lib/format.ts` + `format.spec.ts` : utilitaire `greet` pour valider la pipeline test
- `apps/mobile/package.json` : dépendances Expo 53 + `expo-router` 5 + `react-native` 0.80 + scripts opérationnels (`expo start`, `lint`, `typecheck`, `test:unit`)

Tests validés :
- `pnpm install` (17.4 s, 517 packages — un warning peer-dep `react@^19.1.0` attendu vs `19.0.0` installé, non bloquant)
- `pnpm --filter @tasknest/mobile typecheck` (succès)
- `pnpm --filter @tasknest/mobile lint` (0 erreur, 0 warning)
- `pnpm --filter @tasknest/mobile test:unit` (2 tests, 2 ms)
- Pas de `expo start` lancé : nécessite un device ou émulateur ; le workflow CI exécute `expo-doctor` en `continue-on-error` (suffisant pour valider le scaffold)
