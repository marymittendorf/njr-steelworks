// Emails a quote or invoice PDF to a customer from NJR's own mailbox (cPanel SMTP at Cloudfusion).
// Staff only. Needs these Edge Function secrets, set in the Supabase dashboard:
//   SMTP_USER  e.g. jeanette@njrsteelworks.co.za   (the mailbox that sends)
//   SMTP_PASS  that mailbox's password
//   SMTP_HOST  optional, default mail.njrsteelworks.co.za ; port 465 (SSL)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'Your session has expired. Sign in again.' }, 401)
  const { data: staff } = await admin.from('staff').select('name').eq('user_id', user.id).maybeSingle()
  if (!staff) return json({ error: 'Only NJR staff can send documents.' }, 403)

  const smtpUser = Deno.env.get('SMTP_USER')
  const smtpPass = Deno.env.get('SMTP_PASS')
  if (!smtpUser || !smtpPass) {
    return json({ error: "Email sending isn't switched on yet. Add SMTP_USER and SMTP_PASS under Supabase → Edge Functions → Secrets.", notConfigured: true }, 503)
  }

  let b: Record<string, string>
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const to = String(b.to || '').trim()
  const subject = String(b.subject || '').trim().slice(0, 200)
  const message = String(b.message || '').slice(0, 5000)
  const kind = b.kind === 'Invoice' ? 'Invoice' : 'Quote'
  const filename = String(b.filename || `${kind}.pdf`).replace(/[^\w.-]+/g, '-').slice(0, 80)
  const pdf = String(b.pdf_base64 || '')
  if (!EMAIL.test(to)) return json({ error: 'That email address doesn\'t look right.' }, 400)
  if (!subject) return json({ error: 'Add a subject.' }, 400)
  if (!pdf || pdf.length > 7_000_000) return json({ error: 'The PDF is missing or too big to email.' }, 400)

  const { data: job } = await admin.from('jobs').select('id, status').eq('id', b.job_id).maybeSingle()
  if (!job) return json({ error: 'That quote no longer exists.' }, 404)

  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get('SMTP_HOST') || 'mail.njrsteelworks.co.za',
      port: 465,
      tls: true,
      auth: { username: smtpUser, password: smtpPass },
    },
  })
  try {
    await client.send({
      from: `NJR Steelworks <${smtpUser}>`,
      to,
      replyTo: user.email || smtpUser,
      bcc: smtpUser, // keep a copy in the sending mailbox
      subject,
      content: message,
      attachments: [{ filename, content: pdf, encoding: 'base64', contentType: 'application/pdf' }],
    })
  } catch (e) {
    return json({ error: `The mail server refused the email: ${(e as Error).message}` }, 502)
  } finally {
    try { await client.close() } catch { /* already closed */ }
  }

  await admin.from('job_emails').insert({ job_id: job.id, kind, sent_to: to, subject, sent_by: staff.name })
  if (kind === 'Quote' && job.status === 'Draft') {
    await admin.from('jobs').update({ status: 'Quote sent', updated_at: new Date().toISOString() }).eq('id', job.id)
  }
  return json({ ok: true })
})
