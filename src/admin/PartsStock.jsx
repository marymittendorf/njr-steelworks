import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, money0, shortDate } from '../format.js'
import { ErrorNote, matches } from './ui.jsx'
import PurchaseImport from './PurchaseImport.jsx'

const blank = { id: '', name: '', unit: 'each', cost: '', kg: '', qty: '' }
const CALC_CODES = 'sq50, sq40, sq20, rhs76, ang40, ang50, ch100, fb50, sh16, sh2, sh45, chq3, mesh, axle, spring, wheel, coupler, jockey, lights, guards, reflect, lugs, paint, gate_hinge, gate_slide'

// Parts & materials: the price list and the stock in one table. Cost is what you pay (excl. VAT),
// On hand is how many you have. Buying (invoice upload or typed in) updates both.
export default function PartsStock({ q = '', prices, reload, syncFromPrices, me, toast }) {
  const [purchases, setPurchases] = useState([])
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(null) // 'file' | 'manual'
  const [showBuys, setShowBuys] = useState(false)
  const [adding, setAdding] = useState(null)

  const loadBuys = () => supabase.from('purchases').select('*, purchase_lines(description, qty, unit_cost)').order('invoice_date', { ascending: false }).limit(50)
    .then(({ data, error }) => { setPurchases(data || []); if (error) setError(error) })
  useEffect(() => { loadBuys() }, [])

  async function saveRow(p, patch, msg) {
    const { error } = await supabase.from('prices').update(patch).eq('id', p.id)
    if (error) { setError(error); return }
    await (syncFromPrices || reload)()
    toast(msg)
  }

  async function addItem(e) {
    e.preventDefault()
    const id = (adding.id.trim() || adding.name).toLowerCase().replace(/[^a-z0-9_]+/g, '').slice(0, 24)
    if (!id || !adding.name.trim()) { setError('Give the new item a name.'); return }
    if (prices.some((p) => p.id === id)) { setError(`The code "${id}" is already used. Type a different short code.`); return }
    const sort = Math.max(0, ...prices.map((p) => p.sort)) + 10
    const { error } = await supabase.from('prices').insert({ id, name: adding.name.trim(), unit: adding.unit.trim() || 'each', cost: n(adding.cost), kg: n(adding.kg), qty_on_hand: n(adding.qty), sort })
    if (error) { setError(error); return }
    setAdding(null); setError(null); await reload(); toast('Item added')
  }

  async function openInvoice(path) {
    const { data } = await supabase.storage.from('expense-docs').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  const value = prices.reduce((a, p) => a + n(p.qty_on_hand) * n(p.cost), 0)
  const needle = q.trim().toLowerCase()
  const shown = prices.filter((p) => matches(needle, p.name, p.id, p.notes, p.unit))

  return (
    <div className="block">
      <div className="block-head">
        <div><h3 style={{ fontSize: '1.6rem' }}>Parts &amp; materials</h3>
          <span className="hint">{prices.length} items · stock on hand worth {money0(value)} excl. VAT. Cost is what you pay; new quotes use it.</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" type="button" onClick={() => setImporting('file')}>Upload purchase invoice</button>
          <button className="btn" type="button" onClick={() => setImporting('manual')}>Type in a purchase</button>
          {!adding && <button className="btn ghost" type="button" onClick={() => setAdding({ ...blank })}>Add an item</button>}
        </div>
      </div>
      <ErrorNote error={error} />

      {adding && (
        <form className="card block" onSubmit={addItem}>
          <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Square tube 50×50×2 mm" /></div>
            <div className="field"><label htmlFor="a-unit">Unit</label><input id="a-unit" value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value })} placeholder="each, 6 m length, sheet, box…" /></div>
            <div className="field"><label htmlFor="a-id">Short code (optional)</label><input id="a-id" value={adding.id} onChange={(e) => setAdding({ ...adding, id: e.target.value })} placeholder="e.g. sq50" /></div>
            <div className="field"><label htmlFor="a-cost">Cost excl. VAT (R)</label><input id="a-cost" type="number" min="0" step="0.01" value={adding.cost} onChange={(e) => setAdding({ ...adding, cost: e.target.value })} /></div>
            <div className="field"><label htmlFor="a-qty">On hand now</label><input id="a-qty" type="number" min="0" step="0.5" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} /></div>
            <div className="field"><label htmlFor="a-kg">Mass per unit (kg, optional)</label><input id="a-kg" type="number" min="0" step="0.1" value={adding.kg} onChange={(e) => setAdding({ ...adding, kg: e.target.value })} /><span className="hint">Only needed for galvanising</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn primary" type="submit">Add item</button><button className="btn ghost" type="button" onClick={() => setAdding(null)}>Cancel</button></div>
        </form>
      )}

      <div className="tbl-wrap"><table>
        <thead><tr><th>Item</th><th>Unit</th><th className="r">On hand</th><th className="r">Cost excl. VAT</th><th className="r">Value</th><th className="r">Mass (kg)</th><th>In use</th></tr></thead>
        <tbody>{shown.map((p) => (
          <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
            <td>{p.name} <span className="hint">· {p.id}</span>{p.notes && <div className="hint" style={{ fontSize: '.8rem' }}>{p.notes}</div>}</td>
            <td className="hint">{p.unit}</td>
            <td className="r"><input className="qty num" aria-label={`On hand: ${p.name}`} type="number" step="0.5" defaultValue={n(p.qty_on_hand)}
              onBlur={(e) => n(e.target.value) !== n(p.qty_on_hand) && saveRow(p, { qty_on_hand: n(e.target.value) }, `${p.name}: ${n(e.target.value)} on hand`)} /></td>
            <td className="r"><input className="money num" aria-label={`Cost of ${p.name}`} type="number" min="0" step="0.01" defaultValue={p.cost}
              onBlur={(e) => n(e.target.value) !== n(p.cost) && saveRow(p, { cost: n(e.target.value) }, 'Cost updated')} /></td>
            <td className="r num">{money(n(p.qty_on_hand) * n(p.cost))}</td>
            <td className="r"><input className="qty num" aria-label={`Mass of ${p.name}`} type="number" min="0" step="0.1" defaultValue={p.kg}
              onBlur={(e) => n(e.target.value) !== n(p.kg) && saveRow(p, { kg: n(e.target.value) }, 'Mass updated')} /></td>
            <td><label className="check"><input type="checkbox" checked={p.active} onChange={(e) => saveRow(p, { active: e.target.checked }, e.target.checked ? 'Back in use' : 'Hidden from new quotes')} /> {p.active ? 'Yes' : 'Hidden'}</label></td>
          </tr>))}
          {!shown.length && <tr><td colSpan="7" className="hint">{prices.length ? 'No item matches your search.' : 'No items yet.'}</td></tr>}
        </tbody>
      </table></div>
      <p className="hint">Change "On hand" after a stock count or when parts are used. The website's instant price calculator uses items with these short codes: {CALC_CODES}.</p>

      {purchases.length > 0 && <>
        <div className="block-head"><h3>Purchases</h3><button className="linkbtn" type="button" onClick={() => setShowBuys(!showBuys)}>{showBuys ? 'Hide' : `Show ${purchases.length}`}</button></div>
        {showBuys && <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th className="r">Total</th><th>Invoice</th></tr></thead>
          <tbody>{purchases.map((b) => (
            <tr key={b.id}>
              <td className="num">{shortDate(b.invoice_date)}</td>
              <td>{b.supplier}{b.invoice_no && <div className="hint">{b.invoice_no}</div>}</td>
              <td className="hint">{(b.purchase_lines || []).map((l) => `${n(l.qty)} × ${l.description}`).join(', ')}</td>
              <td className="r num">{money(b.total)}</td>
              <td>{b.file_path ? <button className="linkbtn" type="button" onClick={() => openInvoice(b.file_path)}>View</button> : '—'}</td>
            </tr>))}</tbody>
        </table></div>}
      </>}

      {importing && <PurchaseImport manual={importing === 'manual'} prices={prices} me={me} toast={toast} onClose={() => setImporting(null)}
        onSaved={async () => { setImporting(null); await reload(); loadBuys() }} />}
    </div>
  )
}
