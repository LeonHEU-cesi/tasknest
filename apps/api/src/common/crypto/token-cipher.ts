import sodium from 'libsodium-wrappers';

// US-AU-05 / #15 — Chiffrement symétrique des tokens OAuth stockés en base.
// Pourquoi libsodium secretbox (XSalsa20-Poly1305) : AEAD authentifié,
// recommandé Plan_developpement §5.5. Le texte clair des access/refresh/id
// tokens ne doit jamais être persisté : on chiffre avant écriture et on
// déchiffre uniquement en mémoire au moment d'appeler les API providers.

const KEY_BYTES = 32; // crypto_secretbox_KEYBYTES
const NONCE_BYTES = 24; // crypto_secretbox_NONCEBYTES

/**
 * Chiffre/déchiffre des chaînes courtes (tokens OAuth) avec une clé unique
 * dérivée de l'environnement. Le format de sortie est `base64(nonce || cipher)`
 * : le nonce aléatoire est concaténé en tête, jamais réutilisé.
 */
export class TokenCipher {
  private constructor(private readonly key: Uint8Array) {}

  // Fabrique async : libsodium doit être initialisé (`sodium.ready`) avant
  // tout appel cryptographique. La clé provient de TASKNEST_DB_ENCRYPTION_KEY
  // (32 octets encodés base64) — absente, on échoue tôt plutôt que de
  // persister des tokens en clair.
  static async create(base64Key: string | undefined): Promise<TokenCipher> {
    if (!base64Key) {
      throw new Error('TASKNEST_DB_ENCRYPTION_KEY manquant : impossible de chiffrer les tokens OAuth');
    }
    await sodium.ready;
    const key = sodium.from_base64(base64Key, sodium.base64_variants.ORIGINAL);
    if (key.length !== KEY_BYTES) {
      throw new Error(`TASKNEST_DB_ENCRYPTION_KEY invalide : ${KEY_BYTES} octets attendus, ${key.length} reçus`);
    }
    return new TokenCipher(key);
  }

  encrypt(plaintext: string): string {
    const nonce = sodium.randombytes_buf(NONCE_BYTES);
    const cipher = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, this.key);
    const packed = new Uint8Array(nonce.length + cipher.length);
    packed.set(nonce, 0);
    packed.set(cipher, nonce.length);
    return sodium.to_base64(packed, sodium.base64_variants.ORIGINAL);
  }

  decrypt(payload: string): string {
    const packed = sodium.from_base64(payload, sodium.base64_variants.ORIGINAL);
    if (packed.length <= NONCE_BYTES) {
      throw new Error('Charge chiffrée invalide : trop courte pour contenir un nonce');
    }
    const nonce = packed.subarray(0, NONCE_BYTES);
    const cipher = packed.subarray(NONCE_BYTES);
    const plaintext = sodium.crypto_secretbox_open_easy(cipher, nonce, this.key);
    return sodium.to_string(plaintext);
  }

  // Optionnel : ne chiffre que si une valeur est présente (les tokens
  // peuvent être nuls selon le provider/flow).
  encryptNullable(plaintext: string | null | undefined): string | null {
    return plaintext == null ? null : this.encrypt(plaintext);
  }

  decryptNullable(payload: string | null | undefined): string | null {
    return payload == null ? null : this.decrypt(payload);
  }

  // US-AU-05 / #15 — Scelle les champs token d'un compte OAuth avant
  // persistance (hook Better Auth). Seuls access/refresh/id token sont
  // chiffrés ; les autres champs (providerId, scope…) passent inchangés.
  // Fonction pure et testable isolément (preuve du chiffrement au repos).
  sealAccountTokens<T extends Record<string, unknown>>(
    account: T,
  ): T & { accessToken: string | null; refreshToken: string | null; idToken: string | null } {
    return {
      ...account,
      accessToken: this.encryptNullable(account.accessToken as string | null | undefined),
      refreshToken: this.encryptNullable(account.refreshToken as string | null | undefined),
      idToken: this.encryptNullable(account.idToken as string | null | undefined),
    };
  }
}
