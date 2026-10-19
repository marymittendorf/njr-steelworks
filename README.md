# NJR Steelworks

Public website and staff back end for NJR Steelworks (trailers, skips, fabrication, welding, gates).

- `/` is the public site: services with "from" prices you set under Rates & settings, recent work photos, contact people, and a quote request form with photo upload.
- `/admin` is the staff back end: dashboard, website requests, quotes, orders (stage tracker), deliveries calendar with customer signatures, stock, job costing with customer quote/invoice (print or save as PDF), steel price list, website photos, and rates & settings.

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

## Staff logins

Staff sign in with a **username** and password. Behind the scenes the login is
`<username>@njrsteelworks.co.za`; nobody has to type that part.

Owners (Jeanette, Nico) manage logins in the back end under **Staff**: add a person,
set a new password, or remove someone. That page calls the `manage-staff` Edge Function
(`supabase/functions/manage-staff`), which checks the caller is an owner before doing anything.
There is no "email me a reset link"; an owner sets a new password instead.

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
