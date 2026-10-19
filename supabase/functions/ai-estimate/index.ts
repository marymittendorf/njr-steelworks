// AI price estimator for website visitors.
// Claude reads the customer's description and picks materials (from NJR's own steel price
// list), labour hours and extras, the way staff do on the costing screen. The price is then
// worked out here with NJR's own rates, overhead, markup and VAT, not by the AI.
// The result is saved as a website request (source "AI estimate") for staff to confirm.
//
// Secrets: ANTHROPIC_API_KEY (from console.anthropic.com). Optional: ESTIMATE_SALT.
// Public endpoint (verify_jwt off): protected by the on/off switch, a daily cap and a
// per-visitor cap in settings, plus input limits.
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.135.0/helpers/zod'
import { z } from 'npm:zod@3.25.76'

const MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 5 / 1e6 } // USD per token

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const TYPES = ['New trailer', 'Trailer repair', 'New skip', 'Skip repair', 'Custom fabrication']

// What Claude must return. Prices are NOT part of this: they're calculated below.
const Estimate = z.object({
  can_estimate: z.boolean().describe('false if this is not steel work NJR does, or far too vague to price'),
  title: z.string().describe('Short job description for the quote, e.g. "3.0 × 1.5 m utility trailer with mesh cage"'),
  units: z.number().int().describe('Number of identical items the customer wants (1 if not said)'),
  galvanise: z.boolean().describe('true only if the customer asked for galvanising'),
  materials: z.array(z.object({
    id: z.string().describe('Exact id from the price list'),
    qty: z.number().describe('Quantity for ONE unit, in the price list unit (e.g. number of 6 m lengths or sheets)'),
  })),
  labour: z.array(z.object({ task: z.string(), hours: z.number() })).describe('Workshop hours for ONE unit'),
  extras: z.array(z.object({ desc: z.string(), amount: z.number().describe('Cost to NJR in rand excl. VAT') }))
    .describe('Things not on the price list, e.g. delivery, special hardware'),
  assumptions: z.array(z.string()).describe('Plain-language assumptions the customer should check, max 5'),
  questions: z.array(z.string()).describe('What NJR would need to ask to firm up the price, max 3'),
  confidence: z.enum(['low', 'medium', 'high']),
})

type Price = { id: string; name: string; unit: string; cost: number; kg: number }

function systemPrompt(prices: Price[]) {
  const list = prices.map((p) => `${p.id} | ${p.name} | per ${p.unit} | ${p.kg} kg`).join('\n')
  return `You estimate steel fabrication jobs for NJR Steelworks, a welding and fabrication workshop in George, Western Cape, South Africa. They build and repair utility trailers and builder's skips (2 m³ and 3 m³), and do custom fabrication, welding, gates and steel structures.

A website visitor describes what they want. Work out the bill of materials and workshop labour the way an experienced fabricator in that workshop would. You do not set prices: NJR's system prices your materials, hours and extras with its own rates.

Rules:
- Only use material ids from the price list below, with quantities in the list's units (6 m lengths, sheets, each, pairs, sets, kits). Allow for offcuts: round lengths and sheets up.
- Materials and labour are for ONE unit; put the number of identical items in units.
- Labour covers cutting, welding, fitting, wiring and painting. Be realistic for a small workshop with MIG welding.
- Anything not on the list (special hardware, delivery outside George, outsourced laser cutting) goes in extras as NJR's cost excl. VAT, in rand.
- Repairs: only the materials and hours for the repair, not a whole new build.
- Use dimensions the customer gives. If none are given, assume the most common size and say so in assumptions.
- If it isn't steel work NJR does, or is too vague to price at all, set can_estimate to false and ask your questions.
- Assumptions and questions: short, plain English for a customer, no jargon. Never mention ids, kilograms or markup.

Reference builds (one unit):
- 3.0 × 1.5 m utility trailer with mesh cage: sq50 ×5, sq40 ×4, rhs76 ×2, sh2 ×2, mesh ×4, ang40 ×2, axle, spring pair, wheel ×2, coupler, jockey, lights, guards, reflect, paint; about 26 hours.
- 2 m³ builder's skip, new: sh45 ×3, ch100 ×1, ang50 ×2, fb50 ×1, lugs, paint; about 16 hours.
- 3 m³ builder's skip, new: sh45 ×4, ch100 ×1, ang50 ×3, fb50 ×2, lugs, paint; about 20 hours.
- Skip floor replacement: sh45 ×2, ang50 ×1, paint; about 11 hours.
- Trailer chequer-plate floor and new lights: chq3 ×1, fb50 ×1, lights; about 7 hours.

Price list (id | item | unit | mass):
${list}`
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const name = String(b.name || '').trim().slice(0, 120)
  const phone = String(b.phone || '').trim().slice(0, 30)
  const email = String(b.email || '').trim().slice(0, 200) || null
  const type = TYPES.includes(String(b.type)) ? String(b.type) : 'Custom fabrication'
  const description = String(b.description || '').trim()
  if (!name || phone.replace(/\D/g, '').length < 9) return json({ error: 'Add your name and a cell number so we can confirm the price with you.' }, 400)
  if (description.length < 15) return json({ error: 'Tell us a bit more: what it is, the size, and what it\'s for.' }, 400)
  if (description.length > 2000) return json({ error: 'Please keep the description under 2 000 characters.' }, 400)

  const { data: s } = await db.from('settings').select('*').eq('id', 1).single()
  if (!s?.ai_estimator_enabled || !Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: 'Instant estimates are switched off at the moment. Send a quote request instead.', off: true }, 503)
  }

  // Limits: whole site per day, and per visitor per day (by hashed IP, never stored raw).
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const visitor = await sha256(ip + (Deno.env.get('ESTIMATE_SALT') || 'njr'))
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const [{ count: today }, { count: mine }] = await Promise.all([
    db.from('ai_estimate_log').select('id', { count: 'exact', head: true }).gte('created_at', since),
    db.from('ai_estimate_log').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('visitor', visitor),
  ])
  if ((today ?? 0) >= s.ai_daily_limit) return json({ error: 'We\'ve had a lot of estimate requests today. Send a quote request and we\'ll price it by hand.', limit: true }, 429)
  if ((mine ?? 0) >= s.ai_per_visitor_daily) return json({ error: 'You\'ve reached today\'s limit for instant estimates. Send a quote request and we\'ll price it by hand.', limit: true }, 429)

  const { data: priceRows } = await db.from('prices').select('id,name,unit,cost,kg').eq('active', true).order('sort')
  const prices = (priceRows || []) as Price[]
  const byId = Object.fromEntries(prices.map((p) => [p.id, p]))

  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  let est: z.infer<typeof Estimate> | null = null
  let usage: Record<string, number> = {}
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      cache_control: { type: 'ephemeral' }, // the price list prompt is the same for every visitor
      output_config: { effort: 'medium', format: zodOutputFormat(Estimate) },
      system: systemPrompt(prices),
      messages: [{ role: 'user', content: `Type of job: ${type}\n\nWhat the customer wrote:\n${description}` }],
    })
    usage = response.usage as unknown as Record<string, number>
    if (response.stop_reason === 'refusal') throw new Error('declined')
    est = response.parsed_output ?? null
  } catch (e) {
    await db.from('ai_estimate_log').insert({ visitor, ok: false, note: String((e as Error).message).slice(0, 300) })
    est = null
  }

  const cost = (usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output
    + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite

  // Price it with NJR's own costing (same maths as src/costing.js).
  let result: Record<string, unknown> | null = null
  if (est && est.can_estimate) {
    const units = Math.max(1, Math.min(50, Math.round(est.units || 1)))
    const mats = est.materials.filter((m) => byId[m.id] && m.qty > 0)
      .map((m) => ({ id: m.id, name: byId[m.id].name, unit: byId[m.id].unit, qty: Math.round(m.qty * 2) / 2, cost: Number(byId[m.id].cost), kg: Number(byId[m.id].kg) }))
    const labour = est.labour.filter((l) => l.hours > 0).map((l) => ({ task: l.task.slice(0, 80), hours: Math.round(l.hours * 2) / 2 }))
    const extras = est.extras.filter((x) => x.amount > 0).map((x) => ({ desc: x.desc.slice(0, 120), amount: Math.round(x.amount) }))
    const materials = mats.reduce((a, m) => a + m.qty * m.cost, 0)
    const kg = mats.reduce((a, m) => a + m.qty * m.kg, 0)
    const hours = labour.reduce((a, l) => a + l.hours, 0)
    const direct = (materials + (est.galvanise ? kg * s.galv : 0) + hours * (Number(s.labour) + Number(s.consumables)) + extras.reduce((a, x) => a + x.amount, 0)) * units
    const total = direct * (1 + s.overhead / 100) * (1 + s.markup / 100) * (1 + s.vat / 100)
    if (total > 0) {
      const spread = est.confidence === 'high' ? [0.92, 1.1] : est.confidence === 'medium' ? [0.88, 1.15] : [0.8, 1.25]
      const r100 = (v: number) => Math.round(v / 100) * 100
      result = {
        title: est.title.slice(0, 120), units, galv: est.galvanise, mats, labour, extras,
        total: Math.round(total), low: r100(total * spread[0]), high: r100(total * spread[1]),
        assumptions: est.assumptions.slice(0, 5), questions: est.questions.slice(0, 3), confidence: est.confidence,
        model: MODEL, markup: s.markup,
      }
    }
  }

  await db.from('ai_estimate_log').insert({
    visitor, ok: Boolean(result), input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null,
    cost_usd: Math.round(cost * 10000) / 10000, note: result ? null : est ? 'could not estimate' : 'no answer',
  })

  // Always save the lead, with or without a price, so NJR can follow up.
  await db.from('requests').insert({
    name, phone, email, type, detail: description, timing: 'Instant estimate', status: 'New', source: 'AI estimate',
    ai_estimate: result ?? { questions: est?.questions?.slice(0, 3) ?? [], failed: true },
  })

  if (!result) {
    return json({
      ok: false,
      message: 'We couldn\'t put a price on this from the description alone. We\'ve passed it to Nico and Jeanette, and they\'ll contact you.',
      questions: est?.questions?.slice(0, 3) ?? [],
    })
  }
  return json({ ok: true, title: result.title, units: result.units, low: result.low, high: result.high, assumptions: result.assumptions, questions: result.questions })
})
