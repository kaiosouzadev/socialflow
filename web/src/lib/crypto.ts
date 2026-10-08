import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
/** iv(12) + authTag(16): menor dado cifrado válido (texto vazio). */
const MIN_ENCRYPTED_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH;

const HEX_KEY = /^[0-9a-f]{64}$/i;

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENC_KEY;
  // 64 caracteres hexadecimais (32 bytes). Não-hex seria truncado pelo Buffer.from em silêncio.
  if (!hex || !HEX_KEY.test(hex)) {
    throw new Error("TOKEN_ENC_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a plaintext token.
 * Output format (base64): iv(12) + authTag(16) + ciphertext
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypts a token encrypted with encryptToken (mesmo formato de sempre).
 * A tag de autenticação tem de ter exatamente 16 bytes (CR-10): sem `authTagLength`, o Node
 * aceitava uma tag truncada (ex.: 4 bytes), o que enfraquece a verificação de integridade.
 */
export function decryptToken(encrypted: string): string {
  const key = getKey();
  const buf = Buffer.from(encrypted, "base64");
  if (buf.length < MIN_ENCRYPTED_LENGTH) {
    throw new Error("Encrypted value is too short");
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
