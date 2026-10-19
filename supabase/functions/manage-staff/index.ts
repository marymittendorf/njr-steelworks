// Owner-only staff management: add a login, reset a password, remove a login.
// Runs with the service role key on Supabase's servers; the browser never sees that key.
import { createClient } from 'npm:@supabase/supabase-js@2'

const LOGIN_DOMAIN = 'njrsteelworks.co.za'
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,29}$/

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'Your session has expired. Sign in again.' }, 401)
  const { data: me } = await admin.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if (me?.role !== 'owner') return json({ error: 'Only an owner can manage staff logins.' }, 403)

  let body: Record<string, string>
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const password = String(body.password || '')
  const goodPassword = password.length >= 8

  if (body.action === 'create') {
    const username = String(body.username || '').trim().toLowerCase()
    const name = String(body.name || '').trim()
    const role = body.role === 'owner' ? 'owner' : 'staff'
    if (!USERNAME.test(username)) return json({ error: 'Usernames are 2–30 characters: lowercase letters, numbers, dots or dashes.' }, 400)
    if (!name) return json({ error: 'Add the person\'s name.' }, 400)
    if (!goodPassword) return json({ error: 'Passwords need at least 8 characters.' }, 400)
    const { data: taken } = await admin.from('staff').select('user_id').eq('username', username).maybeSingle()
    if (taken) return json({ error: `The username "${username}" is already used.` }, 409)

    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${username}@${LOGIN_DOMAIN}`, password, email_confirm: true, user_metadata: { username, name },
    })
    if (error || !created.user) return json({ error: error?.message || 'Could not create the login.' }, 400)
    const { error: staffError } = await admin.from('staff').insert({ user_id: created.user.id, name, role, username })
    if (staffError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: staffError.message }, 400)
    }
    return json({ ok: true })
  }

  if (body.action === 'reset_password') {
    if (!goodPassword) return json({ error: 'Passwords need at least 8 characters.' }, 400)
    const { data: target } = await admin.from('staff').select('user_id').eq('user_id', body.user_id).maybeSingle()
    if (!target) return json({ error: 'That person is not on the staff list.' }, 404)
    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password })
    return error ? json({ error: error.message }, 400) : json({ ok: true })
  }

  if (body.action === 'remove') {
    if (body.user_id === user.id) return json({ error: 'You cannot remove your own login.' }, 400)
    const { data: target } = await admin.from('staff').select('user_id').eq('user_id', body.user_id).maybeSingle()
    if (!target) return json({ error: 'That person is not on the staff list.' }, 404)
    const { error } = await admin.auth.admin.deleteUser(target.user_id) // staff row goes with it (on delete cascade)
    return error ? json({ error: error.message }, 400) : json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
