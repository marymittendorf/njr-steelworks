import { useState } from 'react'
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
          <div className="fgrid" key={i} style={{ gridTemplateColumns: '1fr 1fr 1fr auto', marginBottom: 10, alignItems: 'end' }}>
            <div className="field"><label htmlFor={`p-n${i}`}>Name</label><input id={`p-n${i}`} value={p.name} onChange={(e) => setPerson(i, 'name', e.target.value)} /></div>
            <div className="field"><label htmlFor={`p-r${i}`}>Role</label><input id={`p-r${i}`} value={p.role} onChange={(e) => setPerson(i, 'role', e.target.value)} /></div>
            <div className="field"><label htmlFor={`p-p${i}`}>Cell</label><input id={`p-p${i}`} value={p.phone} onChange={(e) => setPerson(i, 'phone', e.target.value)} /></div>
            <button className="x" type="button" aria-label={`Remove ${p.name}`} onClick={() => setF({ ...f, people: f.people.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn small" type="button" onClick={() => setF({ ...f, people: [...f.people, { name: '', role: '', phone: '' }] })}>Add person</button>
      </div>

      <div className="block-head"><h3>Banking details</h3><span className="hint">Printed at the bottom of quotes and invoices</span></div>
      <div className="card">
        <textarea aria-label="Banking details" value={f.bank_details} onChange={(e) => setF({ ...f, bank_details: e.target.value })}
          placeholder={'Bank: …\nAccount name: NJR Steelworks\nAccount no: …\nBranch code: …'} />
      </div>
    </form>
  )
}
