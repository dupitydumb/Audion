#!/usr/bin/env node
// scripts/build-android.js
// Usage:
//   npm run android:build                       → standard APK build
//   npm run android:build -- --playstore        → Play Store AAB (no default registry)
//   npm run android:build -- --playstore --apk  → Play Store APK (no default registry)

import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
const isPlayStore = args.includes('--playstore');
const tauriArgs = args.filter(a => a !== '--playstore');

// Default to --aab for Play Store builds; leave default tauri behavior otherwise
if (isPlayStore && !tauriArgs.includes('--aab') && !tauriArgs.includes('--apk')) {
  tauriArgs.push('--aab');
}

const env = {
  ...process.env,
  ...(isPlayStore ? { VITE_PLAYSTORE: 'true' } : {}),
};

if (isPlayStore) {
  console.log('[build-android] Play Store mode: VITE_PLAYSTORE=true, default plugin registry removed');
} else {
  console.log('[build-android] Standard Android build');
}

const result = spawnSync(
  'npm',
  ['run', 'tauri', 'android', 'build', '--', ...tauriArgs],
  { stdio: 'inherit', env, shell: true }
);

process.exit(result.status ?? 1);
