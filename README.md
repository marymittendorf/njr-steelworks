# NJR Steelworks

Public website and staff back end for NJR Steelworks (trailers, skips, fabrication, welding, gates).

- `/` is the public site: services with live "from" prices, recent work photos, contact people, and a quote request form with photo upload.
- `/admin` is the staff back end: dashboard, website requests, quotes & jobs, job costing with customer quote/invoice (print or save as PDF), steel price list, website photos, and rates & settings.

Stack: Vite + React, Supabase (database, login, file storage), deploys to Vercel.
Supabase project: `njr-steelworks` (ref `yswxsppkcyaujwamigbx`, eu-central-1).

## Run locally

```bash
npm install
npm run dev
```

`.env` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`).

```bash
npm test
```

runs the costing engine tests in `src/costing.test.js`.

## How costing works (`src/costing.js`)

1. Steel & hardware: quantity × buying price, plus mass for galvanising.
2. Labour: hours × labour rate, plus hours × consumables rate (wire, gas, discs, power).
3. Galvanising (optional): total kg × rate per kg.
4. Extras: outsourced work, delivery, etc.
5. All of the above × number of identical units = direct cost.
6. Workshop overhead % on direct cost = total cost.
7. Markup % on total cost = price excl. VAT. VAT on top = quote total.

Every saved quote keeps its own copy of the steel prices and rates it was costed with,
so changing the price list never changes a quote that was already sent. The costing
screen shows a "Use current prices" button when a quote is out of date.

## Adding staff

1. Supabase dashboard → Authentication → Users → **Add user** (email + password, tick auto-confirm).
2. Then run this in the SQL editor, with the user's email and name:

```sql
insert into public.staff (user_id, name, role)
select id, 'Jeanette', 'owner' from auth.users where email = 'their@email.com';
```

A signed-in account that isn't in `staff` sees "No staff access" and can't read anything.

Recommended: Authentication → Sign In / Providers → turn **off** "Allow new users to sign up",
so only accounts you add can exist.

## Deploy (Vercel)

1. Push this folder to a new GitHub repo.
2. Import it in Vercel (framework: Vite).
3. Add the two `VITE_SUPABASE_*` environment variables.
4. Add the domain (e.g. njrsteelworks.co.za).
5. In Supabase → Authentication → URL Configuration, set the Site URL to the live domain
   (needed for password-reset emails).

## Database

Migrations are in `supabase/migrations/` and have already been applied to the project.
Security: visitors can only send a quote request (and upload its photos), read visible
gallery photos, and read contact people + "from" prices through `public_site_info()`.
Everything else needs a staff login.
