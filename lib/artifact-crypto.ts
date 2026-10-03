import sodium from 'libsodium-wrappers'

async function key() {
  await sodium.ready
  const secret = process.env.CHAT_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim()
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('Artifact encryption key is required')
  return sodium.crypto_generichash(32, sodium.from_string(`clawdmarket-private-artifacts-v1\0${secret || 'local-development-only'}`), null)
}

export async function encryptArtifact(content: string) {
  const k = await key()
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  return { ciphertext: sodium.to_base64(sodium.crypto_secretbox_easy(content, nonce, k)), nonce: sodium.to_base64(nonce) }
}

export async function decryptArtifact(ciphertext: string, nonce: string) {
  const k = await key()
  return sodium.to_string(sodium.crypto_secretbox_open_easy(sodium.from_base64(ciphertext), sodium.from_base64(nonce), k))
}
