import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { money0 } from '../format.js'

// Which quote-request type a product category becomes when the customer sends it to NJR.
const REQUEST_TYPE = { Skips: 'New skip', Trailers: 'New trailer' }

// Free instant price: the finished products NJR has priced and ticked "show on website"
// (from public_products(), selling prices only) → pick one, options and how many → send to NJR.
export default function InstantCalc() {
  const [products, setProducts] = useState(null)
  const [cat, setCat] = useState('')
  const [pick, setPick] = useState({ id: '', options: [], qty: 1 })
  const [contact, setContact] = useState({ name: '', phone: '', email: '', note: '' })
  const [state, setState] = useState({ busy: false, error: '', sent: false })

  useEffect(() => {
    supabase.rpc('public_products').then(({ data }) => {
      const list = data || []
      setProducts(list)
      if (list.length) { setCat(list[0].category); setPick({ id: list[0].id, options: [], qty: 1 }) }
    })
  }, [])

  if (!products?.length) return null // nothing priced for the website yet

  const cats = [...new Set(products.map((p) => p.category))]
  const inCat = products.filter((p) => p.category === cat)
  const product = products.find((p) => p.id === pick.id) || inCat[0]
  const chosen = (product.options || []).filter((o) => pick.options.includes(o.name))
  const each = Number(product.price) + chosen.reduce((a, o) => a + Number(o.price), 0)
  const total = each * pick.qty
  const reset = () => setState({ busy: false, error: '', sent: false })
  const choose = (patch) => { setPick({ ...pick, ...patch }); reset() }

  async function send() {
    const name = contact.name.trim()
    const phone = contact.phone.trim()
    if (!name || phone.replace(/\D/g, '').length < 9) { setState({ busy: false, error: 'Add your name and a cell number so we can confirm the price with you.', sent: false }); return }
    setState({ busy: true, error: '', sent: false })
    const line = `${pick.qty} × ${product.name}${chosen.length ? ` (${chosen.map((o) => o.name).join(', ')})` : ''}`
    const note = contact.note.trim()
    const { error } = await supabase.from('requests').insert({
      name, phone, email: contact.email.trim() || null,
      type: REQUEST_TYPE[product.category] || 'Custom fabrication',
      detail: `${line}: ${money0(total)} incl. VAT${note ? `\n\n${note}` : ''}`,
      timing: 'Instant price', status: 'New', source: 'Calculator',
      ai_estimate: {
        confidence: 'products', title: line, total, low: total, high: total,
        products: [{ product_id: product.id, name: product.name, qty: pick.qty, options: chosen.map((o) => o.name), price_incl: each }],
      },
    })
    if (error) { setState({ busy: false, error: 'We couldn\'t send that through. Please try again, or call us.', sent: false }); return }
    setState({ busy: false, error: '', sent: true })
  }

  return (
    <div className="card calc" id="price">
      <div className="block-head" style={{ marginBottom: 6 }}>
        <h2 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', textTransform: 'uppercase' }}>Instant price</h2>
        {cats.length > 1 && (
          <div className="seg-tabs" role="tablist" aria-label="What are you pricing?">
            {cats.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={cat === c}
                onClick={() => { const first = products.find((p) => p.category === c); setCat(c); choose({ id: first.id, options: [] }) }}>{c}</button>
            ))}
          </div>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Pick what you need and see the price straight away, incl. VAT. Nico or Jeanette confirm and book it in.</p>

      <div className="fgrid calc-grid">
        <div className="field"><label htmlFor="ic-product">Item</label>
          <select id="ic-product" value={product.id} onChange={(e) => choose({ id: e.target.value, options: [] })}>
            {inCat.map((p) => <option key={p.id} value={p.id}>{p.name}: {money0(p.price)}</option>)}
          </select></div>
        <div className="field"><label htmlFor="ic-qty">How many</label>
          <input id="ic-qty" type="number" min="1" max="20" step="1" value={pick.qty} onChange={(e) => choose({ qty: Math.max(1, Math.min(20, Math.round(Number(e.target.value)) || 1)) })} /></div>
        {product.options?.length > 0 && (
          <div className="field"><span className="flabel">Extras</span>
            {product.options.map((o) => (
              <label className="check" key={o.name}><input type="checkbox" checked={pick.options.includes(o.name)}
                onChange={(e) => choose({ options: e.target.checked ? [...pick.options, o.name] : pick.options.filter((x) => x !== o.name) })} /> {o.name} <span className="hint">+{money0(o.price)}</span></label>
            ))}</div>
        )}
      </div>

      <div className="ai-result" style={{ marginTop: 16 }}>
        <span className="label">Price{pick.qty > 1 ? ` for ${pick.qty}` : ''}, incl. VAT</span>
        <div className="ai-range num">{money0(total)}</div>
        {pick.qty > 1 && <span className="hint">{money0(each)} each</span>}

        {state.sent ? (
          <p className="okmsg">Sent. Nico or Jeanette will call you on {contact.phone} to confirm and book it in.</p>
        ) : (
          <div className="calc-send">
            <b>Happy with this? Send it to us to confirm and book.</b>
            <div className="fgrid" style={{ marginTop: 8 }}>
              <div className="field"><label htmlFor="ic-name">Your name</label><input id="ic-name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" maxLength={120} /></div>
              <div className="field"><label htmlFor="ic-phone">Cell number</label><input id="ic-phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} inputMode="tel" autoComplete="tel" maxLength={30} /></div>
              <div className="field"><label htmlFor="ic-email">Email (optional)</label><input id="ic-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" maxLength={200} /></div>
              <div className="field"><label htmlFor="ic-note">Anything else? (optional)</label><input id="ic-note" value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} maxLength={1000} placeholder="e.g. need it by month-end" /></div>
            </div>
            {state.error && <div className="errmsg">{state.error}</div>}
            <div style={{ marginTop: 12 }}>
              <button className="btn primary" type="button" disabled={state.busy} onClick={send}>{state.busy ? 'Sending…' : 'Send to NJR'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
