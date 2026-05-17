# Security policy

## Supported versions

Tasknest is in pre-alpha development. Until the first stable release (`v1.0.0`), only the latest commit on the `develop` branch is supported. Once `v1.0.0` ships, the support matrix will be:

| Version | Supported |
|---|---|
| `1.x` (latest) | ✅ |
| `< 1.0` (pre-alpha) | ❌ |

---

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

If you discover a security issue, please report it privately through
**[GitHub Security Advisories](https://github.com/LeonHEU-cesi/tasknest/security/advisories/new)**
(Security → Report a vulnerability). This keeps the report private to the
maintainers and is the preferred channel.

Include:

- A description of the vulnerability
- Steps to reproduce
- Affected component (API / web / mobile / infra)
- Potential impact (auth bypass, data leak, RCE, etc.)
- Suggested fix if you have one

You can also use [GitHub Security Advisories](https://github.com/LeonHEU-cesi/tasknest/security/advisories/new) for private disclosure.

---

## Response timeline

| Severity | Initial response | Patch ETA |
|---|---|---|
| Critical (auth bypass, RCE, data loss) | < 48h | < 1 week (out-of-band release if needed) |
| High (privilege escalation, sensitive data exposure) | < 5 days | Next release |
| Medium (limited info disclosure, DoS) | < 10 days | Within 2 releases |
| Low (best-practice issue) | < 30 days | When convenient |

---

## Responsible disclosure

We follow a **90-day coordinated disclosure** model:

1. You report the vulnerability privately
2. We acknowledge within 48 hours
3. We work with you on a fix
4. Once patched, we release the fix and credit you in the changelog (with your permission)
5. After 90 days (or earlier if mutually agreed), the vulnerability can be publicly disclosed

---

## Out of scope

The following are **not** considered security vulnerabilities:

- Self-hosting misconfiguration (e.g. running without HTTPS, exposing PostgreSQL directly)
- Issues affecting only outdated browsers (more than 2 majors old)
- Social engineering or phishing of users or maintainers
- Theoretical attacks with no proof-of-concept

---

## Security-related features

Tasknest ships with the following baseline:

- HTTPS-only via Traefik + Let's Encrypt
- HSTS preload on production
- Cookies with `Secure`, `HttpOnly`, `SameSite=Lax`
- Passwords hashed with `argon2id`
- OAuth tokens encrypted at rest with `libsodium` (`crypto_secretbox_easy`)
- Rate limiting on all `/auth/*` endpoints (Redis token bucket)
- 2FA TOTP mandatory at signup
- CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy headers
- Audit log of sensitive actions (login, password change, account deletion, sharing)
- Row-Level Security in PostgreSQL for multi-tenant isolation
- No secrets in source code; all configuration via `.env`

---

## Hall of fame

We thank the following individuals for responsibly disclosing security issues:

*(empty for now — be the first!)*

---

Thanks for helping keep Tasknest and its users safe.
