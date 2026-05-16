import { describe, it, expect, beforeAll } from 'vitest';
import { TokenCipher } from './token-cipher';

// US-AU-05 / TS-AU-05 — Garantie : les tokens OAuth ne sont jamais stockés
// en clair (chiffrement authentifié libsodium secretbox).
const KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='; // 32 octets
const OTHER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='; // 32 octets, différents

describe('TokenCipher', () => {
  let cipher: TokenCipher;

  beforeAll(async () => {
    cipher = await TokenCipher.create(KEY);
  });

  it('chiffre puis déchiffre (round-trip)', () => {
    const plaintext = 'ya29.a0AbCdEf-google-access-token';
    const sealed = cipher.encrypt(plaintext);
    expect(sealed).not.toBe(plaintext);
    expect(sealed).not.toContain(plaintext);
    expect(cipher.decrypt(sealed)).toBe(plaintext);
  });

  it('nonce aléatoire : deux chiffrements de la même valeur diffèrent', () => {
    const a = cipher.encrypt('same-token');
    const b = cipher.encrypt('same-token');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same-token');
    expect(cipher.decrypt(b)).toBe('same-token');
  });

  it('déchiffrement avec une autre clé échoue (AEAD)', async () => {
    const other = await TokenCipher.create(OTHER_KEY);
    const sealed = cipher.encrypt('refresh-token-secret');
    expect(() => other.decrypt(sealed)).toThrow();
  });

  it('charge falsifiée rejetée', () => {
    const sealed = cipher.encrypt('id-token');
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('clé absente ou invalide refusée tôt', async () => {
    await expect(TokenCipher.create(undefined)).rejects.toThrow(/manquant/);
    await expect(TokenCipher.create('dHJvcA==')).rejects.toThrow(/invalide/);
  });

  it('helpers nullable : null passe au travers', () => {
    expect(cipher.encryptNullable(null)).toBeNull();
    expect(cipher.decryptNullable(undefined)).toBeNull();
    const sealed = cipher.encryptNullable('x');
    expect(sealed).not.toBeNull();
    expect(cipher.decryptNullable(sealed)).toBe('x');
  });

  // #15 — preuve que le hook Better Auth ne persiste jamais un token en clair.
  it('sealAccountTokens chiffre access/refresh/id et laisse le reste intact', () => {
    const account = {
      providerId: 'google',
      accountId: 'sub-123',
      scope: 'openid email',
      accessToken: 'ya29.access',
      refreshToken: '1//refresh',
      idToken: 'eyJ.id.token',
    };
    const sealed = cipher.sealAccountTokens(account);

    expect(sealed.providerId).toBe('google');
    expect(sealed.accountId).toBe('sub-123');
    expect(sealed.scope).toBe('openid email');

    expect(sealed.accessToken).not.toBe(account.accessToken);
    expect(sealed.refreshToken).not.toBe(account.refreshToken);
    expect(sealed.idToken).not.toBe(account.idToken);

    expect(cipher.decrypt(sealed.accessToken as string)).toBe('ya29.access');
    expect(cipher.decrypt(sealed.refreshToken as string)).toBe('1//refresh');
    expect(cipher.decrypt(sealed.idToken as string)).toBe('eyJ.id.token');
  });

  it('sealAccountTokens : compte sans token (provider credential) non altéré', () => {
    const credential = { providerId: 'credential', accountId: 'u1', password: 'argon2-hash' };
    const sealed = cipher.sealAccountTokens(credential);
    expect(sealed.password).toBe('argon2-hash');
    expect(sealed.accessToken).toBeNull();
    expect(sealed.refreshToken).toBeNull();
    expect(sealed.idToken).toBeNull();
  });
});
