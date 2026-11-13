const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomId(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }

  let id = ''
  for (let index = 0; index < 24; index += 1) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
  }
  return id
}

/**
 * Collision-resistant local identifier.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts) and falls back to
 * a random string so the offline engine keeps working on plain `http://`.
 * An optional prefix keeps records readable while debugging IndexedDB.
 */
export function createId(prefix?: string): string {
  const id = randomId()
  return prefix ? `${prefix}_${id}` : id
}
