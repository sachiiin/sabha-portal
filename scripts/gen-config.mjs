// Generates js/config.js from environment variables at build time.
//
// Vercel runs this via `npm run build`. Locally, js/config.js is a file
// you create by hand and git never sees it — this script is what puts
// the same values in place on the deployed site without the keys ever
// living in the repository.

import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error('\nMissing environment variables.\n');
  console.error('  SUPABASE_URL  ', url ? 'ok' : 'NOT SET');
  console.error('  SUPABASE_KEY  ', key ? 'ok' : 'NOT SET');
  console.error('\nSet both in Vercel under Settings -> Environment Variables.\n');
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  console.error(`\nSUPABASE_URL looks wrong: ${url}`);
  console.error('Expected https://<project-ref>.supabase.co\n');
  process.exit(1);
}

if (key.startsWith('sb_secret_') || key.startsWith('eyJ')) {
  console.error('\nRefusing to build: SUPABASE_KEY is not a publishable key.');
  console.error('A secret or service_role key bypasses row-level security and');
  console.error('must never be shipped to the browser.');
  console.error('Use the key starting sb_publishable_ instead.\n');
  process.exit(1);
}

mkdirSync('js', { recursive: true });

writeFileSync(
  'js/config.js',
  `// Generated at build time. Do not edit or commit.
export const SUPABASE_URL = ${JSON.stringify(url.replace(/\/$/, ''))};
export const SUPABASE_KEY = ${JSON.stringify(key)};
`
);

console.log('Wrote js/config.js for', url);
