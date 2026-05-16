# Journal de bord — Tasknest

> Journal narratif du projet, organisé par sprint puis par issue.
> Format : H2 = Sprint, H3 = Issue, séparateur `---` entre issues, **sans date** (l'historique git fait foi).

## Sprint 3 — Auth 2FA + magic link

### Issue #20 — [3.4] Sessions Redis + invalidation manuelle

Chemin chaud des sessions servi par Redis (la BDD reste source de vérité), invalidation immédiate.

Backend
- `ioredis` ; client créé depuis `REDIS_URL` dans `createBetterAuth`.
- Option `secondaryStorage` Better Auth (`get`/`set` avec TTL/`delete`) branchée sur Redis : lecture de session via Redis, révocation effective sans attendre l'expiration.
- Invalidation manuelle via endpoints natifs Better Auth : `sign-out`, `revoke-sessions`.

Tests validés (47/47)
- Session servie : après login, `/me` 200 et Redis peuplé (`dbsize > 0`).
- `sign-out` ⇒ `/me` 401 immédiat ; `revoke-sessions` ⇒ `/me` 401.
- Setup e2e : `REDIS_URL` forcé sur `localhost` (le `.env` pointe le hostname docker `redis:6379`, injoignable depuis l'hôte/CI).

---

### Issue #19 — [3.3] US-SEC-02 2FA obligatoire au login + challenge

Enforcement du challenge 2FA après l'étape 1, géré nativement par le plugin Better Auth `two-factor`.

Backend (comportement plugin)
- 2FA active ⇒ `POST /sign-in/email` renvoie `{ twoFactorRedirect: true }` et un cookie « en attente » qui **n'autorise rien** (le guard `/me` répond 401) tant que le challenge n'est pas passé.
- `POST /two-factor/verify-totp` ou `/two-factor/verify-backup-code` (code one-shot) débloque la session.

Web
- Page `/auth/2fa-challenge` : saisie code TOTP **ou** code de récupération (bascule), `verifyTotp` / `verifyBackupCode`.
- `/login` : si `twoFactorRedirect`, redirection (`useRouter`) vers `/auth/2fa-challenge`.

Tests validés (44/44)
- `TS-SEC-02` : 2FA active → sign-in renvoie le challenge, `/me` reste 401 ; TOTP valide → `/me` 200 ; code de récupération one-shot (rejeu refusé).

Décision
- Invariant testé = accès réel (`/me` 401→200) plutôt que présence/absence de cookie : Better Auth pose un cookie pending, c'est l'autorisation effective qui doit être bloquée.

---

### Issue #18 — [3.2] US-SEC-01 2FA TOTP + codes de récupération

Activation de la double authentification via le plugin Better Auth `two-factor`.

Backend
- Plugin `twoFactor({ issuer: 'Tasknest', backupCodeOptions: { amount: 10 } })`.
- Schéma Prisma : `User.twoFactorEnabled` + modèle `TwoFactor` (`secret`, `backupCodes`, `userId`, **`verified`** — champ exigé par le plugin, oublié au 1er jet → `PrismaClientValidationError` corrigée). Migrations `two_factor` + `two_factor_verified`.

Web
- `auth-client.ts` : plugin `twoFactorClient`.
- Page `/security` : confirmation mot de passe → `twoFactor.enable` → **QR code** (lib `qrcode`, rendu data-URI) + **10 codes de récupération** affichés → saisie du code à 6 chiffres → `verifyTotp` active la 2FA.

Tests validés (41/41)
- `TF-SEC-01` : `enable` → `totpURI` + 10 backup codes ; code TOTP valide (généré via `otpauth` depuis le secret) → `twoFactorEnabled = true`.
- `TS-SEC-01` : `enable` sans session refusé ; code TOTP invalide refusé.

Décisions
- `otpauth` (et non `otplib`) pour générer les TOTP en test : mieux typé sous NodeNext.
- Commentaire `eslint-disable @next/next/no-img-element` retiré (règle non configurée — plugin Next absent ; `<img>` data-URI accepté).

---

### Issue #17 — [3.1] US-AU-08 Magic link / OTP par e-mail

Connexion sans mot de passe par lien e-mail, via le plugin Better Auth `magic-link` (fondation [2.0] prête).

Backend
- Plugin `magicLink` (import dynamique ESM-only) : TTL 15 min, token usage unique, `sendMagicLink` délégué à `MailService.sendMagicLinkEmail`.
- `MailService.sendMagicLinkEmail(to, url)` ajouté ; callback câblé dans `AuthModule`.

Web
- `auth-client.ts` : plugin `magicLinkClient`.
- `/login` : bouton « Email me a sign-in link » (`signIn.magicLink`), écran « check your inbox » (état `magic-sent`).

Tests validés (37/37, 9 fichiers)
- `TF-AU-08` : demande → e-mail capturé avec token ; vérification (`GET /magic-link/verify`) crée la session.
- `TS-AU-08` : token à usage unique — le rejeu ne crée pas de session.

Décision
- `apps/api` `declaration: false` : c'est une application, pas une lib ; supprime les erreurs TS2742 (types internes zod des plugins Better Auth non nommables en sortie `.d.ts`). Vaut pour les prochains plugins (2FA #18).

---

## Sprint 2 — Auth OAuth

### Issue #16 — [2.5] TS-AU-* suite de tests sécurité OAuth

Suite de sécurité consolidée (`security.ts-au.e2e-spec.ts`) :
- Cookie de session `tasknest.session_token` : `HttpOnly` + `SameSite` vérifiés.
- Non-fuite : `get-session` et `/me` ne renvoient ni mot de passe ni tokens.
- Callback OAuth (`/callback/google`) sans `state` ⇒ aucune session créée, statut ≠ 200 (anti-CSRF).
- Tokens OAuth chiffrés au repos : insertion via `sealAccountTokens` puis lecture en base — colonnes illisibles, déchiffrables uniquement avec la clé.
- Rappel : PKCE S256 + `state` + scopes déjà couverts par `TF/TS-AU-05/06/07`.

Total tests API : **34/34** (8 fichiers).

---

### Issue #15 — [2.4] Stockage chiffré des tokens OAuth en base

Durcissement et preuve du chiffrement introduit à l'issue [2.0].
- Logique de scellement extraite en méthode pure testable `TokenCipher.sealAccountTokens()` (chiffre `accessToken`/`refreshToken`/`idToken`, laisse `providerId`/`scope`/`password` intacts).
- Hooks Better Auth `databaseHooks.account.create|update.before` recâblés sur cette méthode.
- Tests unitaires dédiés : champs chiffrés vs intacts, compte `credential` sans token non altéré, round-trip.

Décision : déchiffrement **explicite** côté consommateurs (sync agenda, sprints US-SY-*), jamais en lecture transparente — limite la surface d'exposition du clair. Rotation de clé : prévue via ré-encodage hors-ligne quand `TASKNEST_DB_ENCRYPTION_KEY` changera (documenté, non requis tant qu'aucune donnée prod).

---

### Issue #14 — [2.3] US-AU-07 OAuth Apple login

Provider Apple ajouté à l'instance Better Auth (scopes `name email` uniquement — l'agenda iCloud n'est PAS accessible par cette voie, séparé via CalDAV au sprint sync US-SY-07). Boutons « Sign in with Apple » sur `/login` et `/signup`.

Tests validés (mocks)
- `TF-AU-07` : autorisation `appleid.apple.com`, `response_type` hybride `code id_token`, `client_id` présent.
- `TS-AU-07` : `state` anti-CSRF, aucun `client_secret` dans l'URL.

Note : le `client_secret` Apple réel est un JWT signé (clé privée Apple Developer) — fourni ultérieurement par Léon pour le callback bout-en-bout.

---

### Issue #13 — [2.2] US-AU-06 OAuth Microsoft login

Provider Microsoft (Identity Platform v2) ajouté. Scopes `openid email profile offline_access User.Read **Calendars.ReadWrite**` (mutualise auth + accès agenda pour la sync US-SY-04). `tenantId` configurable (`MICROSOFT_TENANT_ID`, défaut `common`). Boutons « Continue with Microsoft » sur `/login` et `/signup`.

Tests validés (mocks)
- `TF-AU-06` : autorisation `microsoftonline.com`, `response_type=code`, scopes incluant `Calendars.ReadWrite` + `offline_access`.
- `TS-AU-06` : PKCE `code_challenge` + `S256`, `state`, pas de `client_secret` en clair.

Liaison automatique multi-provider déjà active (`accountLinking.trustedProviders` posé à l'issue [2.0]). Tokens chiffrés au repos via les mêmes hooks. Total tests API : **27/27**.

---

### Issue #12 — [2.1] US-AU-05 OAuth Google (web)

Connexion Google par-dessus la fondation Better Auth (provider configuré à l'issue [2.0]).

Web
- `lib/auth-client.ts` : client Better Auth React (baseURL `/api/v1/auth`, `credentials: include`).
- Bouton **« Continue with Google »** sur `/login` ET `/signup` (`signIn.social({ provider: 'google' })`, `callbackURL` = `/settings`).
- Pages auth entièrement re-backées sur le client : login, signup, verify-email (retour post-redirection), forgot-password (`requestPasswordReset`), reset (`resetPassword(token)`), settings (profil `name`/`image`/`emailVerified`).

Backend
- Provider Google : scopes `openid email profile` + `calendar` + `access_type=offline` (refresh token pour la sync agenda US-SY-*). Liaison automatique si e-mail déjà existant (`accountLinking`). Tokens chiffrés au repos (hooks `databaseHooks.account` + libsodium).

Tests validés (23/23, mocks — pas de credentials Google réels)
- `TF-AU-05` : `POST /sign-in/social` → URL d'autorisation Google conforme (`response_type=code`, `client_id`, scopes incluant `calendar`, `access_type=offline`).
- `TS-AU-05` : PKCE `code_challenge` + `code_challenge_method=S256`, `state` anti-CSRF, pas de `client_secret` dans l'URL, state/PKCE distincts entre deux requêtes.
- `token-cipher.spec` : round-trip, nonce aléatoire, rejet clé erronée / charge falsifiée / clé non 32 octets.
- Non-régression Sprint 1 (auth + profil) toujours verte. `typecheck`/`lint` API + `build` web : 0 erreur.

Décisions / périmètre
- **Mobile PKCE reporté** : l'app Expo est encore un scaffold Sprint 0 sans aucun écran d'auth (le mobile a été différé au Sprint 1). Le flux OAuth mobile (expo-auth-session + Better Auth) nécessite d'abord de scaffolder l'auth mobile → issue de suivi dédiée plutôt que bâcler. Signalé au récap de sprint.
- Callback Google bout-en-bout (échange de code) testable seulement avec credentials réels (fournis ultérieurement par Léon) ; ici on valide la requête d'autorisation + le chiffrement, conforme à l'approche « mocks ».

---

### Issue [2.0] — Fondation Better Auth (re-back de l'auth Sprint 1)

Décision structurante validée avec Léon : **Better Auth devient le système d'auth complet** (pas seulement OAuth). L'auth hand-rolled du Sprint 1 est ré-implémentée sur Better Auth, pré-requis aux US-AU-05..07. Périmètre plus large que #12 nominal → traité comme une issue de fondation dédiée.

Backend
- **Schéma Prisma remodelé** sur Better Auth : `User`/`Session`/`Account`/`Verification` (remplace `email_verifications`/`password_resets`/`sessions` custom). Migration fraîche `better_auth_foundation` (projet pré-alpha, reset de dev assumé).
- **`src/auth/better-auth.ts`** : fabrique async (import dynamique — better-auth est ESM-only), `emailAndPassword` avec **argon2id** (parité Sprint 1), provider Google (scopes `profile email calendar offline`), `accountLinking`, `additionalFields` (locale/timezone/isAdmin/suspendedAt/deletedAt), hooks de chiffrement des tokens OAuth.
- **`src/common/crypto/token-cipher.ts`** : libsodium `secretbox` (clé `TASKNEST_DB_ENCRYPTION_KEY`, 32 octets) pour chiffrer access/refresh/id tokens au repos.
- **`AuthModule` (@Global)** : provider async de l'instance ; **`AuthGuard`** basé sur la session Better Auth (remplace `SessionAuthGuard`) ; token d'injection isolé (`auth.tokens.ts`) pour casser le cycle module ↔ guard.
- **`bootstrap.ts`** : configuration HTTP partagée prod/e2e — catch-all Better Auth (`toNodeHandler`) monté **avant** les body parsers, `/api/v1/auth/*`.
- **`users.*`** recâblés sur le nouveau schéma (`name`/`image`/`emailVerified`).
- Suppression de l'auth hand-rolled Sprint 1 (auth.service/controller/session.service/dto + session-auth.guard).

Tests validés
- **13/13 e2e verts** : non-régression complète signup / vérification e-mail / login+session / reset password (`auth.e2e-spec.ts`) + profil `/me` (`users.profile.e2e-spec.ts`) + health, tous via les endpoints Better Auth réels contre Postgres.
- Helper e2e mutualisé (`test/utils/e2e-app.ts`) : app Better Auth réelle, capture des e-mails, helpers signup/verify/login.
- `typecheck` (NodeNext) et `lint` API : 0 erreur.

Décisions
- **`apps/api` passé en `module/moduleResolution: NodeNext`** : seule façon propre de résoudre un paquet ESM-only (`exports`/`.d.mts`) tout en gardant `import()` dynamique en sortie CommonJS NestJS.
- **Tokens OAuth chiffrés à l'écriture** via `databaseHooks.account` ; déchiffrement explicite côté consommateurs (sync agenda), jamais en lecture transparente.
- **Dépendances déclarées** : `express` ajouté en dépendance directe (importé dans le bootstrap — était transitif), `dotenv` en devDep (setup e2e). Même principe que le fix `@eslint/js`.
- `ci-api.yml` : `TASKNEST_DB_ENCRYPTION_KEY` corrigé en clé 32 octets valide (l'ancienne valeur faisait 35 octets).

---

## Sprint 1 — Auth basique

### Issue #11 — [1.5] US-US-01 Profile read/edit

Premier endpoint authentifié. Introduit le `SessionAuthGuard` qui transforme le cookie de session en `request.user` typé, et le décorateur `@CurrentUser()` qui injecte ce profil dans les contrôleurs.

Backend
- **`SessionAuthGuard`** (`src/common/auth/session-auth.guard.ts`) : lit le cookie `tasknest_session`, valide via `SessionService.validate`, charge le profil utilisateur (sélection minimale), refuse les comptes supprimés/suspendus. Attache `request.user` (`AuthenticatedUser`) et `request.sessionId`.
- **`@CurrentUser()`** (`src/common/decorators/current-user.decorator.ts`) : decorator paramétré qui retourne `request.user`.
- **`UsersService`** : `findById(id)`, `updateProfile(id, dto)`. Ne retourne jamais `password_hash` ni `is_admin` au client (`PublicProfile`).
- **`UsersController`** : `GET /api/v1/me` (renvoie le profil complet), `PATCH /api/v1/me` (display name, locale `fr`/`en`, timezone IANA, avatar URL). `@UseGuards(SessionAuthGuard)` au niveau du controller.
- **`UsersModule`** : importe `AuthModule` pour exposer `SessionService`. Déclare le guard comme provider.
- `app.module.ts` : import du nouveau `UsersModule`.

Frontend
- `apps/web/src/lib/api-client.ts` enrichi : `apiGet`, `apiPatch`, gestion du `204 No Content`.
- `apps/web/src/app/(app)/settings/page.tsx` : page `/settings` (segment `(app)` pour les pages authentifiées). Charge le profil via `GET /me`, formulaire avec display name + sélecteur de langue FR/EN + timezone IANA. Affiche un message dédié `401` (pas connecté).

Tests validés
- 5 nouveaux tests e2e (`users.profile.e2e-spec.ts`) : `401` sans cookie, `200` avec cookie valide (et pas de leak du `password_hash`), `200 PATCH` avec maj des trois champs, `400` sur locale invalide, `401 PATCH` sans cookie
- Total e2e : **23 passants** (health 1 + signup 3 + verify 4 + login 5 + reset 5 + profile 5)
- typecheck + lint OK
- web build : 7 routes statiques (la nouvelle `/settings` 1.86 kB)

Décision
- `SessionAuthGuard` central plutôt qu'un guard local au controller `users` : sera réutilisé dès l'arrivée des modules `tasks`, `projects`, etc. (sprint 4 et plus).
- `PublicProfile` filtre explicitement les champs sensibles (pas de `password_hash`, pas d'`is_admin` exposé sur l'endpoint user-facing). Pour la modération, l'admin aura ses propres endpoints au sprint 18.

---

### Issue #10 — [1.4] US-AU-04 Password reset by email

Flux complet « j'ai oublié mon mot de passe » : demande → email → page de réinitialisation → mise à jour du hash + invalidation de toutes les sessions de l'utilisateur.

Backend
- **Modèle Prisma `PasswordReset`** (`token_hash`, `user_id`, `expires_at`, `used_at`). Migration `add_password_resets` appliquée.
- **`AuthService.requestPasswordReset(email)`** : retour silencieux (`return`) si l'utilisateur n'existe pas, est suspendu ou supprimé — **aucune fuite d'information**. Sinon génère un token (32 octets, SHA-256 stocké), TTL 30 min, envoi e-mail.
- **`AuthService.resetPassword(token, password)`** : SHA-256 le token, vérifie qu'il n'est pas déjà utilisé et pas expiré (`410 Gone`), hash argon2id le nouveau mot de passe, transaction Prisma `user.update + passwordReset.update(used_at) + sessions.deleteMany(userId)`. Envoi e-mail "password changed" en best-effort (jamais bloquant).
- **MailService** : ajout de `sendPasswordResetEmail` et `sendPasswordChangedEmail`.
- **Endpoints AuthController** :
  - `POST /api/v1/auth/forgot-password` → toujours `200 { status: 'ok' }`
  - `POST /api/v1/auth/reset-password` → `200 { id, email }`, **clearCookie** de session (sécurise même si l'utilisateur était connecté ailleurs)
- DTOs : `ForgotPasswordRequestDto`, `ResetPasswordRequestDto` (mêmes règles complexité que signup).

Frontend
- `/auth/forgot-password` : formulaire e-mail → message neutre après succès (jamais d'aveu sur l'existence du compte)
- `/auth/reset` : lit `?token=`, formulaire nouveau mot de passe + confirmation, gestion `410` (lien expiré). Wrappé dans `Suspense` pour le SSG Next 15.

Tests validés
- 5 nouveaux tests e2e (`auth.password-reset.e2e-spec.ts`) : 200 sans leak, 200 + token créé + mail envoyé, token inconnu → `400`, token expiré → `410`, succès complet (hash mis à jour + sessions tuées + token consommé)
- Total e2e : **18 passants**
- `pnpm --filter @tasknest/api` typecheck + lint OK
- `pnpm --filter @tasknest/web build` (routes `/forgot-password` et `/reset` rendues statiques)

Cas couverts
- `TF-AU-04a` forgot inconnu → 200 silencieux
- `TF-AU-04b` forgot connu → token créé + mail envoyé
- `TF-AU-04c` reset token inconnu → 400
- `TF-AU-04d` reset token expiré → 410
- `TF-AU-04e` reset succès → hash maj, sessions tuées, token consommé

Décision
- **Invalidation de toutes les sessions** au reset password (et pas seulement la session courante) : best-practice sécurité — si un attaquant a obtenu un mot de passe leaké, il perd toute ouverture quand l'utilisateur reset.

---

### Issue #9 — [1.3] US-AU-03 Login email + password (with cookie session)

Premier mécanisme de session. Introduit la table `sessions` (Postgres) et un cookie HttpOnly transportant un token aléatoire dont seul le SHA-256 est stocké en BDD.

Backend
- **Modèle Prisma `Session`** : `id` (SHA-256 du token), `user_id`, `ip_address`, `user_agent`, `expires_at`. Index sur `user_id` et `expires_at`. Migration `add_sessions` appliquée.
- **`SessionService`** : `create()` (génère 32 octets aléatoires base64url, calcule SHA-256 → id, expires en 7 jours), `validate()`, `destroy()`. Hash statique réutilisé par tous les consommateurs (`SessionService.hash`).
- **`AuthService.login`** : `verify` argon2id contre `users.password_hash`. **Délai constant ≥ 1 s sur les échecs** pour limiter les attaques par chronométrage. Refus en `403 email-not-verified` si `email_verified_at` est null, `403 account-not-available` si `suspended_at` ou `deleted_at`, `401 invalid-credentials` sinon.
- **Endpoints** ajoutés dans `AuthController` :
  - `POST /api/v1/auth/login` retourne `{ id, email, displayName }` + pose le cookie `tasknest_session` (HttpOnly, SameSite=Lax, Secure en prod, expires 7j)
  - `POST /api/v1/auth/logout` lit le cookie, supprime la session correspondante, vide le cookie. Réponse `204`.
- **`main.ts`** : ajout de `cookie-parser` (middleware Nest `app.use(cookieParser())`) et de `CORS` avec `credentials: true`, origines depuis `WEB_PUBLIC_URL` + `TRUSTED_ORIGINS`.
- Nouvelle dépendance : `cookie-parser` + types associés.

Frontend
- `apps/web/src/app/(auth)/login/page.tsx` : formulaire e-mail + mot de passe, gestion d'états, messages spécifiques pour `401` (identifiants invalides) et `403` (compte non vérifié), écran de bienvenue après succès.

Tests validés
- 5 nouveaux tests e2e (`auth.login.e2e-spec.ts`) : succès + cookie, mauvais mot de passe + délai constant, compte non vérifié → `403`, e-mail inconnu → `401`, logout supprime la session
- Total e2e : **13 passants** (health 1 + signup 3 + verify-email 4 + login 5)
- `pnpm --filter @tasknest/api typecheck` / `lint` (verts)
- `pnpm --filter @tasknest/web build` (route `/login` rendue statique 1.65 kB, `/signup`, `/verify-email` toujours là)

Décisions
- **Sessions en BDD plutôt que JWT** : permet d'invalider individuellement (logout, rotation) sans dépendre d'une blacklist Redis dès le sprint 1. La bascule vers Redis pour le hot path et la révocation à la volée est planifiée au sprint 3 (US-SEC-04).
- **Délai constant côté login** : protection minimale contre les attaques par timing — Sprint 22 (US-SEC-03) ajoutera un rate-limit Redis dédié.
- Pas encore de guard d'authentification : aucun endpoint privé pour le moment, le guard apparaît à l'issue #11 (profile).

---

### Issue #8 — [1.2] US-AU-02 Email verification

Endpoint qui consomme le token envoyé à l'issue #7 pour activer le compte.

- **`POST /api/v1/auth/verify-email`** lit `{ token }`, recalcule le SHA-256, retrouve la ligne `EmailVerification`, vérifie qu'elle n'est pas déjà consommée (`usedAt`) et qu'elle n'est pas expirée. Si expirée → `410 Gone`. Si invalide ou déjà utilisée → `400`. Sinon, transaction Prisma : `users.email_verified_at = now()` + `email_verifications.used_at = now()`.
- Retourne `{ id, email, alreadyVerified }` — `alreadyVerified: true` si l'utilisateur avait déjà été validé (cas idempotent où on rejoue le token, mais on n'écrase pas la date d'origine).
- **Vitest e2e** : 4 tests (succès nominal, token inconnu, token déjà utilisé, token expiré).
- **`fileParallelism: false`** ajouté à `vitest.config.ts` : les tests e2e partagent la même BDD Postgres, l'exécution parallèle créait des conflits lors du `deleteMany` de `beforeEach`.
- Frontend : page `apps/web/src/app/(auth)/verify-email/page.tsx`. Lit `?token=` via `useSearchParams`, déclenche l'appel API, affiche un message selon le résultat. **`Suspense` boundary** autour du composant interne (Next 15 exige un fallback pour `useSearchParams` lors du SSG).

Tests validés
- 8 tests e2e api passent (health + signup + verify)
- `pnpm --filter @tasknest/api typecheck` (succès)
- `pnpm --filter @tasknest/api lint` (0 erreur)
- `pnpm --filter @tasknest/web build` (route `/verify-email` 1.26 kB rendue statique)

Cas couverts
- `TF-AU-02a` parcours nominal (`200`, `emailVerifiedAt` rempli, `usedAt` rempli)
- `TF-AU-02b` token inconnu → `400`
- `TF-AU-02c` token déjà utilisé → `400`
- `TF-AU-02d` token expiré → `410`

---

### Issue #7 — [1.1] US-AU-01 Signup email + password (API + web)

Première vraie fonctionnalité produit : création de compte avec hachage du mot de passe (argon2id), envoi d'un mail de confirmation et page web associée. Cette issue ajoute également l'infrastructure data + mail réutilisée par toutes les issues d'auth à venir.

Backend
- **Prisma 6 + PostgreSQL** : `apps/api/prisma/schema.prisma` pose les modèles `User` et `EmailVerification`. Migration initiale appliquée (`20260514220914_initial_users_and_email_verifications`).
- **PrismaService global** (`apps/api/src/db/`) avec hooks `onModuleInit`/`onModuleDestroy` pour le pool de connexions.
- **MailService** (`apps/api/src/modules/mail/`) basé sur Nodemailer 7 + Mailpit en dev (port 1025). Lit `SMTP_HOST/PORT/USER/PASSWORD/FROM` via `ConfigService`.
- **AuthService.signup** :
  - Validation DTO via `class-validator` (e-mail RFC 5322 ≤ 254 ; mot de passe 10–128 caractères avec au moins 1 minuscule, 1 majuscule, 1 chiffre ; displayName 1–80) ; e-mail normalisé en lowercase via `class-transformer`
  - Hachage du mot de passe avec `@node-rs/argon2` (memoryCost ≈ 19 MiB, timeCost 2, parallelism 1)
  - Génération d'un token de vérification : 32 octets aléatoires base64url côté plaintext, **SHA-256 en BDD** (jamais le plaintext)
  - Tout est wrappé dans `prisma.$transaction` (user + emailVerification) pour rester atomique
  - Envoi du mail avec lien `${WEB_PUBLIC_URL}/auth/verify-email?token=<plain>` (TTL 24 h)
  - Si l'envoi de mail échoue, le compte est conservé mais un warning est loggé (l'utilisateur pourra demander un renvoi à l'issue #8)
- **`POST /api/v1/auth/signup`** retourne `201 { id, email }`. Conflit e-mail existant → `409`. Validation invalide → `400` automatique via la `ValidationPipe` globale (whitelist + forbidNonWhitelisted + transform).
- **Outils de pipeline ajoutés** : `dotenv-cli` pour que les commandes Prisma chargent le `.env` racine (`pnpm --filter @tasknest/api prisma:*`).
- **`unplugin-swc` + `@swc/core`** dans la config Vitest pour préserver `emitDecoratorMetadata` (sans quoi NestJS échoue à injecter les dépendances dans les tests e2e).

Frontend
- `apps/web/src/lib/api-client.ts` : client `fetch` minimal (`apiPost`) avec gestion d'erreur typée (`ApiClientError`).
- `apps/web/src/app/(auth)/signup/page.tsx` : formulaire client (e-mail, mot de passe, displayName), gestion d'états `idle / submitting / success / error`, écran de confirmation après création du compte.

Tests validés
- `pnpm --filter @tasknest/api typecheck` (succès)
- `pnpm --filter @tasknest/api lint` (0 erreur)
- `pnpm --filter @tasknest/api test:unit` (4 tests, dont 3 nouveaux pour `AuthService.signup`)
- `pnpm --filter @tasknest/api test:e2e` (4 tests, dont 3 pour `POST /auth/signup` contre une vraie BDD Postgres)
- `pnpm --filter @tasknest/api build` (compilation Nest propre)
- `pnpm --filter @tasknest/web typecheck` / `lint` / `build` (route `/signup` rendue statique, 1.57 kB page, 103 kB shared)

Cas couverts par les tests
- `TU-AU-01` création utilisateur + appel de l'envoi de mail
- `TF-AU-01a` parcours nominal de signup (201, utilisateur en BDD, vérification créée)
- `TF-AU-01b` doublon e-mail rejeté en `409`
- `TF-AU-01c` mot de passe invalide rejeté en `400`

Décisions techniques
- Argon2id retenu plutôt que bcrypt car recommandé par OWASP (memory-hard, résistant au GPU) et déjà mentionné dans `Plan_developpement.md` §5.5.
- Pas encore de Better Auth : l'intégration NestJS exigerait un controller wildcard et un guard custom ; on n'en a pas besoin pour le signup pur. La bascule vers Better Auth est planifiée au sprint 2 quand OAuth/2FA arrivent.
- Schéma Prisma pose dès maintenant `is_admin`, `suspended_at`, `deleted_at`, etc. — utilisé par les sprints 18 (admin) et 22 (RGPD).

---

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

---

### Issue #6 — [0.6] GitHub Actions CI baseline (lint + typecheck + tests)

Les workflows CI/CD posés au commit initial ont échoué dès la première exécution (pnpm setup en conflit avec `packageManager` dans `package.json`). Cette issue stabilise la baseline + ajoute le workflow de release + Dependabot.

- **Fix bloquant** : suppression de `with.version: 9` dans les trois workflows `ci-api.yml`, `ci-web.yml`, `ci-mobile.yml`. La version pnpm est désormais lue uniquement depuis `package.json#packageManager` (`pnpm@9.12.0`). Résout l'erreur `ERR_PNPM_BAD_PM_VERSION` côté `pnpm/action-setup@v4`.
- `release.yml` ajouté : placeholder déclenché par tag `v*` ou `workflow_dispatch`, crée une release GitHub en mode `--draft`. Le vrai workflow de publication d'images Docker GHCR + génération de changelog arrive au sprint 23 (issue US-OSS-04).
- `dependabot.yml` ajouté : updates hebdomadaires npm + github-actions + docker, le lundi matin, avec labels `type-chore` + scope adapté. Les paquets TypeScript/ESLint/Vitest sont regroupés (`typescript-tooling`) pour limiter le volume de PRs.

Tests validés :
- Les workflows précédents (commits feat/api, feat/web, feat/mobile) sont à présent reproductibles à vert sur develop dès que cette correction est mergée
- Le smoke test final passera par l'exécution réelle des trois jobs `CI · API`, `CI · Web`, `CI · Mobile` sur la PR de cette issue
