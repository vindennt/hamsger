// Uses `setupFiles` (NOT setupFilesAfterEnv) so the webcrypto polyfill runs BEFORE
// modules import — pinBackup.ts caches `const subtle = globalThis.crypto?.subtle`
// at module load, so the polyfill must exist first.
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  // `docs/impl/drafts/` holds *.test.ts drafts that get copied into the real
  // source tree, not run in place.
  testPathIgnorePatterns: ["/node_modules/", "/docs/"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@noble/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))",
  ],
};
