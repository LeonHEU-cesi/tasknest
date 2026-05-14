# Tasknest

> Plan your tasks. Sync your life. Own your data.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/LeonHEU-cesi/tasknest/actions/workflows/ci-api.yml/badge.svg?branch=develop)](https://github.com/LeonHEU-cesi/tasknest/actions)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)]()

Tasknest is an open-source, self-hostable task manager inspired by Notion and ClickUp, with **native bidirectional sync** to Google Calendar, Microsoft 365 / Outlook, Apple Calendar (CalDAV) and Samsung/Android calendars. Works **online and offline**.

This repository contains the full Tasknest stack:

- **API** — NestJS + Prisma + PostgreSQL + Redis + BullMQ
- **Web** — Next.js 16 (App Router) + Tailwind v4 + shadcn/ui + PWA installable
- **Mobile** — Expo SDK 53+ (iOS & Android, offline-first)

## Status

🚧 **Pre-alpha — work in progress.** First public release `v1.0.0` is planned at the end of the 24-sprint roadmap.

## Features (target v1.0.0)

- 📋 **4 views** — List, Kanban, Calendar, Timeline / Gantt
- 🔁 **Recurring tasks** — RFC 5545 RRULE support
- 🏷️ **Hierarchy** — Projects > Lists > Tasks > Subtasks
- 🔄 **Multi-provider calendar sync** — Google, Microsoft, Apple, CalDAV, .ics
- 🔐 **Strong auth** — Email/password, OAuth (Google/MS/Apple), magic link, 2FA TOTP mandatory
- 👥 **Sharing & collaboration** — Project sharing with role-based access
- 🌐 **i18n** — French + English (more languages welcomed)
- ♿ **WCAG AA** accessibility
- 📱 **Native mobile** — iOS & Android via Expo
- 🌐 **PWA** — installable web app, offline-first
- 🛡️ **Privacy-first** — RGPD compliant, data export & account deletion built in
- 🏠 **Self-hostable** — Docker Compose deployment on your own server

## Quick start (development)

```bash
git clone https://github.com/LeonHEU-cesi/tasknest.git
cd tasknest
git checkout develop
cp .env.example .env
docker compose up -d postgres redis mailpit
pnpm install
pnpm --filter @tasknest/api prisma:migrate
pnpm dev
```

See [`Docs/claude/Tasknest/installation.md`](./Docs/claude/Tasknest/installation.md) for the full installation guide (development + production on Proxmox).

## Documentation

The complete project documentation lives in `Docs/claude/Tasknest/` (in French) and covers:

- Development plan & architecture
- Scrum planning (24 sprints, ~107 user stories)
- Complete user stories with acceptance criteria
- Test plan (TU / TF / TNR / E2E / TS / TP / TV)
- Logical data model (DBML + DDL + RLS)
- Stack comparison & decision records
- Installation & deployment guides
- Validation procedures

For external users, the canonical user-facing docs (in English) will live under `docs/` once the first public release ships.

## Roadmap

The roadmap is divided into 24 two-week sprints (~11 months). See [`Docs/claude/Tasknest/Planning_Scrum.md`](./Docs/claude/Tasknest/Planning_Scrum.md) for the full breakdown.

## Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow, conventions and code of conduct before submitting a pull request.

## Security

If you discover a security vulnerability, please follow the responsible disclosure policy in [`SECURITY.md`](./SECURITY.md).

## License

Tasknest is licensed under the [GNU Affero General Public License v3.0](./LICENSE).

You are free to run, study, modify and redistribute Tasknest, but if you offer Tasknest (or a modified version) to others as a network service, you must publish your modified source code under the same license.

---

Made with care by [Léon Heu](https://github.com/LeonHEU-cesi) and contributors.
