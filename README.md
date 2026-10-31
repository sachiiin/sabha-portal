# Sabha Attendance Portal

Plain HTML, CSS and JavaScript. No build step, no framework, no npm install.
Supabase provides the database and authentication.

One deployment serves any number of gharmandirs. Anyone can register theirs
at `register.html`; a platform admin approves it from the separate platform
admin area before it can be used. Every house's data is isolated from every
other's by Postgres row-level security, not just by the UI — with one
deliberate, read-only exception for the platform admin — see "Multi-tenant
model" below.

A platform admin account is its own world, not an extra tab bolted onto a
regular gharmandir: signing in with one always lands in `platform-*.html`,
never a mandir's own dashboard, and a mandir's own sidebar never shows any
sign the role exists. See "Become the platform admin" below to set yours up.

## What's here

```
sabha-portal/
├── index.html                Dashboard (landing page)
├── login.html                Sign in — sevak/admin, or a house's shared PIN
├── register.html             Public signup: register a new gharmandir
├── account.html              Change your own password
├── attendance.html           Mark attendance for a sabha
├── members.html              Member roster (admin can edit)
├── history.html              Grid, sabha list, CSV export
│
├── platform-dashboard.html    Platform admin: PIN-viewer dashboard, all houses or one
├── platform-houses.html       Platform admin: every house, card view
├── platform-house.html        Platform admin: one house's dashboard/history/roster/users
├── platform-approvals.html    Platform admin: approve/reject registrations
├── platform-team.html         Platform admin: team + create/move users
│
├── css/styles.css            All styling, light + dark mode
│
├── js/
│   ├── config.example.js     Copy to config.js and fill in
│   ├── config.js             YOUR KEYS — gitignored, you create this
│   ├── supabase.js           Shared client
│   ├── auth.js               Sign in/out, session guard, profile, approval gate
│   │
│   ├── api/
│   │   ├── members.js        Member CRUD + stats view
│   │   ├── sabhas.js         Sabha records, settings
│   │   ├── attendance.js     Marking, history, trends
│   │   ├── mandirs.js        Registration, platform admin's house list
│   │   └── team.js           Platform admin: create/move/promote accounts
│   │
│   ├── lib/
│   │   ├── dates.js          Timezone-safe date handling
│   │   ├── schedule.js       Sunday weekly, Thursday biweekly
│   │   ├── export.js         CSV building and download
│   │   ├── geo.js            Canada provinces/cities, postal code formatting
│   │   └── ui.js             Header, nav (two variants), toasts, escaping
│   │
│   └── pages/
│       ├── dashboard.js, attendance.js, members.js, history.js
│       ├── account.js
│       └── platform-dashboard.js, platform-houses.js, platform-house.js,
│           platform-approvals.js, platform-team.js
│
└── sql/                      Run these in the Supabase SQL editor, in order
    ├── 01-schema.sql
    ├── 02-view.sql
    ├── 03-seed.sql               optional — one example gharmandir with demo data
    ├── 04-rls.sql
    ├── ...
    ├── 12-multi-tenant.sql       registration, approval, platform admin
    ├── 13-pin-login-multi-tenant.sql
    ├── 14-platform-team.sql      create/move/promote accounts directly
    ├── 15-platform-house-view.sql  read-only: one house's dashboard/history/roster
    ├── 16-platform-house-view-absences.sql  same, for the Away sections
    ├── 17-mandal-options.sql      this house's mandal categories
    ├── 18-house-join-requests.sql join an existing house instead of registering a new one
    ├── 19-structured-address.sql  street/city/province/postal code instead of free text + Places
    ├── 20-nimitt-sevak.sql        read-only platform role: Dashboard + All Houses, nothing else
    ├── 21-finish-pending-signup.sql  finish registering/joining from JWT metadata, any device
    ├── 22-platform-house-admins.sql  real admin name + email per house, for Approvals/All Houses
    ├── 23-pin-rules.sql              house PIN: exactly 6 digits, no 0-3-6-9 combo
    └── 24-pin-login-case-insensitive.sql  house name match ignores case on PIN sign-in
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

Sign in again and you'll land in the platform admin area instead of the
regular dashboard — every gharmandir anyone registers from here on shows up
in **Approvals**, pending your decision, and this first query is the only
one you'll ever run by hand. From **Team & Users** you can add more
platform admins, or create a sevak/admin login for any house directly
without waiting for that house to register one itself.

One thing worth knowing about that query: the Dasanudas account it just
flipped to `platform_admin = true` now always lands in the platform area,
never the Dasanudas dashboard, even though it still technically has a
`mandir_id`. If you also want to keep using that email for Dasanudas
day-to-day, create a second account for platform work instead — through
**Team & Users** once you're in, or by registering again with a different
email the same way you just did.

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
can't call `register_mandir()` until a session exists. The registration
details travel as Supabase user metadata on the signed-up account instead
of browser storage, so `finish_pending_signup()` (`sql/21`) can read them
back out of the JWT and finish the job the moment a session with no
app_users row shows up — which could be a completely different device
than the one that filled out the form, e.g. confirming from a phone's
mail app after registering on a desktop.

Accounts created from **Team & Users** work the same way: if *Confirm
email* is on, that person needs to click the link in their confirmation
email before the password the platform admin set for them will work.

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

`platform_admin` is separate from all of this — it isn't a role, and an
account with it set has no `mandir_id` or `role` at all (both are null
together, or set together; `sql/14-platform-team.sql` adds that
constraint). It's the one flag that lets its holder sign into the
platform admin area instead of a mandir's own; see "Multi-tenant model"
below.

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
- The platform admin's visibility was originally this narrow by design —
  a mandir's name, address and registering admin's contact details, never
  its members, sabhas or attendance — but `sql/15-platform-house-view.sql`
  and `sql/16-platform-house-view-absences.sql` add an explicit, read-only
  exception: opening a house from **All Houses** shows exactly what a PIN
  viewer of that house would see — the same stats, charts, attendance
  grid with notes, away periods, CSV export and member roster, split
  across tabs — plus who has a login there. It's deliberately narrow in
  its own way: five new SELECT-only policies, so nothing a platform admin
  does through this can ever write to a house's data, only look at it.
  `js/api/members.js`, `sabhas.js` and `attendance.js` all already took an
  explicit mandirId argument rather than assuming the caller's own, and
  `js/lib/charts.js` and `export.js` are pure, profile-independent
  utilities already, so `platform-house.js` reuses all of it completely
  unchanged — only the database side had to learn to allow the reads.
  The dashboard tab of that view was pulled out into
  `js/lib/house-dashboard.js` so **Dashboard** itself can reuse it: by
  default it fetches every approved house's scope, merges them into one
  set of stats/charts/roster, and a House filter beside the page title
  narrows that same view to a single house on demand.

`sql/14-platform-team.sql` extends that same visibility to `app_users`
itself, so **Team & Users** can list every account on the platform —
again, who they are and which house, never that house's actual data.
Creating one there can't use the Supabase admin API — that needs the
secret key, and this is a static site that never ships it to a browser —
so `js/api/team.js` opens a second, unpersisted Supabase client that calls
plain `signUp()` in the background and is then discarded, and a
security-definer function links the account it created to a house and
role. Moving someone between houses, or promoting/demoting a fellow
platform admin, are both separate functions with the same `is_platform_admin()`
check.

One consequence worth knowing: the house PIN now needs the ghar name
alongside it (`sql/13-pin-login-multi-tenant.sql`), since `claim_viewer()`
previously just grabbed the one settings row with a PIN set — fine with a
single gharmandir, ambiguous the moment a second one exists.

A second sevak from a house that's already registered shouldn't create a
duplicate mandir — `sql/18-house-join-requests.sql` has register.html
check the house name and address they typed against every approved
mandir first, and offers "join this house" instead when one matches.
Joining still needs the platform admin's say-so, but now it's
`app_users.status` that's pending, not `mandirs.status` — the house is
already approved, only this particular person isn't yet. Approvals shows
these alongside the usual registrations; approving just flips the
status, and declining blocks the account rather than deleting it —
actually deleting a Supabase Auth account needs the secret key, which
this static site never ships to the browser. A blocked account isn't
gone, though: picking a house for it from Approvals (the same "give
access" action used to unblock) clears the block as part of doing that.

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
