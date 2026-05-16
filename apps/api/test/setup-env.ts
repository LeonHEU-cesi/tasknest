import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';

// Trouve la racine du monorepo en remontant depuis le cwd jusqu'au marqueur
// pnpm-workspace.yaml. N'utilise ni import.meta (interdit en sortie CJS du
// typecheck) ni __dirname (absent sous le runtime ESM de vitest).
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const root = findRepoRoot(process.cwd());
if (root) {
  // En CI le .env est absent : dotenv no-op, le job fournit ses variables.
  config({ path: resolve(root, '.env'), override: true });
}

// Secrets de test si absents : le .env local n'a pas forcément les clés
// Better Auth (nouvelles au Sprint 2). En CI, les valeurs du job priment.
// Le .env pointe Redis sur le hostname docker (`redis:6379`), injoignable
// depuis l'hôte/CI où tournent les tests : on force localhost (port mappé).
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.AUTH_SECRET ||= 'tasknest-e2e-auth-secret-not-for-prod';
process.env.TASKNEST_DB_ENCRYPTION_KEY ||= 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
// Credentials OAuth factices : suffisent pour bâtir l'URL d'autorisation
// (aucun appel Google). Les vrais seront fournis par Léon.
process.env.GOOGLE_CLIENT_ID ||= 'tasknest-e2e-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET ||= 'tasknest-e2e-google-client-secret';
process.env.MICROSOFT_CLIENT_ID ||= 'tasknest-e2e-microsoft-client-id';
process.env.MICROSOFT_CLIENT_SECRET ||= 'tasknest-e2e-microsoft-client-secret';
process.env.APPLE_CLIENT_ID ||= 'com.tasknest.e2e';
process.env.APPLE_CLIENT_SECRET ||= 'tasknest-e2e-apple-client-secret';
