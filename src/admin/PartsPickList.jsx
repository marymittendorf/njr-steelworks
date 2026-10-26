import { useState } from 'react'
import { n } from '../costing.js'
import { money } from '../format.js'

// Tick every part a product needs in one go: search, tick (or "tick all shown"), set quantities, add.
// Parts already on the product start ticked with their quantity; unticking removes them.
export default function PartsPickList({ prices, mats, onApply, onClose, title = 'Choose parts' }) {
  const [sel, setSel] = useState(() => new Map(mats.filter((m) => m.id).map((m) => [m.id, m.qty])))
  const [q, setQ] = useState('')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = prices
    .filter((p) => p.active || sel.has(p.id))
    .filter((p) => words.every((w) => `${p.name} ${p.id} ${p.notes || ''}`.toLowerCase().includes(w)))
  const allTicked = shown.length > 0 && shown.every((p) => sel.has(p.id))

  const tick = (id, on) => setSel((m) => { const x = new Map(m); if (on) x.set(id, x.get(id) || 1); else x.delete(id); return x })
  const setQty = (id, qty) => setSel((m) => new Map(m).set(id, qty))
  const tickShown = (on) => setSel((m) => { const x = new Map(m); for (const p of shown) { if (on) x.set(p.id, x.get(p.id) || 1); else x.delete(p.id) } return x })

  function apply() {
    // Keep the existing order (and any part no longer on the Stock list), then add new ones in list order.
    const kept = mats.filter((m) => m.id && (sel.has(m.id) || !prices.some((p) => p.id === m.id))).map((m) => (sel.has(m.id) ? { ...m, qty: sel.get(m.id) } : m))
    const have = new Set(kept.map((m) => m.id))
    const added = prices.filter((p) => sel.has(p.id) && !have.has(p.id)).map((p) => ({ id: p.id, qty: sel.get(p.id) }))
    onApply([...kept, ...added])
  }

  const newCount = [...sel.keys()].filter((id) => !mats.some((m) => m.id === id)).length
  const removed = mats.filter((m) => m.id && prices.some((p) => p.id === m.id) && !sel.has(m.id)).length

  return (
    <div className="modal" style={{ zIndex: 95 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="block-head"><h3 style={{ fontSize: '1.6rem', textTransform: 'uppercase' }}>{title}</h3>
          <button className="x" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input type="search" autoFocus aria-label="Search parts" placeholder="Type to narrow the list, e.g. 2 m³ skip" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn small" type="button" disabled={!shown.length} onClick={() => tickShown(!allTicked)}>{allTicked ? 'Untick all shown' : `Tick all shown (${shown.length})`}</button>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: '55vh', overflowY: 'auto' }}><table>
          <thead><tr><th style={{ width: 40 }} /><th>Part</th><th className="r">Each</th><th className="r">Qty</th></tr></thead>
          <tbody>{shown.map((p) => {
            const on = sel.has(p.id)
            return (
              <tr key={p.id} className={on ? 'picked' : ''}>
                <td><input type="checkbox" checked={on} onChange={(e) => tick(p.id, e.target.checked)} aria-label={`Use ${p.name}`} style={{ width: 20, height: 20 }} /></td>
                <td onClick={() => tick(p.id, !on)} style={{ cursor: 'pointer' }}>{p.name}<span className="hint"> · {p.unit}</span></td>
                <td className="r num" style={{ color: n(p.cost) ? undefined : 'var(--warn)' }}>{n(p.cost) ? money(p.cost) : 'no price'}</td>
                <td className="r">{on && <input className="qty num" aria-label={`How many ${p.name}`} type="number" min="0" step="0.5" value={sel.get(p.id)} onChange={(e) => setQty(p.id, e.target.value)} />}</td>
              </tr>)
          })}
          {!shown.length && <tr><td colSpan="4" className="hint">No part matches "{q}". Add it under Stock first.</td></tr>}</tbody>
        </table></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn primary" type="button" onClick={apply}>
            {newCount ? `Add ${newCount} part${newCount > 1 ? 's' : ''}` : 'Done'}{removed ? ` · remove ${removed}` : ''}</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <span className="hint">{sel.size} part{sel.size === 1 ? '' : 's'} ticked</span>
        </div>
      </div>
    </div>
  )
}
