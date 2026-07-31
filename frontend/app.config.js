/**
 * Dynamic app config, so a development build can sit on the same phone as the
 * Play Store install.
 *
 * Both would otherwise claim `com.suborganizer.app`, and Android refuses to
 * install two apps with the same package name under different signing keys —
 * Play re-signs with its own App Signing key, a dev build is signed with the EAS
 * keystore. Without this you have to uninstall the real app every time you want
 * to work on it, and reinstall from Play afterwards.
 *
 * The development variant therefore gets its own package name, app name and URL
 * scheme. Two separate icons on the home screen, two separate sets of stored
 * data, no conflict.
 *
 * `app.json` stays the single source of truth for the shipping app. Expo reads
 * it first and passes the result in as `config`, which is what we extend — using
 * that rather than requiring app.json ourselves means there is only ever one
 * copy of these values in play. `APP_VARIANT` is set by the development profile
 * in eas.json, and by `npm run dev` for local dev servers.
 */

const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => {
  if (!IS_DEV) return config;

  return {
    ...config,
    name: 'SubOrganizer Dev',
    // Distinct scheme too: two apps claiming `suborganizer://` would make the
    // OAuth redirect ambiguous, and Android would ask which app to open —
    // sometimes picking the wrong one mid-sign-in.
    scheme: ['suborganizer-dev', 'com.suborganizer.app.dev'],
    android: {
      ...config.android,
      package: 'com.suborganizer.app.dev',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.suborganizer.app.dev',
    },
  };
};
