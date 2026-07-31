#!/usr/bin/env node
/**
 * Starts the dev server for the *development* app variant.
 *
 * APP_VARIANT has to be set for this process, not just for the EAS build: in a
 * development build `Constants.expoConfig` comes from the manifest this server
 * hands out, and src/auth-context.tsx reads the URL scheme from it. Start the
 * server without the variant and the app asks Google to redirect to
 * `suborganizer://`, which the dev build does not own — sign-in dies on the way
 * back.
 *
 * A wrapper rather than an inline env assignment in package.json, because
 * `APP_VARIANT=x cmd` is not valid on Windows and cross-env is a dependency this
 * project does not need for one variable.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

// Resolve the Expo CLI's entry script and run it with this same Node binary.
//
// The obvious `spawn('npx', [...], { shell: true })` works but earns a DEP0190
// warning on every start: with a shell, arguments are concatenated rather than
// escaped, so anything containing a space or a quote is a hazard. Going straight
// to the script needs no shell, passes arguments through untouched, and skips
// npx's resolution step as a bonus.
const expoBin = require.resolve('@expo/cli/build/bin/cli', {
  paths: [path.join(__dirname, '..')],
});

const child = spawn(
  process.execPath,
  [expoBin, 'start', '--dev-client', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, APP_VARIANT: 'development' },
  },
);

child.on('exit', (code, signal) => {
  // Pass the child's fate through, so Ctrl+C and failures behave normally.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Could not start the Expo dev server:', err.message);
  process.exit(1);
});
