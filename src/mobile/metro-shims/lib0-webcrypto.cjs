// Hermes ships no WebCrypto, and lib0's react-native webcrypto entry expects
// the isomorphic-webcrypto package, whose native modules would force a dev
// client rebuild. The realtime stack only reaches this module through
// lib0/random (Yjs client ids), where a Math.random fill is sufficient.
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
  subtle: globalThis.crypto ? globalThis.crypto.subtle : undefined,
};
