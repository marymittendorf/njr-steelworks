import { useState } from 'react'
import { supabase } from '../supabase.js'
import { syncInvoiceTotals } from '../orders.js'
import { customerLines, customPart, n } from '../costing.js'
import { shortDate } from '../format.js'
import { ErrorNote } from './ui.jsx'

// Every part a job needs: its own parts plus the parts inside its products (e.g. a 2 m³ skip).
export function jobParts(job) {
  const own = (job.mats || []).map((m, i) => ({ key: `m${i}`, src: 'mats', i, name: m.name, custom: m.custom, qty: m.qty, supplied_by: m.supplied_by || 'NJR', have: Boolean(m.have), from: null }))
  const inProducts = (job.products || []).flatMap((pl, pi) => (pl.parts || []).map((pt, j) => ({
    key: `p${pi}-${j}`, src: 'products', pi, j, name: pt.name, qty: Number(pt.qty) * Number(pl.qty || 1),
    supplied_by: pt.supplied_by || 'NJR', have: Boolean(pt.have), from: `${pl.qty} × ${pl.name}`,
  })))
  return [...inProducts, ...own]
}

const stamp = (iso) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })

// Job card for the workshop: the job, the work to do, notes (who and when), and every part with a
// tick for "we have it" and who supplies it (NJR buys it, or the client supplies it). Prints on one sheet.
export default function JobCard({ job, me, toast, onClose, onSaved }) {
  const [mats, setMats] = useState(() => (job.mats || []).map((m) => ({ ...m, supplied_by: m.supplied_by || 'NJR' })))
  const [products, setProducts] = useState(() => (job.products || []).map((pl) => ({ ...pl, parts: (pl.parts || []).map((pt) => ({ ...pt })) })))
  const [notes, setNotes] = useState(job.job_notes || [])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const rows = jobParts({ mats, products })
  const changedSupplier = mats.some((m, i) => n(m.cost) > 0 && m.supplied_by !== ((job.mats[i] || {}).supplied_by || 'NJR'))
  const work = job.rates ? customerLines(job) : []
  const have = rows.filter((r) => r.have).length
  const byClient = rows.filter((r) => r.supplied_by === 'Client').length

  function set(row, patch) {
    if (row.src === 'mats') setMats(mats.map((m, k) => (k === row.i ? { ...m, ...patch } : m)))
    else setProducts(products.map((pl, k) => (k !== row.pi ? pl : { ...pl, parts: pl.parts.map((pt, j) => (j === row.j ? { ...pt, ...patch } : pt)) })))
  }

  async function save(extra = {}, msg) {
    setBusy(true); setError(null)
    const clean = mats.filter((m) => !m.custom || String(m.name || '').trim())
    const { data, error } = await supabase.from('jobs').update({ mats: clean, products, job_notes: notes, ...extra, updated_at: new Date().toISOString() }).eq('id', job.id).select().single()
    setBusy(false)
    if (error) { setError(error); return null }
    const updated = changedSupplier ? await syncInvoiceTotals(data) : data
    toast(msg || `Job card saved: ${have} of ${rows.length} parts in`)
    return updated
  }

  async function addNote() {
    const text = note.trim()
    if (!text) return
    const next = [...notes, { at: new Date().toISOString(), by: me?.name || '', text }]
    setNotes(next); setNote('')
    const updated = await save({ job_notes: next }, 'Note added')
    if (updated) onSaved?.(updated, { keepOpen: true })
  }

  let lastFrom
  return (
    <div className="modal jobcard-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card jobcard" style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="block-head">
          <div><h3 style={{ fontSize: '1.8rem', textTransform: 'uppercase' }}>Job card</h3>
            <span className="num">{job.invoice_no ? `${job.invoice_no} · ` : ''}{job.quote_no}</span></div>
          <div className="no-print" style={{ display: 'flex', gap: 8 }}>
            <button className="btn small" type="button" onClick={() => window.print()}>Print</button>
            <button className="btn small" type="button" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="jc-info">
          <div><span className="hint">Customer</span><b>{job.customer_company ? `${job.customer_company} · ${job.customer}` : job.customer}</b>{job.phone && <span className="num">{job.phone}</span>}</div>
          <div><span className="hint">Stage</span><b>{job.status}</b></div>
          <div><span className="hint">Received</span><b>{job.accepted_at ? shortDate(job.accepted_at) : '—'}</b></div>
          <div><span className="hint">Parts</span><b>{have} of {rows.length} in{byClient ? ` · ${byClient} from client` : ''}</b></div>
        </div>

        <h4 className="jc-h">Work to do</h4>
        <ul className="jc-work">
          {work.map((l, i) => <li key={i}><b className="num">{l.qty} ×</b> {l.desc}</li>)}
          {!work.length && <li className="hint">{job.title}</li>}
        </ul>

        <h4 className="jc-h">Notes</h4>
        {notes.length > 0 ? (
          <ul className="jc-notes">{notes.map((x, i) => <li key={i}><span className="hint">{stamp(x.at)}{x.by && ` · ${x.by}`}</span><div style={{ whiteSpace: 'pre-line' }}>{x.text}</div></li>)}</ul>
        ) : <p className="hint" style={{ margin: '0 0 8px' }}>No notes yet.</p>}
        <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
          <textarea aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client wants the hitch moved 50 mm left. Collect on Friday." style={{ minHeight: 56, flex: 1 }} />
          <button className="btn" type="button" disabled={busy || !note.trim()} onClick={addNote}>Add note</button>
        </div>
        {job.notes && <p className="hint" style={{ marginTop: 0 }}>From the quote: {job.notes}</p>}

        <h4 className="jc-h">Parts</h4>
        <ErrorNote error={error} />
        <div className="tbl-wrap"><table>
          <thead><tr><th style={{ width: 70 }}>Have it</th><th>Part</th><th className="r">Qty</th><th>Who supplies it</th><th className="no-print" /></tr></thead>
          <tbody>{rows.map((r) => {
            const header = r.from !== lastFrom ? (lastFrom = r.from, <tr key={`h-${r.key}`}><td colSpan="5" className="label" style={{ color: 'var(--accent-hi)' }}>{r.from || 'Other parts for this job'}</td></tr>) : null
            return [header,
              <tr key={r.key} className={r.supplied_by === 'Client' ? 'client-part' : ''}>
                <td><input type="checkbox" checked={r.have} onChange={(e) => set(r, { have: e.target.checked })} aria-label={`Have ${r.name}`} style={{ width: 22, height: 22 }} /></td>
                <td>{r.custom ? <input aria-label="Part name" value={r.name} onChange={(e) => set(r, { name: e.target.value })} placeholder="e.g. towing hitch ball" /> : r.name || <span className="hint">(no name)</span>}</td>
                <td className="r num">{r.custom ? <input className="qty num" aria-label="Quantity" type="number" min="0" step="0.5" value={r.qty} onChange={(e) => set(r, { qty: e.target.value })} /> : r.qty}</td>
                <td><select aria-label="Who supplies it" value={r.supplied_by} onChange={(e) => set(r, { supplied_by: e.target.value })} style={{ width: 'auto' }}>
                  <option value="NJR">NJR buys it</option><option value="Client">Client supplies it</option></select></td>
                <td className="no-print">{r.custom && <button className="x" type="button" aria-label={`Remove ${r.name || 'part'}`} onClick={() => setMats(mats.filter((_, k) => k !== r.i))}>×</button>}</td>
              </tr>]
          })}
          {!rows.length && <tr><td colSpan="5" className="hint">No parts listed. Add the ones this job needs below.</td></tr>}</tbody>
        </table></div>
        {changedSupplier && job.invoice_no && <p className="hint" style={{ color: 'var(--warn)' }}>Changing who supplies a charged part changes the invoice total.</p>}

        <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn primary" type="button" disabled={busy} onClick={async () => { const u = await save(); if (u) onSaved?.(u) }}>{busy ? 'Saving…' : 'Save job card'}</button>
          <button className="btn" type="button" onClick={() => setMats([...mats, customPart('', 'NJR')])}>Add a part we buy</button>
          <button className="btn" type="button" onClick={() => setMats([...mats, customPart('', 'Client')])}>Client supplies a part</button>
          <span className="hint">Parts the client supplies aren't taken off stock or charged, and are listed on the quote.</span>
        </div>
      </div>
    </div>
  )
}
