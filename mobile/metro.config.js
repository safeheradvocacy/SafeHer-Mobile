const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js pulls in @supabase/realtime-js, which depends on
// `ws`. With Metro's newer package.json "exports" resolution enabled, `ws`
// resolves to a Node-only build that requires Node's `stream` module —
// which doesn't exist in React Native and breaks the bundle. Disabling
// exports-map resolution makes Metro fall back to the "main" field, which
// resolves to a React Native-safe build instead.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
