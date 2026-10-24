import { useState } from 'react'
import { n, productCost, suggestedPrice, workedLine, TEMPLATES } from '../costing.js'
import { money, money0 } from '../format.js'
import { PartPicker } from './ui.jsx'

// Pop-up for a one-off line: pick parts from Stock and hours → what it costs and a suggested price.
export default function WorkOutPrice({ line, prices, rates, markup, onUse, onClose }) {
  const active = prices.filter((p) => p.active)
  const w = line.worked || {}
  const [r, setR] = useState({
    mats: [...(w.mats || [])], labour: [...(w.labour || [{ task: 'Fabrication & welding', hours: 1 }])],
    extras: [...(w.extras || [])], markup: w.markup ?? n(markup),
  })
  const setRow = (list, i, patch) => setR({ ...r, [list]: r[list].map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  const delRow = (list, i) => setR({ ...r, [list]: r[list].filter((_, k) => k !== i) })
  const pc = productCost(r, prices, rates)
  const price = suggestedPrice(pc.cost, r.markup, rates.vat)

  function loadTemplate(key) {
    const t = TEMPLATES[key]
    const ids = new Set(prices.map((p) => p.id))
    setR({ ...r, mats: t.mats.filter(([id]) => ids.has(id)).map(([id, qty]) => ({ id, qty })), labour: t.labour.map(([task, hours]) => ({ task, hours })) })
  }

  function use() {
    const clean = {
      mats: r.mats.filter((x) => x.id && n(x.qty) > 0).map((x) => ({ id: x.id, qty: n(x.qty) })),
      labour: r.labour.filter((x) => n(x.hours) > 0).map((x) => ({ task: x.task || 'Work', hours: n(x.hours) })),
      extras: r.extras.filter((x) => n(x.amount) > 0).map((x) => ({ desc: x.desc || 'Other', amount: n(x.amount) })),
      markup: n(r.markup),
    }
    onUse(workedLine(clean, prices, rates, line))
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="block-head"><div><h3 style={{ fontSize: '1.6rem', textTransform: 'uppercase' }}>Work out a price</h3>
          <span className="hint">{line.name || 'Your own line'}</span></div>
          <button className="x" type="button" aria-label="Close" onClick={onClose}>×</button></div>

        <div className="field"><label htmlFor="wo-tpl">Start from a template (optional)</label>
          <select id="wo-tpl" value="" onChange={(e) => e.target.value && loadTemplate(e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
          </select></div>

        <div className="block-head" style={{ marginTop: 14 }}><h3>Parts</h3><button className="btn small" type="button" disabled={!active.length} onClick={() => setR({ ...r, mats: [...r.mats, { id: '', qty: 1 }] })}>Add part</button></div>
        <div className="tbl-wrap open-ok"><table>
          <thead><tr><th>Part (from Stock)</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Line</th><th /></tr></thead>
          <tbody>{r.mats.map((x, i) => {
            const pr = prices.find((y) => y.id === x.id)
            return (
              <tr key={i}>
                <td><PartPicker prices={prices} value={x.id} onChange={(id) => setRow('mats', i, { id })} autoFocus={!x.id} /></td>
                <td className="r"><input className="qty num" aria-label="Quantity" type="number" min="0" step="0.5" value={x.qty} onChange={(e) => setRow('mats', i, { qty: e.target.value })} /></td>
                <td className="r num" style={{ color: pr && !n(pr.cost) ? 'var(--warn)' : undefined }}>{pr ? (n(pr.cost) ? money(pr.cost) : 'no price') : '—'}</td>
                <td className="r num">{money(n(x.qty) * n(pr?.cost))}</td>
                <td><button className="x" type="button" aria-label="Remove part" onClick={() => delRow('mats', i)}>×</button></td>
              </tr>)
          })}
          {!r.mats.length && <tr><td colSpan="5" className="hint">No parts yet.</td></tr>}</tbody>
        </table></div>

        <div className="block-head" style={{ marginTop: 14 }}><h3>Workshop hours</h3><button className="btn small" type="button" onClick={() => setR({ ...r, labour: [...r.labour, { task: '', hours: 1 }] })}>Add task</button></div>
        <div className="tbl-wrap"><table><tbody>{r.labour.map((x, i) => (
          <tr key={i}>
            <td><input aria-label="Task" value={x.task} onChange={(e) => setRow('labour', i, { task: e.target.value })} placeholder="e.g. Welding" /></td>
            <td className="r"><input className="qty num" aria-label="Hours" type="number" min="0" step="0.5" value={x.hours} onChange={(e) => setRow('labour', i, { hours: e.target.value })} /> h</td>
            <td><button className="x" type="button" aria-label="Remove task" onClick={() => delRow('labour', i)}>×</button></td>
          </tr>))}</tbody></table></div>

        <div className="block-head" style={{ marginTop: 10 }}><h3>Other costs <span className="hint">(optional)</span></h3><button className="btn small" type="button" onClick={() => setR({ ...r, extras: [...r.extras, { desc: '', amount: '' }] })}>Add cost</button></div>
        {r.extras.length > 0 && <div className="tbl-wrap"><table><tbody>{r.extras.map((x, i) => (
          <tr key={i}>
            <td><input aria-label="Cost description" value={x.desc} onChange={(e) => setRow('extras', i, { desc: e.target.value })} placeholder="e.g. galvanising, laser cutting, delivery" /></td>
            <td className="r"><input className="money num" aria-label="Amount" type="number" min="0" step="10" value={x.amount} onChange={(e) => setRow('extras', i, { amount: e.target.value })} /></td>
            <td><button className="x" type="button" aria-label="Remove cost" onClick={() => delRow('extras', i)}>×</button></td>
          </tr>))}</tbody></table></div>}

        <div className="sheet" style={{ marginTop: 16 }}>
          <dl>
            <dt>Costs you (parts {money0(pc.materials)}, {pc.hours} h, overhead)</dt><dd>{money(pc.cost)}</dd>
            <dt><label htmlFor="wo-markup">Markup %</label></dt><dd><input id="wo-markup" className="qty num" type="number" step="1" value={r.markup} onChange={(e) => setR({ ...r, markup: e.target.value })} /></dd>
          </dl>
          <div className="tot"><span className="label" style={{ color: 'var(--accent-ink)' }}>Suggested price each, incl. VAT</span><b className="num">{money0(price)}</b></div>
        </div>
        {pc.unpriced.length > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>No price yet for: {pc.unpriced.map((x) => x.name).join(', ')}. Add it under Stock.</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn primary" type="button" onClick={use}>Use this price</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
