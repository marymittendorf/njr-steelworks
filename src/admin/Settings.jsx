import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n, computeFromPrices } from '../costing.js'
import { money0 } from '../format.js'
import { SERVICES } from '../services.js'
import { ErrorNote } from './ui.jsx'

const RATE_FIELDS = [
  ['labour', 'Labour rate (R/hour)', 'Workshop rate per welder-hour'],
  ['consumables', 'Consumables (R/hour)', 'Wire, gas, discs, electricity'],
  ['overhead', 'Workshop overhead (%)', 'Rent, tools, vehicle, admin'],
  ['markup', 'Default markup (%)', 'On total cost, for new quotes'],
  ['vat', 'VAT (%)', 'South Africa: 15%'],
  ['galv', 'Galvanising (R/kg)', 'Outsourced hot-dip rate'],
  ['validity', 'Quote valid (days)', 'Printed on quotes'],
  ['deposit', 'Deposit (%)', 'Required to book work'],
]

export default function Settings({ settings, prices, syncFromPrices, toast }) {
  const [f, setF] = useState(() => ({
    ...settings,
    people: settings.people.map((p) => ({ ...p })),
    web: Object.fromEntries(SERVICES.map((s) => {
      const cur = settings.from_prices?.[s.key]
      return [s.key, { label: cur?.label || s.defaultLabel, price: cur?.price ?? '' }]
    })),
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const setPerson = (i, k, v) => setF({ ...f, people: f.people.map((p, j) => (j === i ? { ...p, [k]: v } : p)) })
  const setWeb = (key, k, v) => setF({ ...f, web: { ...f.web, [key]: { ...f.web[key], [k]: v } } })
  // What the costing templates come to with today's rates, as a guide only.
  const suggested = computeFromPrices(f, prices.filter((p) => p.active))

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const patch = Object.fromEntries(RATE_FIELDS.map(([k]) => [k, n(f[k])]))
    patch.people = f.people.filter((p) => p.name.trim())
    patch.bank_details = f.bank_details
    patch.ai_estimator_enabled = Boolean(f.ai_estimator_enabled)
    patch.ai_daily_limit = Math.max(0, Math.round(n(f.ai_daily_limit)))
    patch.ai_per_visitor_daily = Math.max(1, Math.round(n(f.ai_per_visitor_daily)))
    patch.from_prices = Object.fromEntries(SERVICES.map((s) => {
      const w = f.web[s.key]
      return [s.key, { label: w.label.trim() || s.defaultLabel, price: n(w.price) > 0 ? Math.round(n(w.price)) : null }]
    }))
    patch.updated_at = new Date().toISOString()
    const { error } = await supabase.from('settings').update(patch).eq('id', 1)
    if (error) { setError(error); setBusy(false); return }
    await syncFromPrices()
    setBusy(false); setError(null); toast('Settings saved')
  }

  return (
    <form onSubmit={save}>
      <div className="pagehead">
        <div><h1>Rates &amp; settings</h1><p>Website prices, costing rates, contact people and banking details. Saved quotes keep their own rates.</p></div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
      <ErrorNote error={error} />

      <div className="block-head"><h3>Website prices</h3><span className="hint">The "from" price on each service card, incl. VAT. Leave the price empty to show "Ask for a quote".</span></div>
      <div className="tbl-wrap block"><table>
        <thead><tr><th>Card</th><th>Wording before the price</th><th className="r">Price incl. VAT (R)</th></tr></thead>
        <tbody>
          {SERVICES.map((s) => (
            <tr key={s.key}>
              <td><b>{s.h}</b>{suggested[s.key] && <div className="hint" style={{ fontSize: '.8rem' }}>Costing comes to about {money0(suggested[s.key])}</div>}</td>
              <td><input aria-label={`Wording for ${s.h}`} value={f.web[s.key].label} onChange={(e) => setWeb(s.key, 'label', e.target.value)} /></td>
              <td className="r"><input className="money num" aria-label={`Price for ${s.h}`} type="number" min="0" step="100" value={f.web[s.key].price} onChange={(e) => setWeb(s.key, 'price', e.target.value)} placeholder="Ask for a quote" style={{ width: 150 }} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <AiSettings f={f} setF={setF} />

      <div className="block-head"><h3>Costing rates</h3></div>
      <div className="card block"><div className="fgrid">
        {RATE_FIELDS.map(([k, label, hint]) => (
          <div className="field" key={k}><label htmlFor={`s-${k}`}>{label}</label>
            <input id={`s-${k}`} className="num" type="number" step="0.5" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            <span className="hint">{hint}</span></div>
        ))}
      </div></div>

      <div className="block-head"><h3>Contact people</h3><span className="hint">Shown on the website and on quotes</span></div>
      <div className="card block">
        {f.people.map((p, i) => (
          <div className="fgrid people-row" key={i}>
            <div className="field"><label htmlFor={`p-n${i}`}>Name</label><input id={`p-n${i}`} value={p.name} onChange={(e) => setPerson(i, 'name', e.target.value)} /></div>
            <div className="field"><label htmlFor={`p-r${i}`}>Role</label><input id={`p-r${i}`} value={p.role} onChange={(e) => setPerson(i, 'role', e.target.value)} /></div>
            <div className="field"><label htmlFor={`p-p${i}`}>Cell</label><input id={`p-p${i}`} value={p.phone} onChange={(e) => setPerson(i, 'phone', e.target.value)} /></div>
            <div className="field"><label htmlFor={`p-e${i}`}>Email</label><input id={`p-e${i}`} type="email" value={p.email || ''} onChange={(e) => setPerson(i, 'email', e.target.value)} /></div>
            <button className="x" type="button" aria-label={`Remove ${p.name}`} onClick={() => setF({ ...f, people: f.people.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn small" type="button" onClick={() => setF({ ...f, people: [...f.people, { name: '', role: '', phone: '', email: '' }] })}>Add person</button>
      </div>

      <div className="block-head"><h3>Banking details</h3><span className="hint">Printed at the bottom of quotes and invoices</span></div>
      <div className="card">
        <textarea aria-label="Banking details" value={f.bank_details} onChange={(e) => setF({ ...f, bank_details: e.target.value })}
          placeholder={'Bank: …\nAccount name: NJR Steelworks\nAccount no: …\nBranch code: …'} />
      </div>
    </form>
  )
}

// AI instant estimator: on/off, limits, and what it has cost (from ai_estimate_log).
function AiSettings({ f, setF }) {
  const [use, setUse] = useState(null)
  useEffect(() => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    supabase.from('ai_estimate_log').select('ok,cost_usd').gte('created_at', since)
      .then(({ data }) => setUse({ count: data?.length || 0, ok: (data || []).filter((d) => d.ok).length, usd: (data || []).reduce((a, d) => a + n(d.cost_usd), 0) }))
  }, [])
  return (
    <>
      <div className="block-head"><h3>Instant estimate (AI)</h3><span className="hint">Visitors describe a job on the website and get a price range from your price list and rates</span></div>
      <div className="card block"><div className="fgrid">
        <div className="field"><span className="flabel">On the website</span>
          <label className="check"><input type="checkbox" checked={Boolean(f.ai_estimator_enabled)} onChange={(e) => setF({ ...f, ai_estimator_enabled: e.target.checked })} /> Show "Instant estimate"</label>
          <span className="hint">Needs the ANTHROPIC_API_KEY secret in Supabase first.</span></div>
        <div className="field"><label htmlFor="ai-cap">Most estimates per day (whole site)</label><input id="ai-cap" type="number" min="0" step="1" value={f.ai_daily_limit} onChange={(e) => setF({ ...f, ai_daily_limit: e.target.value })} /></div>
        <div className="field"><label htmlFor="ai-per">Most per visitor per day</label><input id="ai-per" type="number" min="1" step="1" value={f.ai_per_visitor_daily} onChange={(e) => setF({ ...f, ai_per_visitor_daily: e.target.value })} /></div>
        <div className="field"><span className="flabel">Last 30 days</span>
          <span className="num">{use ? `${use.count} estimate${use.count === 1 ? '' : 's'} (${use.ok} priced) · about $${use.usd.toFixed(2)}` : '…'}</span>
          <span className="hint">Usually R1 to R2 per estimate.</span></div>
      </div></div>
    </>
  )
}
