const encoder = new TextEncoder();

/**
 * A dedicated key keeps provider connections readable when the auth secret is
 * rotated or differs between local and deployed environments.
 */
export function providerTokenSecret(env: {
  PROVIDER_TOKEN_KEY?: string;
  BETTER_AUTH_SECRET: string;
}): string {
  if (env.PROVIDER_TOKEN_KEY) {
    if (env.PROVIDER_TOKEN_KEY.length < 32) {
      throw new Error("PROVIDER_TOKEN_KEY must be at least 32 characters");
    }
    return env.PROVIDER_TOKEN_KEY;
  }
  return env.BETTER_AUTH_SECRET;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`cloudflare-git:provider-token:v1:${secret}`)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts a provider token at rest. The AES key is derived from the auth
 * secret, so rotating BETTER_AUTH_SECRET requires reconnecting integrations.
 */
export async function encryptProviderToken(
  secret: string,
  plaintext: string
): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptProviderToken(
  secret: string,
  envelope: string
): Promise<string> {
  const [version, ivValue, ciphertextValue] = envelope.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) {
    throw new Error("Unsupported provider token envelope");
  }
  const key = await deriveKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    key,
    fromBase64(ciphertextValue)
  );
  return new TextDecoder().decode(plaintext);
}
