# Contributing to Tasknest

Thank you for your interest in contributing to Tasknest! This document outlines the process for contributing code, documentation, translations, and bug reports.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). By participating, you agree to uphold this code. Please report unacceptable behaviour to `leonheu97@gmail.com`.

---

## Ways to contribute

- **Report a bug** — open an issue using the *Bug report* template
- **Suggest a feature** — open an issue using the *Feature request* template
- **Improve documentation** — open a PR fixing typos, clarifying examples, translating
- **Translate the UI** — add a new locale under `apps/web/i18n/messages` and `apps/mobile/i18n`
- **Submit code** — pick an open issue labelled `good first issue` or `help wanted`
- **Self-host & share feedback** — install Tasknest on your own server and tell us what works / what doesn't

---

## Development workflow

### 1. Fork and clone

```bash
gh repo fork LeonHEU-cesi/tasknest --clone
cd tasknest
git remote add upstream https://github.com/LeonHEU-cesi/tasknest.git
git checkout develop
```

### 2. Set up local environment

See [`Docs/claude/Tasknest/installation.md`](./Docs/claude/Tasknest/installation.md) for the full installation guide.

### 3. Create a feature branch

We use Git Flow with `develop` as the default branch.

```bash
git checkout develop
git pull upstream develop
git checkout -b feat/<short-scope>
```

Branch naming:

| Prefix | Purpose |
|---|---|
| `feat/<scope>` | New feature |
| `fix/<scope>` | Bug fix |
| `docs/<scope>` | Documentation only |
| `test/<scope>` | Tests only |
| `chore/<scope>` | Tooling, CI, dependencies |
| `refactor/<scope>` | Code restructure without behaviour change |

### 4. Code your change

- **Languages** — code, comments, commit messages and PR titles are written in **English**. User-facing UI is bilingual (FR + EN).
- **Type safety** — TypeScript `strict: true` is enforced. No `any` is implicit.
- **Linting** — `pnpm lint` must pass. Run `pnpm lint:fix` to autofix.
- **Formatting** — `pnpm format` runs Prettier on the whole repo.
- **Tests** — write unit (TU) and functional (TF) tests covering your change. See [`Docs/claude/Tasknest/Cahier_de_tests.md`](./Docs/claude/Tasknest/Cahier_de_tests.md) for nomenclature.

### 5. Commit your change

We follow [Conventional Commits](https://www.conventionalcommits.org/) with an explicit scope:

```
feat(api): add Google Calendar OAuth flow
fix(web): kanban drag&drop on Safari
docs: update MLD with audit_logs table
test(api): add TF-AU-* for magic link
chore(ci): bump Playwright to 1.50
```

Allowed scopes: `api`, `web`, `mobile`, `types`, `ui`, `config`, `ci`, `docs`.

### 6. Update the journal

Add an entry to `JOURNAL.md` (in French) at the top of the relevant sprint section:

```markdown
### Issue #NNN — [N.M] Title

Short paragraph (2-4 lines) about what was added.

- Technical detail 1
- Technical detail 2

Tests validated:
- Criterion 1
- Criterion 2

---
```

### 7. Open a pull request

```bash
git push origin feat/<scope>
gh pr create --base develop
```

Fill in the PR template completely. The CI must be green before review.

### 8. Review process

- Maintainers will review your PR (target: under 1 week, often faster)
- Address feedback by pushing new commits to the same branch
- Once approved, a maintainer will squash-merge into `develop`

---

## Coding standards

### General

- No `TODO` or placeholder code in committed files
- No magic numbers or strings — use named constants
- Comments explain the **why**, not the **what**. Add a reference to the User Story when relevant: `// US-AU-01`
- No secrets in source files — read from `.env`

### Backend (NestJS)

- One feature per module
- Use Prisma for all database access
- Validate every DTO with Zod (shared from `packages/types`)
- Errors thrown via `HttpException` subclasses, never raw `Error`
- All endpoints protected by `AuthGuard` unless explicitly public (`@Public()` decorator)

### Web (Next.js)

- App Router only (no `pages/`)
- Server Components by default, `'use client'` only when needed
- All UI strings via `next-intl`, no hardcoded English/French
- Reuse `packages/ui` components — don't duplicate

### Mobile (Expo)

- Expo Router file-based routing
- Offline-first using SQLite + outbox pattern
- i18n via `i18n-js` with system locale detection

### Tests

- Unit tests in `*.spec.ts` next to the file under test
- Feature tests in `apps/api/test/`
- E2E web in `apps/web/e2e/`
- E2E mobile in `apps/mobile/e2e/`
- Test data via factories, never hardcoded UUIDs

---

## What we won't accept

- Code generated entirely by AI without human review and adaptation (we expect contributors to understand and own their PRs)
- Drive-by translation dumps using machine translation only (run them through a native speaker first)
- New top-level dependencies without justification in the PR description
- Disabling tests or lint rules to make CI pass — fix the root cause
- Breaking changes without a clear migration path documented

---

## License

By contributing to Tasknest, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](./LICENSE).

---

## Questions?

Open a [GitHub Discussion](https://github.com/LeonHEU-cesi/tasknest/discussions) or reach out at `leonheu97@gmail.com`. We're happy to help newcomers.
