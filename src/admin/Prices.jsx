import { useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { ErrorNote } from './ui.jsx'

const blank = { id: '', name: '', unit: '6 m length', cost: '', kg: '' }

export default function Prices({ prices, reload, syncFromPrices, toast }) {
  const [error, setError] = useState(null)
  const [add, setAdd] = useState(blank)

  async function saveRow(p, patch) {
    const { error } = await supabase.from('prices').update(patch).eq('id', p.id)
    if (error) { setError(error); return }
    await syncFromPrices()
    toast('Price list updated')
  }

  async function addItem(e) {
    e.preventDefault()
    const id = add.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (!id || !add.name.trim()) { setError('Give the new item a short code and a name.'); return }
    if (prices.some((p) => p.id === id)) { setError(`The code "${id}" is already used. Pick another.`); return }
    const sort = Math.max(0, ...prices.map((p) => p.sort)) + 10
    const { error } = await supabase.from('prices').insert({ id, name: add.name.trim(), unit: add.unit.trim(), cost: n(add.cost), kg: n(add.kg), sort })
    if (error) { setError(error); return }
    setAdd(blank); setError(null); await reload(); toast('Item added')
  }

  return (
    <>
      <div className="pagehead">
        <div><h1>Steel price list</h1><p>Your buying prices excl. VAT. New costings use these; saved quotes keep the prices they were quoted at.</p></div>
      </div>
      <ErrorNote error={error} />
      <div className="tbl-wrap block"><table>
        <thead><tr><th>Item</th><th>Unit</th><th className="r">Mass (kg)</th><th className="r">Cost excl. VAT</th><th>In use</th></tr></thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
              <td>{p.name} <span className="hint">· {p.id}</span>{p.notes && <div className="hint" style={{ fontSize: '.8rem' }}>{p.notes}</div>}</td>
              <td className="hint">{p.unit}</td>
              <td className="r"><input className="qty num" aria-label={`Mass of ${p.name}`} type="number" min="0" step="0.1" defaultValue={p.kg}
                onBlur={(e) => n(e.target.value) !== n(p.kg) && saveRow(p, { kg: n(e.target.value) })} /></td>
              <td className="r"><input className="money num" aria-label={`Cost of ${p.name}`} type="number" min="0" step="10" defaultValue={p.cost}
                onBlur={(e) => n(e.target.value) !== n(p.cost) && saveRow(p, { cost: n(e.target.value) })} /></td>
              <td><label className="check"><input type="checkbox" checked={p.active} onChange={async (e) => { await saveRow(p, { active: e.target.checked }); reload() }} /> {p.active ? 'Yes' : 'Hidden'}</label></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <form className="card" onSubmit={addItem}>
        <div className="block-head"><h3>Add an item</h3></div>
        <div className="fgrid">
          <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Round tube 32 mm × 2 mm" /></div>
          <div className="field"><label htmlFor="a-id">Short code</label><input id="a-id" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })} placeholder="rt32" /></div>
          <div className="field"><label htmlFor="a-unit">Unit</label><input id="a-unit" value={add.unit} onChange={(e) => setAdd({ ...add, unit: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-kg">Mass per unit (kg)</label><input id="a-kg" type="number" min="0" step="0.1" value={add.kg} onChange={(e) => setAdd({ ...add, kg: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-cost">Cost excl. VAT (R)</label><input id="a-cost" type="number" min="0" step="10" value={add.cost} onChange={(e) => setAdd({ ...add, cost: e.target.value })} /></div>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button className="btn primary" type="submit">Add item</button></div>
        </div>
      </form>
    </>
  )
}
