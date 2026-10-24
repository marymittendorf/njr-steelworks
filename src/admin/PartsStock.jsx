import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, money0, shortDate } from '../format.js'
import { ErrorNote } from './ui.jsx'
import PurchaseImport from './PurchaseImport.jsx'

// Parts & materials on hand, filled from supplier invoices.
export default function PartsStock({ prices, me, toast }) {
  const [parts, setParts] = useState(null)
  const [purchases, setPurchases] = useState([])
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [showBuys, setShowBuys] = useState(false)
  const [q, setQ] = useState('')

  const load = async () => {
    const [p, b] = await Promise.all([
      supabase.from('stock_parts').select('*').order('name'),
      supabase.from('purchases').select('*, purchase_lines(description, qty, unit_cost)').order('invoice_date', { ascending: false }).limit(50),
    ])
    setParts(p.data || []); setPurchases(b.data || []); setError(p.error || b.error)
  }
  useEffect(() => { load() }, [])

  async function adjust(part, value) {
    const qty = n(value)
    if (qty === n(part.qty_on_hand)) return
    const { error } = await supabase.from('stock_parts').update({ qty_on_hand: qty }).eq('id', part.id)
    if (error) setError(error); else { toast(`${part.name}: ${qty} on hand`); load() }
  }

  async function openInvoice(path) {
    const { data } = await supabase.storage.from('expense-docs').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!parts) return null
  const value = parts.reduce((a, p) => a + n(p.qty_on_hand) * n(p.last_cost), 0)
  const needle = q.trim().toLowerCase()
  const shown = parts.filter((p) => !needle || p.name.toLowerCase().includes(needle))

  return (
    <div className="block">
      <div className="block-head">
        <div><h3 style={{ fontSize: '1.6rem' }}>Parts &amp; materials</h3>
          <span className="hint">{parts.length} items · stock value {money0(value)} excl. VAT</span></div>
        <button className="btn primary" type="button" onClick={() => setImporting(true)}>Upload purchase invoice</button>
      </div>
      <ErrorNote error={error} />
      {!parts.length ? <div className="card hint">Nothing yet. Upload a supplier invoice: the items are added here at the price you paid, and the purchase goes into Expenses.</div> : <>
        {parts.length > 8 && <input type="search" aria-label="Search parts" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts…" style={{ maxWidth: 300, marginBottom: 8 }} />}
        <div className="tbl-wrap"><table>
          <thead><tr><th>Item</th><th className="r">On hand</th><th>Unit</th><th className="r">Last paid (excl. VAT)</th><th className="r">Value</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.price_id && <div className="hint" style={{ fontSize: '.8rem' }}>On the price list ({p.price_id})</div>}</td>
              <td className="r"><input className="qty num" aria-label={`On hand: ${p.name}`} type="number" step="0.5" defaultValue={n(p.qty_on_hand)} onBlur={(e) => adjust(p, e.target.value)} /></td>
              <td className="hint">{p.unit}</td>
              <td className="r num">{p.last_cost != null ? money(p.last_cost) : '—'}</td>
              <td className="r num">{money(n(p.qty_on_hand) * n(p.last_cost))}</td>
            </tr>))}</tbody>
        </table></div>
        <p className="hint">Change "On hand" after a stock count or when parts are used.</p>
      </>}

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

      {importing && <PurchaseImport stockParts={[...parts]} prices={prices} me={me} toast={toast} onClose={() => setImporting(false)} onSaved={() => { setImporting(false); load() }} />}
    </div>
  )
}
