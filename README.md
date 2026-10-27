# Sabha Attendance Portal

Plain HTML, CSS and JavaScript. No build step, no framework, no npm install.
Supabase provides the database and authentication.

One deployment serves any number of gharmandirs. Anyone can register theirs
at `register.html`; a platform admin approves it from `admin.html` before it
can be used. Every house's data is isolated from every other's by Postgres
row-level security, not just by the UI — see "Multi-tenant model" below.

## What's here

```
sabha-portal/
├── index.html            Dashboard (landing page)
├── login.html            Sign in — sevak/admin, or a house's shared PIN
├── register.html         Public signup: register a new gharmandir
├── admin.html            Platform admin only: approve/reject registrations
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
│   ├── auth.js           Sign in/out, session guard, profile, approval gate
│   │
│   ├── api/
│   │   ├── members.js    Member CRUD + stats view
│   │   ├── sabhas.js     Sabha records, settings
│   │   ├── attendance.js Marking, history, trends
│   │   └── mandirs.js    Registration, platform admin's house list
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
│       ├── history.js
│       └── admin-portal.js
│
└── sql/                  Run these in the Supabase SQL editor, in order
    ├── 01-schema.sql
    ├── 02-view.sql
    ├── 03-seed.sql           optional — one example gharmandir with demo data
    ├── 04-rls.sql
    ├── ...
    ├── 12-multi-tenant.sql   registration, approval, platform admin
    └── 13-pin-login-multi-tenant.sql
```

## Setup

### 1. Create the Supabase project

supabase.com → New project. Name it, set a database password, pick the
region nearest you. Wait 2–3 minutes for provisioning.

### 2. Run the SQL

Open **SQL Editor** in the Supabase dashboard and run each file in `sql/`
in numeric order. Run `04-rls.sql` last — row-level security would block
the seed inserts if enabled first.

Also, under **Authentication → Sign In / Providers**, turn off *Confirm
email* (or leave it on and see the note at the end of step 5 — registration
still works, it just takes one extra round trip).

### 3. Add your keys

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

- **SUPABASE_URL** — Supabase dashboard → **Settings → Data API → Project URL**.
  Or read the project ref out of the dashboard address bar
  (`https://supabase.com/dashboard/project/<REF>`) and use `https://<REF>.supabase.co`.
- **SUPABASE_KEY** — **Settings → API Keys → Publishable key** (`sb_publishable_...`).
- **GOOGLE_MAPS_KEY** — optional. Powers the address autocomplete on
  `register.html`. Get one from the Google Cloud Console with the *Places
  API* enabled; leave it blank and that field is just a plain text box.

Never put the secret key in this file. It bypasses row-level security, and
anything in `js/` is downloadable by anyone who opens the page.

### 4. Become the platform admin

Run the app (step 5), open `/register.html`, and register your own
gharmandir like anyone else would. That creates your account and a mandir
row stuck in `pending` — nothing can approve it yet, including you, so
finish the bootstrap with one query (SQL Editor):

```sql
update app_users set platform_admin = true
where id = (select id from auth.users where email = 'you@example.com');

update mandirs set status = 'approved', reviewed_at = now()
where id = (select mandir_id from app_users
            where id = (select id from auth.users where email = 'you@example.com'));
```

Sign in again and an **All Houses** link appears in the sidebar — every
gharmandir anyone registers from here on shows up there, pending your
approval, and this first query is the only one you'll ever run by hand.

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

If *Confirm email* is on, `register.html` still finishes the job — it just
can't call `register_mandir()` until a session exists, so it stashes the
form's details in `sessionStorage` and finishes registering automatically
the next time that browser has a signed-in session with no mandir attached
yet, which in practice is right after confirming and signing in.

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

`platform_admin` is separate from all of this — it isn't a role, and it
isn't scoped to a mandir_id like everything else here is. It's the one
flag that lets its holder see every gharmandir's registration from
`admin.html` and approve or reject it; see "Multi-tenant model" below.

## Multi-tenant model

Every table that matters (`members`, `sabhas`, `attendance`, `settings`)
is scoped by `mandir_id`, and a Postgres function called `my_mandir()`
resolves that to "whoever is signed in" on every row-level security
policy — see `sql/04-rls.sql`. A signed-in sevak or admin cannot read or
write another gharmandir's data no matter what the UI does or doesn't
show them; that boundary lives in the database, not the app.

Registration (`sql/12-multi-tenant.sql`) layers two more things on top:

- A new mandir starts `pending` and stays that way — invisible to
  everyone but its own admin and the platform admin, and (as a second,
  independent check, in case the UI redirect in `auth.js` is ever
  bypassed) unable to read or write members/sabhas/attendance — until
  `set_mandir_status()` marks it `approved`.
- The platform admin's visibility is equally narrow by design: `admin.html`
  shows a mandir's name, address and registering admin's contact details —
  enough to review a registration — never its members, sabhas or
  attendance. Those stay exactly as isolated from the platform admin as
  from every other gharmandir.

One consequence worth knowing: the house PIN now needs the ghar name
alongside it (`sql/13-pin-login-multi-tenant.sql`), since `claim_viewer()`
previously just grabbed the one settings row with a PIN set — fine with a
single gharmandir, ambiguous the moment a second one exists.

## Deploying

Any static host: Netlify, Vercel, Cloudflare Pages, GitHub Pages. Drag the
folder in — there's nothing to build. Remember to upload `js/config.js`,
since it's gitignored and won't come along with a git-based deploy. On
Netlify and Vercel you can instead paste the values into the build
environment and generate the file at deploy time.

## Notes

- Members are deactivated, never deleted — their attendance history stays intact.
- Attendance upserts on `(sabha_id, member_id)`, so re-marking someone updates
  rather than duplicating.
- Dates are handled as `YYYY-MM-DD` strings throughout to avoid the UTC
  midnight shift that moves dates a day backward in Toronto.
