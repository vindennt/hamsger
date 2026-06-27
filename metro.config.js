const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Wasm support

// Force metro to parse as wasm, not json
config.resolver.sourceExts = config.resolver.sourceExts.filter(
  (ext) => ext !== "wasm",
);

// Add .wasm to asset extensions; Copied raw
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

module.exports = config;
