import { createAuthClient } from 'better-auth/react';

// US-AU-01..07 — Client Better Auth côté web. baseURL = base d'auth de
// l'API (le serveur monte le catch-all sur /api/v1/auth). `credentials:
// include` pour transporter le cookie de session cross-origin.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export const authClient = createAuthClient({
  baseURL: `${API_BASE}/api/v1/auth`,
  fetchOptions: { credentials: 'include' },
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
