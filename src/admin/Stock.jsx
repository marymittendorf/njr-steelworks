import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, money0, shortDate } from '../format.js'
import { Loading, ErrorNote, SearchBox, matches } from './ui.jsx'
import PartsStock from './PartsStock.jsx'

const today = () => new Date().toISOString().slice(0, 10)
const blankItem = { title: '', description: '', built_on: today(), asking_price: '' }

// Finished trailers/skips in the yard. Stock builds from Orders arrive here by themselves.
export default function Stock({ go, toast, settings, prices, me, reload, syncFromPrices }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [selling, setSelling] = useState(null) // { id, sold_to, sold_phone, sold_price, sold_on }
  const [adding, setAdding] = useState(null)
  const [showSold, setShowSold] = useState(false)
  const [q, setQ] = useState('')

  const load = () => supabase.from('stock_items').select('*').order('built_on', { ascending: false })
    .then(({ data, error }) => { setItems(data || []); setError(error) })
  useEffect(() => { load() }, [])

  if (!items) return error ? <ErrorNote error={error} /> : <Loading />

  const found = items.filter((i) => matches(q, i.title, i.description, i.sold_to))
  const inStock = found.filter((i) => i.status === 'In stock')
  const sold = found.filter((i) => i.status === 'Sold')
  const value = inStock.reduce((a, i) => a + n(i.asking_price), 0)

  async function update(id, patch, msg) {
    const { error } = await supabase.from('stock_items').update(patch).eq('id', id)
    if (error) { setError(error); return false }
    if (msg) toast(msg)
    load(); return true
  }

  async function sell(e) {
    e.preventDefault()
    if (!selling.sold_to.trim() || !(n(selling.sold_price) > 0)) { setError('Add the buyer and the price.'); return }
    const ok = await update(selling.id, {
      status: 'Sold', sold_to: selling.sold_to.trim(), sold_phone: selling.sold_phone.trim() || null,
      sold_price: n(selling.sold_price), sold_on: selling.sold_on,
    }, 'Marked as sold')
    if (ok) { setError(null); setSelling(null) }
  }

  async function addItem(e) {
    e.preventDefault()
    if (!adding.title.trim()) { setError('Say what the item is.'); return }
    const { error } = await supabase.from('stock_items').insert({
      title: adding.title.trim(), description: adding.description.trim() || null, built_on: adding.built_on,
      asking_price: n(adding.asking_price) || null,
    })
    if (error) { setError(error); return }
    setError(null); setAdding(null); toast('Added to stock'); load()
  }

  return (
    <>
      <div className="pagehead">
        <h1>Stock</h1>
        <div className="lh-tools"><SearchBox q={q} setQ={setQ} label="Search stock" />
          {!adding && <button className="btn" type="button" onClick={() => setAdding({ ...blankItem })}>Add existing stock</button>}</div>
      </div>
      <ErrorNote error={error} />

      <PartsStock q={q} settings={settings} prices={prices} reload={reload} syncFromPrices={syncFromPrices} me={me} toast={toast} />

      <div className="block-head"><h3 style={{ fontSize: '1.6rem' }}>Finished trailers &amp; skips</h3></div>

      <div className="kpis">
        <div className="kpi"><span className="label">In stock</span><b className="num">{inStock.length}</b></div>
        <div className="kpi"><span className="label">Asking value</span><b className="num">{money0(value)}</b><span className="sub">Incl. VAT</span></div>
        <div className="kpi"><span className="label">Sold</span><b className="num">{sold.length}</b><span className="sub num">{money0(sold.reduce((a, i) => a + n(i.sold_price), 0))}</span></div>
      </div>

      {adding && (
        <form className="card block" onSubmit={addItem}>
          <div className="block-head"><h3>Add existing stock</h3></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="sa-title">What it is</label><input id="sa-title" value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} placeholder="3.0 × 1.5 m cage trailer" /></div>
            <div className="field"><label htmlFor="sa-date">Finished on</label><input id="sa-date" type="date" value={adding.built_on} onChange={(e) => setAdding({ ...adding, built_on: e.target.value })} /></div>
            <div className="field"><label htmlFor="sa-desc">Details (optional)</label><input id="sa-desc" value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} placeholder="Galvanised, 13&quot; wheels, mesh cage" /></div>
            <div className="field"><label htmlFor="sa-price">Asking price incl. VAT (R)</label><input id="sa-price" type="number" min="0" step="100" value={adding.asking_price} onChange={(e) => setAdding({ ...adding, asking_price: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button className="btn primary" type="submit">Add to stock</button><button className="btn ghost" type="button" onClick={() => setAdding(null)}>Cancel</button></div>
        </form>
      )}

      {!inStock.length ? <div className="card hint block">Nothing in stock. On Orders, use "Add stock build" to build a trailer or skip ahead of a sale.</div> : (
        <div className="tbl-wrap block"><table>
          <thead><tr><th>Item</th><th>Finished</th><th className="r">Asking price</th><th></th></tr></thead>
          <tbody>
            {inStock.map((i) => (
              <tr key={i.id}>
                <td><b>{i.title}</b>{i.description && <div className="hint">{i.description}</div>}
                  {i.job_id && <button className="linkbtn" type="button" onClick={() => go('cost', { jobId: i.job_id })}>Open build costing</button>}</td>
                <td className="num">{shortDate(i.built_on)}</td>
                <td className="r"><input className="money num" aria-label={`Asking price for ${i.title}`} type="number" min="0" step="100" defaultValue={i.asking_price ?? ''}
                  onBlur={(e) => n(e.target.value) !== n(i.asking_price) && update(i.id, { asking_price: n(e.target.value) || null }, 'Price updated')} /></td>
                <td>{selling?.id === i.id ? null : <button className="btn small primary" type="button" onClick={() => setSelling({ id: i.id, sold_to: '', sold_phone: '', sold_price: i.asking_price ?? '', sold_on: today() })}>Sell</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {selling && (
        <form className="card block" onSubmit={sell}>
          <div className="block-head"><h3>Sell: {items.find((i) => i.id === selling.id)?.title}</h3></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="ss-to">Buyer</label><input id="ss-to" value={selling.sold_to} onChange={(e) => setSelling({ ...selling, sold_to: e.target.value })} /></div>
            <div className="field"><label htmlFor="ss-ph">Buyer's cell</label><input id="ss-ph" value={selling.sold_phone} onChange={(e) => setSelling({ ...selling, sold_phone: e.target.value })} /></div>
            <div className="field"><label htmlFor="ss-price">Price incl. VAT (R)</label><input id="ss-price" type="number" min="0" step="100" value={selling.sold_price} onChange={(e) => setSelling({ ...selling, sold_price: e.target.value })} /></div>
            <div className="field"><label htmlFor="ss-date">Date sold</label><input id="ss-date" type="date" value={selling.sold_on} onChange={(e) => setSelling({ ...selling, sold_on: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button className="btn primary" type="submit">Mark as sold</button><button className="btn ghost" type="button" onClick={() => setSelling(null)}>Cancel</button></div>
        </form>
      )}

      <div className="block-head"><h3>Sold</h3>{sold.length > 0 && <button className="linkbtn" type="button" onClick={() => setShowSold(!showSold)}>{showSold ? 'Hide' : `Show ${sold.length}`}</button>}</div>
      {showSold && (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Item</th><th>Sold to</th><th>Date</th><th className="r">Price</th><th></th></tr></thead>
          <tbody>
            {sold.map((i) => (
              <tr key={i.id}>
                <td>{i.title}</td><td>{i.sold_to}<div className="hint">{i.sold_phone}</div></td>
                <td className="num">{i.sold_on ? shortDate(i.sold_on) : '—'}</td><td className="r num">{money(i.sold_price)}</td>
                <td><button className="linkbtn" type="button" onClick={() => go('deliveries', { stockItemId: i.id })}>Book delivery</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}
