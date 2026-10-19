import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { fromTemplate, ratesFrom, TEMPLATE_FOR_REQUEST } from '../costing.js'
import { shortDate, waNumber } from '../format.js'
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

  function costIt(r) {
    const tpl = TEMPLATE_FOR_REQUEST[r.type] || 'custom'
    go('cost', {
      draft: {
        ...fromTemplate(tpl, prices.filter((p) => p.active)),
        customer: r.name, phone: r.phone, email: r.email || '', notes: r.detail || '',
        units: 1, galv: false, markup: settings.markup, status: 'Draft', request_id: r.id,
        rates: ratesFrom(settings),
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
          <div className="label" style={{ color: 'var(--accent-hi)' }}>{r.type} · {r.timing}</div>
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
