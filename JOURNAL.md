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
