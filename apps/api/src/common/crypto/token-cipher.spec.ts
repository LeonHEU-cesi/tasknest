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
});
