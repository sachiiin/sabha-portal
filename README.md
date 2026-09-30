# Sabha Attendance Portal — Gharmandir / Dasanudas

Plain HTML, CSS and JavaScript. No build step, no framework, no npm install.
Supabase provides the database and authentication.

## What's here

```
sabha-portal/
├── index.html            Dashboard (landing page)
├── login.html            Sign in
├── attendance.html       Mark attendance for a sabha
├── members.html          Member roster (admin can edit)
├── history.html          Grid, sabha list, CSV export
│
├── css/styles.css        All styling, light + dark mode
│
├── js/
│   ├── config.example.js Copy to config.js and fill in
│   ├── config.js         YOUR KEYS — gitignored, you create this
│   ├── supabase.js       Shared client
│   ├── auth.js           Sign in/out, session guard, profile
│   │
│   ├── api/
│   │   ├── members.js    Member CRUD + stats view
│   │   ├── sabhas.js     Sabha records, settings
│   │   └── attendance.js Marking, history, trends
│   │
│   ├── lib/
│   │   ├── dates.js      Timezone-safe date handling
│   │   ├── schedule.js   Sunday weekly, Thursday biweekly
│   │   ├── export.js     CSV building and download
│   │   └── ui.js         Header, nav, toasts, escaping
│   │
│   └── pages/
│       ├── dashboard.js
│       ├── attendance.js
│       ├── members.js
│       └── history.js
│
└── sql/                  Run these in the Supabase SQL editor, in order
    ├── 01-schema.sql
    ├── 02-view.sql
    ├── 03-seed.sql
    └── 04-rls.sql
```

## Setup

### 1. Create the Supabase project

supabase.com → New project. Name it, set a database password, pick the
region nearest you. Wait 2–3 minutes for provisioning.

### 2. Run the SQL

Open **SQL Editor** in the Supabase dashboard and run each file in `sql/`
in numeric order. Run `04-rls.sql` last — row-level security would block
the seed inserts if enabled first.

### 3. Create your login

**Authentication → Users → Add user → Create new user.** Use your email,
set a password, tick *Auto Confirm User*.

Then link that account to the mandir (SQL Editor):

```sql
insert into app_users (id, mandir_id, full_name, role)
select u.id,
       (select id from mandirs where ghar_name = 'Dasanudas'),
       'Your Name',
       'admin'
from auth.users u
where u.email = 'you@example.com';
```

### 4. Add your keys

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

- **SUPABASE_URL** — Supabase dashboard → **Settings → Data API → Project URL**.
  Or read the project ref out of the dashboard address bar
  (`https://supabase.com/dashboard/project/<REF>`) and use `https://<REF>.supabase.co`.
- **SUPABASE_KEY** — **Settings → API Keys → Publishable key** (`sb_publishable_...`).

Never put the secret key in this file. It bypasses row-level security, and
anything in `js/` is downloadable by anyone who opens the page.

### 5. Run it

The app uses ES modules, so it must be served over HTTP. Opening
`index.html` directly with `file://` will fail with a CORS error.

```bash
cd sabha-portal
python3 -m http.server 8000
```

Then open <http://localhost:8000/login.html>.

Any static server works — `npx serve`, `php -S localhost:8000`, or the
VS Code Live Server extension.

## How the schedule works

Sunday sabha is every week. Thursday sabha is every second week, counted
from `settings.thursday_anchor` — a Thursday that did have sabha. To shift
the biweekly cycle, change that one date:

```sql
update settings set thursday_anchor = '2026-10-08';
```

## Roles

| | Sevak | Admin |
|---|---|---|
| View dashboard and history | yes | yes |
| Mark attendance | yes | yes |
| Add / edit / deactivate members | no | yes |

Enforced in Postgres by row-level security, not just in the UI.

## Deploying

Any static host: Netlify, Vercel, Cloudflare Pages, GitHub Pages. Drag the
folder in — there's nothing to build. Remember to upload `js/config.js`,
since it's gitignored and won't come along with a git-based deploy. On
Netlify and Vercel you can instead paste the two values into the build
environment and generate the file at deploy time.

## Notes

- Members are deactivated, never deleted — their attendance history stays intact.
- Attendance upserts on `(sabha_id, member_id)`, so re-marking someone updates
  rather than duplicating.
- Dates are handled as `YYYY-MM-DD` strings throughout to avoid the UTC
  midnight shift that moves dates a day backward in Toronto.
