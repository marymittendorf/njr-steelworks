import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n, productCost, suggestedSplit, marginAt, markupsFrom, ratesFrom } from '../costing.js'
import { money, money0 } from '../format.js'
import { Loading, ErrorNote, PartPicker, SearchBox, matches } from './ui.jsx'
import PartsPickList from './PartsPickList.jsx'

const CATEGORIES = ['Skips', 'Trailers', 'Gates', 'Fabrication', 'Welding', 'Other']
const CARD_FOR = { Skips: 'skip', Trailers: 'trailer', Gates: 'gates', Fabrication: 'fabrication', Welding: 'welding' }
export const blankProduct = (markup) => ({ name: '', category: 'Skips', spec: '', mats: [], labour: [{ task: 'Fabrication & welding', hours: 1 }], extras: [], markup, price_incl: '', options: [], on_website: false, active: true })

// The website's "from" price per service card = the cheapest product in that category shown on the website.
export async function syncWebsiteFromProducts(settings) {
  const { data: list } = await supabase.from('products').select('name,category,price_incl').eq('active', true).eq('on_website', true).gt('price_incl', 0)
  const from = { ...(settings.from_prices || {}) }
  for (const [cat, key] of Object.entries(CARD_FOR)) {
    const cheapest = (list || []).filter((p) => p.category === cat).sort((a, b) => n(a.price_incl) - n(b.price_incl))[0]
    if (cheapest) from[key] = { label: `${cheapest.name} from`, price: Math.round(n(cheapest.price_incl)) }
  }
  await supabase.from('settings').update({ from_prices: from }).eq('id', 1)
}

// Products: finished items NJR sells, set up once with what goes into them.
export default function Products({ settings, prices, toast, me, syncFromPrices }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null)
  const [q, setQ] = useState('')
  const rates = ratesFrom(settings)

  const load = () => supabase.from('products').select('*').order('category').order('sort').order('name')
    .then(({ data, error }) => { setList(data || []); setError(error) })
  useEffect(() => { load() }, [])

  if (!list) return error ? <ErrorNote error={error} /> : <Loading />
  const lowMargin = Math.max(5, n(settings.markup) / 2)

  return (
    <>
      <div className="pagehead">
        <h1>Products</h1>
        <div className="lh-tools"><SearchBox q={q} setQ={setQ} label="Search products" />
        <button className="btn primary" type="button" onClick={() => setEdit(blankProduct(n(settings.markup)))}>New product</button></div>
      </div>
      <ErrorNote error={error} />
      {!list.length ? <div className="card hint">No products yet. Click "New product", e.g. "2 m³ skip": add its parts from your parts list and the workshop hours, and the app suggests a price.</div> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Product</th><th className="r">Costs you</th><th className="r">Suggested</th><th className="r">Your price</th><th className="r">Margin</th><th>Website</th></tr></thead>
          <tbody>{list.filter((p) => matches(q, p.name, p.category, p.spec)).map((p) => {
            const pc = productCost(p, prices, rates)
            const sug = suggestedSplit(pc, { parts: p.markup_parts ?? markupsFrom(settings).parts, labour: p.markup_labour ?? markupsFrom(settings).labour }, rates.vat)
            const m = marginAt(p.price_incl, pc.cost, rates.vat)
            return (
              <tr key={p.id} className="clickable" tabIndex={0} onClick={() => setEdit({ ...p, price_incl: p.price_incl ?? '' })} onKeyDown={(e) => e.key === 'Enter' && setEdit(p)} style={{ opacity: p.active ? 1 : 0.5 }}>
                <td><b>{p.name}</b><div className="hint">{p.category}{p.options?.length ? ` · ${p.options.length} option${p.options.length > 1 ? 's' : ''}` : ''}{!p.active ? ' · not in use' : ''}</div>
                  {pc.unpriced.length > 0 && <div className="hint" style={{ color: 'var(--warn)' }}>No price yet for: {pc.unpriced.map((x) => x.name).join(', ')}</div>}</td>
                <td className="r num">{money(pc.cost)}<div className="hint">{pc.hours} h</div></td>
                <td className="r num">{money0(sug)}</td>
                <td className="r num"><b>{p.price_incl ? money0(p.price_incl) : '—'}</b></td>
                <td className="r num" style={{ color: !p.price_incl ? undefined : m < lowMargin ? 'var(--bad)' : m < n(settings.markup) * 0.75 ? 'var(--warn)' : 'var(--good)' }}>
                  {p.price_incl ? `${m.toFixed(1)}%` : '—'}{p.price_incl && m < lowMargin && <div className="hint" style={{ color: 'var(--bad)' }}>check price</div>}</td>
                <td>{p.on_website ? 'Shown' : <span className="hint">—</span>}</td>
              </tr>)
          })}</tbody>
        </table></div>
      )}
      <p className="hint">"Costs you" uses today's part prices from Stock and your labour, consumables and overhead rates. Margin is profit as a % of your price excl. VAT.</p>
      {edit && <ProductEditor product={edit} prices={prices} settings={settings} rates={rates} me={me} toast={toast}
        onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await syncWebsiteFromProducts(settings); await syncFromPrices?.(); load() }} />}
    </>
  )
}

export function ProductEditor({ product, prices, settings, rates, me, toast, onClose, onSaved }) {
  const [p, setP] = useState(() => ({ ...product, mats: [...(product.mats || [])], labour: [...(product.labour || [])], extras: [...(product.extras || [])], options: [...(product.options || [])] }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [picking, setPicking] = useState(false)
  const active = prices.filter((x) => x.active)
  const pc = productCost(p, prices, rates)
  const def = markupsFrom(settings)
  const pick = (v, d) => (v === '' || v == null ? d : n(v))
  const markups = { parts: pick(p.markup_parts, def.parts), labour: pick(p.markup_labour, def.labour) }
  const sug = suggestedSplit(pc, markups, rates.vat)
  const m = marginAt(p.price_incl, pc.cost, rates.vat)
  const setRow = (list, i, patch) => setP({ ...p, [list]: p[list].map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  const delRow = (list, i) => setP({ ...p, [list]: p[list].filter((_, k) => k !== i) })

  async function save() {
    if (!p.name.trim()) { setError('Give the product a name, e.g. "2 m³ skip".'); return }
    setBusy(true); setError(null)
    const row = {
      name: p.name.trim(), category: p.category, spec: p.spec?.trim() || null,
      mats: p.mats.filter((x) => x.id && n(x.qty) > 0).map((x) => ({ id: x.id, qty: n(x.qty) })),
      labour: p.labour.filter((x) => x.task?.trim() && n(x.hours) > 0).map((x) => ({ task: x.task.trim(), hours: n(x.hours) })),
      extras: p.extras.filter((x) => x.desc?.trim()).map((x) => ({ desc: x.desc.trim(), amount: n(x.amount) })),
      markup: null, markup_parts: markups.parts, markup_labour: markups.labour, price_incl: n(p.price_incl) > 0 ? Math.round(n(p.price_incl) * 100) / 100 : null,
      options: p.options.filter((o) => o.name?.trim()).map((o) => ({ name: o.name.trim(), price_incl: n(o.price_incl), cost_excl: n(o.cost_excl) })),
      on_website: Boolean(p.on_website), active: Boolean(p.active), updated_at: new Date().toISOString(),
    }
    const res = p.id ? await supabase.from('products').update(row).eq('id', p.id).select().single() : await supabase.from('products').insert(row).select().single()
    setBusy(false)
    if (res.error) { setError(res.error); return }
    toast(`Saved ${row.name}`); onSaved(res.data)
  }

  async function remove() {
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) { setError(error); return }
    toast(`Deleted ${p.name}`); onSaved()
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card" style={{ maxWidth: 940, margin: '0 auto' }}>
        <div className="block-head"><h3 style={{ fontSize: '1.6rem', textTransform: 'uppercase' }}>{p.id ? p.name : 'New product'}</h3><button className="x" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <ErrorNote error={error} />
        <div className="fgrid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="field"><label htmlFor="pr-name">Name (what the customer sees)</label><input id="pr-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="2 m³ skip" /></div>
          <div className="field"><label htmlFor="pr-cat">Type</label><select id="pr-cat" value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field full"><label htmlFor="pr-spec">Notes for staff (optional)</label><input id="pr-spec" value={p.spec || ''} onChange={(e) => setP({ ...p, spec: e.target.value })} placeholder="e.g. 2 mm laser-cut steel from RT Laser, 4 lifting lugs" /></div>
        </div>

        <div className="block-head" style={{ marginTop: 14 }}><h3>What goes into one</h3><span style={{ display: 'flex', gap: 8 }}><button className="btn small primary" type="button" disabled={!active.length} onClick={() => setPicking(true)}>Choose parts</button><button className="btn small" type="button" disabled={!active.length} onClick={() => setP({ ...p, mats: [...p.mats, { id: '', qty: 1 }] })}>Add one part</button></span></div>
        <div className="tbl-wrap open-ok"><table>
          <thead><tr><th>Part (from Stock)</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Line</th><th /></tr></thead>
          <tbody>{p.mats.map((x, i) => {
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
          {!p.mats.length && <tr><td colSpan="5" className="hint">No parts yet.</td></tr>}</tbody>
        </table></div>

        <div className="block-head" style={{ marginTop: 14 }}><h3>Workshop hours</h3><button className="btn small" type="button" onClick={() => setP({ ...p, labour: [...p.labour, { task: '', hours: 1 }] })}>Add task</button></div>
        <div className="tbl-wrap"><table>
          <tbody>{p.labour.map((x, i) => (
            <tr key={i}>
              <td><input aria-label="Task" value={x.task} onChange={(e) => setRow('labour', i, { task: e.target.value })} placeholder="e.g. Welding" /></td>
              <td className="r"><input className="qty num" aria-label="Hours" type="number" min="0" step="0.5" value={x.hours} onChange={(e) => setRow('labour', i, { hours: e.target.value })} /> h</td>
              <td><button className="x" type="button" aria-label="Remove task" onClick={() => delRow('labour', i)}>×</button></td>
            </tr>))}</tbody>
        </table></div>
        <p className="hint">R{rates.labour}/h labour + R{rates.consumables}/h wire, gas and discs, from Rates &amp; settings.</p>

        <div className="block-head" style={{ marginTop: 10 }}><h3>Other costs <span className="hint">(optional)</span></h3><button className="btn small" type="button" onClick={() => setP({ ...p, extras: [...p.extras, { desc: '', amount: '' }] })}>Add cost</button></div>
        {p.extras.length > 0 && <div className="tbl-wrap"><table><tbody>{p.extras.map((x, i) => (
          <tr key={i}>
            <td><input aria-label="Cost description" value={x.desc} onChange={(e) => setRow('extras', i, { desc: e.target.value })} placeholder="e.g. galvanising, delivery to site" /></td>
            <td className="r"><input className="money num" aria-label="Amount" type="number" min="0" step="10" value={x.amount} onChange={(e) => setRow('extras', i, { amount: e.target.value })} /></td>
            <td><button className="x" type="button" aria-label="Remove cost" onClick={() => delRow('extras', i)}>×</button></td>
          </tr>))}</tbody></table></div>}

        <div className="block-head" style={{ marginTop: 14 }}><h3>Options <span className="hint">(add-ons the customer can choose)</span></h3><button className="btn small" type="button" onClick={() => setP({ ...p, options: [...p.options, { name: '', price_incl: '', cost_excl: '' }] })}>Add option</button></div>
        {p.options.length > 0 && <div className="tbl-wrap"><table>
          <thead><tr><th>Option</th><th className="r">Adds to price (incl. VAT)</th><th className="r">Adds to your cost (excl. VAT)</th><th /></tr></thead>
          <tbody>{p.options.map((o, i) => (
            <tr key={i}>
              <td><input aria-label="Option" value={o.name} onChange={(e) => setRow('options', i, { name: e.target.value })} placeholder="e.g. Galvanised" /></td>
              <td className="r"><input className="money num" aria-label="Option price" type="number" min="0" step="10" value={o.price_incl} onChange={(e) => setRow('options', i, { price_incl: e.target.value })} /></td>
              <td className="r"><input className="money num" aria-label="Option cost" type="number" min="0" step="10" value={o.cost_excl} onChange={(e) => setRow('options', i, { cost_excl: e.target.value })} /></td>
              <td><button className="x" type="button" aria-label="Remove option" onClick={() => delRow('options', i)}>×</button></td>
            </tr>))}</tbody>
        </table></div>}

        <div className="sheet" style={{ position: 'static', marginTop: 16 }}>
          <dl style={{ paddingTop: 12 }}>
            <dt>Parts</dt><dd>{money(pc.materials)}</dd>
            <dt>Labour &amp; consumables ({pc.hours} h)</dt><dd>{money(pc.labour)}</dd>
            {pc.extras > 0 && <><dt>Other costs</dt><dd>{money(pc.extras)}</dd></>}
            <dt>Workshop overhead {rates.overhead}%</dt><dd>{money(pc.cost - pc.direct)}</dd>
            <div className="rule" />
            <dt><b>Costs you</b></dt><dd><b>{money(pc.cost)}</b></dd>
            <dt>Markup on parts and materials <input className="qty num" aria-label="Markup on parts %" type="number" step="5" min="0" value={p.markup_parts ?? def.parts} onChange={(e) => setP({ ...p, markup_parts: e.target.value })} style={{ width: 64, display: 'inline-block' }} />%</dt><dd className="hint">{money(pc.partsCost)} cost</dd>
            <dt>Markup on labour <input className="qty num" aria-label="Markup on labour %" type="number" step="5" min="0" value={p.markup_labour ?? def.labour} onChange={(e) => setP({ ...p, markup_labour: e.target.value })} style={{ width: 64, display: 'inline-block' }} />%</dt><dd className="hint">{money(pc.labourCost)} cost</dd>
            <dt><b>Suggested price incl. VAT</b></dt><dd><b>{money0(sug)}</b></dd>
          </dl>
          {pc.unpriced.length > 0 && <p className="hint" style={{ color: 'var(--warn)', padding: '0 18px' }}>No price yet for {pc.unpriced.map((x) => x.name).join(', ')}: add it under Stock, or the cost is too low.</p>}
          <div className="row" style={{ alignItems: 'center' }}>
            <label htmlFor="pr-price"><b>Your price incl. VAT</b></label>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="pr-price" className="money num" type="number" min="0" step="10" value={p.price_incl} onChange={(e) => setP({ ...p, price_incl: e.target.value })} placeholder={String(sug)} style={{ width: 130 }} />
              <button className="btn small" type="button" onClick={() => setP({ ...p, price_incl: sug })}>Use suggested</button>
            </span>
          </div>
          {n(p.price_incl) > 0 && <div className="row"><span>Margin at your price</span><b className="num" style={{ color: m < 10 ? 'var(--bad)' : m < n(settings.markup) * 0.75 ? 'var(--warn)' : 'var(--good)' }}>{m.toFixed(1)}% · profit {money(n(p.price_incl) / (1 + rates.vat / 100) - pc.cost)}</b></div>}
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
          <label className="check"><input type="checkbox" checked={Boolean(p.on_website)} onChange={(e) => setP({ ...p, on_website: e.target.checked })} /> Show on the website (instant price and "from" price)</label>
          <label className="check"><input type="checkbox" checked={Boolean(p.active)} onChange={(e) => setP({ ...p, active: e.target.checked })} /> In use</label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save product'}</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          {p.id && <button className="btn" type="button" title="Start a new product from this one, e.g. the 3 m³ skip from the 2 m³"
            onClick={() => { setP({ ...p, id: undefined, name: `${p.name} (copy)`, on_website: false }); setConfirmDel(false); toast('Copy made: change the name and parts, then save') }}>Copy</button>}
          {p.id && me?.role === 'owner' && (confirmDel
            ? <button className="btn danger" type="button" onClick={remove}>Confirm delete</button>
            : <button className="btn ghost" type="button" onClick={() => setConfirmDel(true)}>Delete</button>)}
        </div>
        <p className="hint">Changing a product doesn't change quotes already made; they keep the price they were quoted at.</p>
        {picking && <PartsPickList prices={prices} mats={p.mats} onClose={() => setPicking(false)} onApply={(mats) => { setP({ ...p, mats }); setPicking(false) }} />}
      </div>
    </div>
  )
}
