const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js ships an `exports` map whose `import` condition points
// at an ESM build, which in turn imports @supabase/realtime-js — a package that
// has no `exports` map at all. With package exports enabled (the SDK 53+
// default) Metro fails that inner resolution and the bundle dies with
// "Unable to resolve @supabase/realtime-js". Turning exports off falls back to
// main/module, which every dependency here still declares.
config.resolver.unstable_enablePackageExports = false;

// A stable on-disk cache, so a restarted dev server does not re-transform the
// whole tree.
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [new FileStore({ root: path.join(root, 'cache') })];

module.exports = config;
