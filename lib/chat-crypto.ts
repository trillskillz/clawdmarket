import sodium from 'libsodium-wrappers';

let cachedKey: Uint8Array | null = null;

async function getKey() {
  if (cachedKey) return cachedKey;
  await sodium.ready;

  const envKey = process.env.CHAT_ENCRYPTION_KEY || process.env.JWT_SECRET || 'clawdmarket-chat-fallback-key';
  // Derive fixed-size key from secret material
  const material = sodium.from_string(envKey);
  cachedKey = sodium.crypto_generichash(32, material, null);
  return cachedKey;
}

export async function encryptMessage(content: string): Promise<{ encrypted_content: string; nonce: string }> {
  await sodium.ready;
  const key = await getKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(content, nonce, key);
  return {
    encrypted_content: sodium.to_base64(cipher),
    nonce: sodium.to_base64(nonce),
  };
}

export async function decryptMessage(encrypted_content: string, nonce: string): Promise<string> {
  await sodium.ready;
  const key = await getKey();
  const n = sodium.from_base64(nonce);
  const c = sodium.from_base64(encrypted_content);
  const plain = sodium.crypto_secretbox_open_easy(c, n, key);
  return sodium.to_string(plain);
}
