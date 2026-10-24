import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { ownLine, productLine, ratesFrom, templateLine, workedLine, TEMPLATE_FOR_REQUEST } from '../costing.js'
import { money0, shortDate, waNumber } from '../format.js'
import { Pill, Loading, ErrorNote } from './ui.jsx'

export default function Requests({ settings, prices, go, refreshCount }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [photoUrls, setPhotoUrls] = useState({})

  const load = () => supabase.from('requests').select('*').order('created_at', { ascending: false })
    .then(({ data, error }) => { setList(data || []); setError(error) })
  useEffect(() => { load() }, [])

  async function showPhotos(r) {
    const { data } = await supabase.storage.from('request-photos').createSignedUrls(r.photos, 3600)
    setPhotoUrls({ ...photoUrls, [r.id]: (data || []).map((d) => d.signedUrl).filter(Boolean) })
  }

  async function setStatus(r, status) {
    const { error } = await supabase.from('requests').update({ status }).eq('id', r.id)
    if (error) setError(error); else { load(); refreshCount() }
  }

  async function costIt(r) {
    const tpl = TEMPLATE_FOR_REQUEST[r.type] || 'custom'
    const picked = r.ai_estimate?.products
    if (picked) {
      // From the website's instant price: quote the products the customer picked, at today's prices.
      const { data: catalogue, error } = await supabase.from('products').select('*').in('id', picked.map((x) => x.product_id))
      if (error) { setError(error); return }
      const rates = ratesFrom(settings)
      const lines = picked.map((x) => catalogue.find((c) => c.id === x.product_id)).map((c, i) => c && productLine(c, prices, rates, picked[i].options, picked[i].qty)).filter(Boolean)
      go('cost', {
        draft: {
          title: r.ai_estimate.title, category: catalogue[0]?.category || null, mats: [], labour: [], extras: [], products: lines,
          customer: r.name, phone: r.phone, email: r.email || '', notes: r.detail || '',
          units: 1, galv: false, markup: settings.markup, status: 'Draft', request_id: r.id, rates,
        },
      })
      return
    }
    const ai = r.ai_estimate && !r.ai_estimate.failed ? r.ai_estimate : null
    const rates = ratesFrom(settings)
    const active = prices.filter((p) => p.active)
    // One line to start from: the AI's parts list, a template's suggested price, or an empty line for custom work.
    const line = ai
      ? { ...workedLine({ mats: ai.mats.map((m) => ({ id: m.id, qty: m.qty })), labour: ai.labour, extras: ai.extras, markup: settings.markup }, active, rates, ownLine(ai.title)), qty: ai.units || 1 }
      : tpl === 'custom' ? ownLine(r.type) : templateLine(tpl, active, rates, settings.markup)
    go('cost', {
      draft: {
        title: '', mats: [], labour: [], extras: [], products: [line],
        customer: r.name, phone: r.phone, email: r.email || '', notes: r.detail || '',
        units: 1, galv: false, markup: settings.markup, status: 'Draft', request_id: r.id, rates,
        category: /skip/i.test(r.type) ? 'Skips' : /trailer/i.test(r.type) ? 'Trailers' : null,
      },
    })
  }

  const shown = (list || []).filter((r) => showAll || r.status === 'New')

  return (
    <>
      <div className="pagehead">
        <div><h1>Requests</h1><p>Quote requests from the website. Cost one to turn it into a quote.</p></div>
        <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show quoted &amp; declined</label>
      </div>
      <ErrorNote error={error} />
      {list === null ? <Loading /> : !shown.length ? (
        <div className="card hint">No new requests. They appear here when someone uses the quote form on the website.</div>
      ) : shown.map((r) => (
        <div className="card block" key={r.id}>
          <div className="block-head">
            <div><b style={{ fontSize: '1.15rem' }}>{r.name}</b> <span className="hint">· {shortDate(r.created_at)}</span></div>
            <Pill status={r.status} />
          </div>
          <div className="phone" style={{ marginBottom: 6 }}>
            <a className="num" href={`tel:${r.phone.replace(/\s/g, '')}`}>{r.phone}</a>
            <a className="btn small ghost" href={`https://wa.me/${waNumber(r.phone)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            {r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}
          </div>
          <div className="label" style={{ color: 'var(--accent-hi)' }}>{r.type} · {r.timing}{r.source === 'AI estimate' && ' · from the AI estimator'}{r.source === 'Calculator' && ' · from the instant price calculator'}</div>
          {r.ai_estimate?.products
            ? <div className="ai-box"><b>Customer picked {r.ai_estimate.title}: shown {money0(r.ai_estimate.total)} incl. VAT</b></div>
            : r.ai_estimate && (r.ai_estimate.failed
            ? <div className="ai-box"><b>The estimator couldn't price this.</b>{r.ai_estimate.questions?.length > 0 && <> It would ask: {r.ai_estimate.questions.join(' ')}</>}</div>
            : <div className="ai-box">
                <div><b>Customer was shown {money0(r.ai_estimate.low)} – {money0(r.ai_estimate.high)}</b> <span className="hint">(worked out at {money0(r.ai_estimate.total)}{r.ai_estimate.confidence !== 'calculator' && `, ${r.ai_estimate.confidence} confidence`})</span></div>
                <div className="hint">{r.ai_estimate.title}{r.ai_estimate.units > 1 ? ` × ${r.ai_estimate.units}` : ''} · {r.ai_estimate.mats.length} materials · {r.ai_estimate.labour.reduce((a, l) => a + l.hours, 0)} h labour per unit</div>
                {r.ai_estimate.assumptions?.length > 0 && <div className="hint">Assumed: {r.ai_estimate.assumptions.join(' · ')}</div>}
                {r.ai_estimate.questions?.length > 0 && <div className="hint">Ask: {r.ai_estimate.questions.join(' · ')}</div>}
              </div>)}
          <p style={{ margin: '6px 0 12px', whiteSpace: 'pre-line' }}>{r.detail || <span className="hint">No details given.</span>}</p>
          {r.photos.length > 0 && (photoUrls[r.id]
            ? <div className="thumbs">{photoUrls[r.id].map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="Customer photo" /></a>)}</div>
            : <p><button className="btn small" type="button" onClick={() => showPhotos(r)}>View {r.photos.length} photo{r.photos.length > 1 ? 's' : ''}</button></p>)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.status === 'New' && <>
              <button className="btn small primary" type="button" onClick={() => costIt(r)}>Cost this job</button>
              <button className="btn small" type="button" onClick={() => setStatus(r, 'Declined')}>Mark not suitable</button>
            </>}
            {r.status === 'Declined' && <button className="btn small" type="button" onClick={() => setStatus(r, 'New')}>Move back to new</button>}
          </div>
        </div>
      ))}
    </>
  )
}
