# Journal de bord — Tasknest

> Journal narratif du projet, organisé par sprint puis par issue.
> Format : H2 = Sprint, H3 = Issue, séparateur `---` entre issues, **sans date** (l'historique git fait foi).

## Sprint 0 — Foundations

### Issue #1 — [0.1] Init monorepo (pnpm + Turborepo + workspaces)

Création de la structure monorepo initiale avec pnpm workspaces et Turborepo.

- Fichiers : `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Workspaces déclarés : `apps/*`, `packages/*`
- Build incrémental Turborepo configuré (cache local + futur cache distant)
- Scripts root : `dev`, `build`, `test`, `lint`, `typecheck`, `clean`

Tests validés :
- `pnpm install` fonctionne sans erreur depuis la racine
- `pnpm -r --workspace-concurrency=1 list` énumère les packages
