// Hermes ships no WebCrypto, and lib0's react-native webcrypto entry expects
// the isomorphic-webcrypto package, whose native modules would force a dev
// client rebuild. The realtime stack only reaches this module through
// lib0/random (Yjs client ids), where a Math.random fill is sufficient.
// Reads globalThis.crypto lazily so a polyfill installed later in the entry
// chain is still picked up.
const getRandomValues = (typedArray) => {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    return globalThis.crypto.getRandomValues(typedArray);
  }
  const max = 2 ** (typedArray.BYTES_PER_ELEMENT * 8);
  for (let i = 0; i < typedArray.length; i++) {
    typedArray[i] = Math.floor(Math.random() * max);
  }
  return typedArray;
};

module.exports = {
  getRandomValues,
  // The shim replaces lib0/webcrypto for the WHOLE bundle. lib0/crypto/* uses
  // subtle for real cryptography (AES-GCM IVs, JWT signing); if a future
  // dependency pulls that in, it must fail loudly at first use rather than
  // silently degrade to Math.random.
  get subtle() {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) {
      throw new Error(
        "lib0/webcrypto subtle is unavailable in the RN bundle; only lib0/random is shimmed",
      );
    }
    return subtle;
  },
};
