// Copy this file to config.js and fill in your own values.
// config.js is gitignored.
//
// SUPABASE_URL - Supabase dashboard, Settings -> Data API -> Project URL
// SUPABASE_KEY - Settings -> API Keys -> Publishable key (sb_publishable_...)
//                Never the secret key. It bypasses row-level security.
//
// GOOGLE_MAPS_KEY - Google Cloud Console -> APIs & Services -> Credentials.
//                   Enable the "Places API" (and "Maps JavaScript API") for
//                   the project, then restrict the key to your domain under
//                   "API restrictions". Only used on register.html, to
//                   suggest an address while someone signs their gharmandir
//                   up. Leave it blank and that field just becomes a plain
//                   text box — nothing else in the app depends on it.
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_YOUR_KEY_HERE';
export const GOOGLE_MAPS_KEY = '';
