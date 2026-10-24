import { useState } from 'react'
import { supabase } from '../supabase.js'
import { syncInvoiceTotals } from '../orders.js'
import { ErrorNote } from './ui.jsx'

// Every part a job needs: its own parts plus the parts inside its products (e.g. a 2 m³ skip).
export function jobParts(job) {
  const own = (job.mats || []).map((m, i) => ({ key: `m${i}`, src: 'mats', i, name: m.name, qty: m.qty, supplied_by: m.supplied_by || 'NJR', have: Boolean(m.have), from: null }))
  const inProducts = (job.products || []).flatMap((pl, pi) => (pl.parts || []).map((pt, j) => ({
    key: `p${pi}-${j}`, src: 'products', pi, j, name: pt.name, qty: Number(pt.qty) * Number(pl.qty || 1),
    supplied_by: pt.supplied_by || 'NJR', have: Boolean(pt.have), from: `${pl.qty} × ${pl.name}`,
  })))
  return [...inProducts, ...own]
}

// Quick tick-list for the workshop: which parts are in, and who supplies each one.
export default function PartsChecklist({ job, toast, onClose, onSaved }) {
  const [mats, setMats] = useState(() => (job.mats || []).map((m) => ({ ...m, supplied_by: m.supplied_by || 'NJR' })))
  const [products, setProducts] = useState(() => (job.products || []).map((pl) => ({ ...pl, parts: (pl.parts || []).map((pt) => ({ ...pt })) })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const rows = jobParts({ mats, products })
  const changedSupplier = mats.some((m, i) => m.supplied_by !== ((job.mats[i] || {}).supplied_by || 'NJR'))

  function set(row, patch) {
    if (row.src === 'mats') setMats(mats.map((m, k) => (k === row.i ? { ...m, ...patch } : m)))
    else setProducts(products.map((pl, k) => (k !== row.pi ? pl : { ...pl, parts: pl.parts.map((pt, j) => (j === row.j ? { ...pt, ...patch } : pt)) })))
  }

  async function save() {
    setBusy(true); setError(null)
    const { data, error } = await supabase.from('jobs').update({ mats, products, updated_at: new Date().toISOString() }).eq('id', job.id).select().single()
    if (error) { setError(error); setBusy(false); return }
    const updated = changedSupplier ? await syncInvoiceTotals(data) : data
    setBusy(false); toast(`Parts updated: ${rows.filter((r) => r.have).length} of ${rows.length} in`); onSaved(updated)
  }

  let lastFrom = undefined
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="block-head"><div><h3 style={{ fontSize: '1.6rem', textTransform: 'uppercase' }}>Parts</h3>
          <span className="hint">{job.quote_no} · {job.customer} · {job.title}</span></div>
          <button className="btn small" type="button" onClick={onClose}>Close</button></div>
        <ErrorNote error={error} />
        <div className="tbl-wrap"><table>
          <thead><tr><th>Have it</th><th>Part</th><th className="r">Qty</th><th>Supplied by</th></tr></thead>
          <tbody>{rows.map((r) => {
            const header = r.from !== lastFrom ? (lastFrom = r.from, <tr key={`h-${r.key}`}><td colSpan="4" className="label" style={{ color: 'var(--accent-hi)' }}>{r.from || 'Other parts for this job'}</td></tr>) : null
            return [header,
              <tr key={r.key} className={r.supplied_by === 'Client' ? 'client-part' : ''}>
                <td><input type="checkbox" checked={r.have} onChange={(e) => set(r, { have: e.target.checked })} aria-label={`Have ${r.name}`} style={{ width: 22, height: 22 }} /></td>
                <td>{r.name || <span className="hint">(no name)</span>}</td>
                <td className="r num">{r.qty}</td>
                <td>{r.src === 'mats'
                  ? <select aria-label="Supplied by" value={r.supplied_by} onChange={(e) => set(r, { supplied_by: e.target.value })} style={{ width: 'auto' }}><option value="NJR">NJR</option><option value="Client">Client</option></select>
                  : <span className="hint">NJR</span>}</td>
              </tr>]
          })}</tbody>
        </table></div>
        {changedSupplier && job.invoice_no && <p className="hint" style={{ color: 'var(--warn)' }}>Changing who supplies a part changes the invoice total.</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          <span className="hint" style={{ alignSelf: 'center' }}>To add or price parts, open the job's costing.</span>
        </div>
      </div>
    </div>
  )
}
