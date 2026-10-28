// Reads a supplier slip or invoice (phone photo or PDF) with Google Gemini and returns the
// supplier, date, number, totals and each item line, for the purchase upload screen to fill in.
// Staff only. The free Gemini tier is plenty for a few slips a week.
//
// Secrets: GEMINI_API_KEY (from aistudio.google.com → Get API key). Optional: GEMINI_MODEL.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'
const FALLBACK = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-flash-lite-latest'
const MAX_BYTES = 8 * 1024 * 1024

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// What Gemini must return.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier: { type: 'STRING', description: 'Business that issued the slip, e.g. "JMR Transport Solutions". Empty if not shown.' },
    invoice_no: { type: 'STRING', description: 'Invoice, slip or receipt number. Empty if not shown.' },
    date: { type: 'STRING', description: 'Date on the slip as YYYY-MM-DD. Empty if not shown.' },
    prices_include_vat: { type: 'BOOLEAN', description: 'true if the item prices shown already include VAT (usual on till slips)' },
    vat: { type: 'NUMBER', description: 'VAT amount on the slip in rand, 0 if none shown' },
    total: { type: 'NUMBER', description: 'Amount due / total on the slip in rand' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          desc: { type: 'STRING', description: 'Item name as a person would say it, without stock codes, e.g. "Tow hitch 50 mm"' },
          qty: { type: 'NUMBER' },
          unit_price: { type: 'NUMBER', description: 'Price for one, as printed (after any line discount)' },
          line_total: { type: 'NUMBER', description: 'Line amount as printed' },
        },
        required: ['desc', 'qty', 'unit_price', 'line_total'],
      },
    },
  },
  required: ['supplier', 'invoice_no', 'date', 'prices_include_vat', 'vat', 'total', 'items'],
}

const PROMPT = `This is a South African supplier slip, till receipt or invoice for parts bought by a steel workshop. It may be a phone photo: sideways, creased or shadowed.
Read every item line that was bought. Skip totals, VAT, change, card or cash lines, deposits, policies and signatures.
On till slips the item name is sometimes on its own line above or below the code and amounts: join them into one item.
Amounts are in rand; "1 234,50" and "1,234.50" both mean 1234.50. If a quantity isn't printed, it is 1.
If something can't be read, leave that field empty or 0 rather than guessing.`

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
  if (!staff) return json({ error: 'Only NJR staff can read slips.' }, 403)

  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: "Slip reading isn't switched on yet. Add GEMINI_API_KEY under Supabase → Edge Functions → Secrets.", notConfigured: true }, 503)

  const { data, mime } = await req.json().catch(() => ({}))
  if (typeof data !== 'string' || !/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime || '')) return json({ error: 'Send a photo or a PDF.' }, 400)
  if (data.length * 0.75 > MAX_BYTES) return json({ error: 'That file is too big. Take the photo again or send a smaller PDF.' }, 413)

  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  })
  // The free tier is often "busy" (503) or briefly over its limit (429): wait and retry, then try the lighter model.
  let res = new Response(), out
  for (const [model, wait] of [[MODEL, 0], [MODEL, 2000], [FALLBACK, 0], [FALLBACK, 3000]] as const) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    })
    out = await res.json().catch(() => null)
    if (res.ok || ![429, 500, 503].includes(res.status)) break
    console.error('Gemini', model, res.status, 'retrying')
  }
  if (!res.ok) {
    console.error('Gemini', res.status, JSON.stringify(out))
    const busy = [429, 503].includes(res.status)
    return json({ error: busy ? "Google's slip reader is busy right now. Wait a minute and upload the slip again." : 'The slip reader had a problem. Try again, or type the items in.' }, busy ? 429 : 502)
  }
  const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || ''
  try {
    return json(JSON.parse(text))
  } catch {
    console.error('Gemini returned', text.slice(0, 500))
    return json({ error: "The slip reader couldn't read this one. Try a closer photo, or type the items in." }, 502)
  }
})
