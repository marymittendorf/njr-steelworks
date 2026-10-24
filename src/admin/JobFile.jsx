import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { shortDate } from '../format.js'
import { ErrorNote, Loading } from './ui.jsx'
import { preparePhoto } from './photoPrep.js'
import { SignDialog } from './Deliveries.jsx'

const STAGES = [
  ['Received', 'Received from the client', 'The client\'s item as it was handed in: every side, any damage close up.'],
  ['Before', 'Before work starts', 'The job before you start.'],
  ['After', 'After: finished work', 'The finished job. Tick "Use on website" to put a photo in the website gallery.'],
  ['Delivered', 'Delivered / collected', 'At hand-over, with the client or at the delivery address.'],
]
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

// Job photos (Received / Before / After / Delivered) and signed hand-in records.
// Protects NJR if a client says something was damaged or never handed in.
export default function JobFile({ job, me, toast, onClose }) {
  const [photos, setPhotos] = useState(null)
  const [urls, setUrls] = useState({})
  const [handins, setHandins] = useState([])
  const [error, setError] = useState(null)
  const [busyStage, setBusyStage] = useState(null)
  const [newHandin, setNewHandin] = useState(null)
  const [signing, setSigning] = useState(null)
  const [receipt, setReceipt] = useState(null)

  const load = async () => {
    const [p, h] = await Promise.all([
      supabase.from('job_photos').select('*').eq('job_id', job.id).order('created_at'),
      supabase.from('job_handins').select('*').eq('job_id', job.id).order('created_at'),
    ])
    setPhotos(p.data || []); setHandins(h.data || []); setError(p.error || h.error)
    const paths = (p.data || []).map((x) => x.path)
    if (paths.length) {
      const { data } = await supabase.storage.from('job-photos').createSignedUrls(paths, 3600)
      setUrls(Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl])))
    }
  }
  useEffect(() => { load() }, [job.id])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !signing && !receipt && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, signing, receipt])

  async function upload(stage, files) {
    if (!files.length) return
    setBusyStage(stage); setError(null)
    try {
      for (const f of files) {
        const { blob, takenAt, type } = await preparePhoto(f)
        const path = `${job.id}/${stage.toLowerCase()}-${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('job-photos').upload(path, blob, { contentType: type })
        if (up.error) throw up.error
        const { error } = await supabase.from('job_photos').insert({ job_id: job.id, stage, path, taken_at: takenAt, taken_by: me?.name || null })
        if (error) throw error
      }
      toast(`${files.length} photo${files.length > 1 ? 's' : ''} added to ${stage}`)
      await load()
    } catch (e) { setError(e) } finally { setBusyStage(null) }
  }

  async function saveNote(p, note) {
    await supabase.from('job_photos').update({ note: note || null }).eq('id', p.id)
  }

  async function togglePublish(p) {
    setError(null)
    try {
      if (p.gallery_id) {
        const { data: g } = await supabase.from('gallery').select('path').eq('id', p.gallery_id).single()
        await supabase.from('gallery').delete().eq('id', p.gallery_id)
        if (g?.path) await supabase.storage.from('gallery').remove([g.path])
        await supabase.from('job_photos').update({ gallery_id: null }).eq('id', p.id)
        toast('Taken off the website')
      } else {
        const blob = await (await fetch(urls[p.path])).blob()
        const path = `${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('gallery').upload(path, blob, { contentType: 'image/jpeg' })
        if (up.error) throw up.error
        const { data: g, error } = await supabase.from('gallery').insert({ title: job.title, caption: p.note || null, path, sort: 0 }).select('id').single()
        if (error) throw error
        await supabase.from('job_photos').update({ gallery_id: g.id }).eq('id', p.id)
        toast('Added to the website gallery')
      }
      load()
    } catch (e) { setError(e) }
  }

  async function removePhoto(p) {
    if (p.gallery_id) await togglePublish(p)
    await supabase.storage.from('job-photos').remove([p.path])
    const { error } = await supabase.from('job_photos').delete().eq('id', p.id)
    if (error) setError(error); else { toast('Photo deleted'); load() }
  }

  async function saveHandin() {
    const items = newHandin.items.filter((i) => i.desc.trim()).map((i) => ({ desc: i.desc.trim(), qty: Math.max(1, Number(i.qty) || 1), condition: i.condition.trim() }))
    if (!items.length) { setError('List at least one item the client handed in.'); return }
    const { data, error } = await supabase.from('job_handins').insert({ job_id: job.id, items, notes: newHandin.notes.trim() || null, received_by: me?.name || null }).select().single()
    if (error) { setError(error); return }
    setNewHandin(null); setError(null); toast('Hand-in saved. Now let the client sign.'); await load(); setSigning(data)
  }

  async function signed(h, name, blob) {
    const path = `handin-${h.id}.png`
    const up = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png', upsert: true })
    if (up.error) { setError(up.error); return }
    const { error } = await supabase.from('job_handins').update({ signed_name: name, signature_path: path, signed_at: new Date().toISOString() }).eq('id', h.id)
    if (error) { setError(error); return }
    setSigning(null); toast(`Hand-in signed by ${name}`); load()
  }

  const byStage = (s) => (photos || []).filter((p) => p.stage === s)
  const isOwner = me?.role === 'owner'

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card jobfile">
        <div className="block-head">
          <div><h3 style={{ fontSize: '1.7rem', textTransform: 'uppercase' }}>Photos &amp; hand-in</h3>
            <span className="hint">{job.quote_no}{job.invoice_no ? ` · ${job.invoice_no}` : ''} · {job.customer} · {job.title}</span></div>
          <button className="btn small" type="button" onClick={onClose}>Close</button>
        </div>
        <ErrorNote error={error} />
        {!photos ? <Loading /> : (
          <>
            {/* Hand-in records */}
            <section className="jf-section">
              <div className="block-head"><h3>Items handed in by the client</h3>
                {!newHandin && <button className="btn small primary" type="button" onClick={() => setNewHandin({ items: [{ desc: '', qty: 1, condition: '' }], notes: '' })}>Record items handed in</button>}</div>
              <p className="hint" style={{ marginTop: 0 }}>For anything the client brings in: list each item and its condition, take photos under "Received", and let the client sign. Print the receipt and give them a copy.</p>
              {handins.map((h) => (
                <div key={h.id} className="handin">
                  <div className="block-head">
                    <b>Handed in {stamp(h.created_at)}{h.received_by ? ` · received by ${h.received_by}` : ''}</b>
                    <span className={`pill ${h.signed_at ? 'st-Done' : 'st-Scheduled'}`}>{h.signed_at ? `Signed by ${h.signed_name}` : 'Not signed yet'}</span>
                  </div>
                  <ul>{h.items.map((i, k) => <li key={k}><b>{i.qty} × {i.desc}</b>{i.condition && <span className="hint">: {i.condition}</span>}</li>)}</ul>
                  {h.notes && <p className="hint">{h.notes}</p>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!h.signed_at && <button className="btn small primary" type="button" onClick={() => setSigning(h)}>Client signs</button>}
                    <button className="btn small" type="button" onClick={() => setReceipt(h)}>Hand-in receipt</button>
                  </div>
                </div>
              ))}
              {newHandin && (
                <div className="handin">
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>Item</th><th className="r">Qty</th><th>Condition when handed in</th><th /></tr></thead>
                    <tbody>{newHandin.items.map((it, i) => (
                      <tr key={i}>
                        <td><input aria-label="Item" value={it.desc} onChange={(e) => setNewHandin({ ...newHandin, items: newHandin.items.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })} placeholder="e.g. 3 m trailer, reg CAW 12345" /></td>
                        <td className="r"><input className="qty num" aria-label="Quantity" type="number" min="1" value={it.qty} onChange={(e) => setNewHandin({ ...newHandin, items: newHandin.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} /></td>
                        <td><input aria-label="Condition" value={it.condition} onChange={(e) => setNewHandin({ ...newHandin, items: newHandin.items.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) })} placeholder="e.g. left mudguard dented, rust on floor" /></td>
                        <td><button className="x" type="button" aria-label="Remove item" onClick={() => setNewHandin({ ...newHandin, items: newHandin.items.filter((_, j) => j !== i) })}>×</button></td>
                      </tr>))}</tbody>
                  </table></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
                    <button className="btn small" type="button" onClick={() => setNewHandin({ ...newHandin, items: [...newHandin.items, { desc: '', qty: 1, condition: '' }] })}>Add item</button>
                  </div>
                  <div className="field"><label htmlFor="hi-notes">Notes (optional)</label><input id="hi-notes" value={newHandin.notes} onChange={(e) => setNewHandin({ ...newHandin, notes: e.target.value })} placeholder="e.g. spare wheel and jack not included" /></div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn primary" type="button" onClick={saveHandin}>Save, then client signs</button>
                    <button className="btn ghost" type="button" onClick={() => setNewHandin(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </section>

            {/* Photos by stage */}
            {STAGES.map(([stage, label, help]) => (
              <section key={stage} className="jf-section">
                <div className="block-head"><h3>{label} <span className="hint">({byStage(stage).length})</span></h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label className="btn small primary">{busyStage === stage ? 'Uploading…' : 'Take photo'}
                      <input type="file" accept="image/*" capture="environment" hidden disabled={!!busyStage} onChange={(e) => { upload(stage, [...e.target.files]); e.target.value = '' }} /></label>
                    <label className="btn small">Choose files
                      <input type="file" accept="image/*" multiple hidden disabled={!!busyStage} onChange={(e) => { upload(stage, [...e.target.files]); e.target.value = '' }} /></label>
                  </div></div>
                <p className="hint" style={{ marginTop: 0 }}>{help}</p>
                {byStage(stage).length > 0 && (
                  <div className="jf-grid">
                    {byStage(stage).map((p) => (
                      <figure key={p.id} className="jf-photo">
                        {urls[p.path] ? <a href={urls[p.path]} target="_blank" rel="noopener noreferrer"><img src={urls[p.path]} alt={`${stage} photo`} loading="lazy" /></a> : <div className="jf-ph" />}
                        <figcaption>
                          <span className="hint">Uploaded {stamp(p.created_at)}{p.taken_by ? ` by ${p.taken_by}` : ''}</span>
                          <input aria-label="Photo note" defaultValue={p.note || ''} placeholder="Note (optional)" onBlur={(e) => e.target.value !== (p.note || '') && saveNote(p, e.target.value)} />
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            {stage === 'After' && <label className="check"><input type="checkbox" checked={Boolean(p.gallery_id)} onChange={() => togglePublish(p)} /> Use on website</label>}
                            {isOwner && <button className="linkbtn" type="button" onClick={() => removePhoto(p)}>Delete</button>}
                          </div>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </div>
      {signing && <SignDialog delivery={{ customer: job.customer, what: signing.items.map((i) => `${i.qty} × ${i.desc}`).join(', ') }}
        title="Items handed in" statement="By signing, the client confirms they handed in the items listed, in the condition described."
        onCancel={() => setSigning(null)} onSave={(_, name, blob) => signed(signing, name, blob)} />}
      {receipt && <HandinReceipt job={job} handin={receipt} photos={byStage('Received')} urls={urls} onClose={() => setReceipt(null)} />}
    </div>
  )
}

function HandinReceipt({ job, handin: h, photos, urls, onClose }) {
  const [sig, setSig] = useState(null)
  useEffect(() => {
    if (h.signature_path) supabase.storage.from('signatures').createSignedUrl(h.signature_path, 600).then(({ data }) => setSig(data?.signedUrl || null))
  }, [h.signature_path])
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-bar">
        <span className="label" style={{ color: '#fff' }}>Hand-in receipt</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small primary" type="button" onClick={() => window.print()}>Print / save PDF</button>
          <button className="btn small" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="doc">
        <div className="dh">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <img src="/logo.webp" alt="NJR Steelworks" />
            <div><b style={{ fontFamily: 'var(--f-display)', fontSize: '1.6rem' }}>NJR STEELWORKS</b><div className="muted">George, Western Cape</div></div>
          </div>
          <div style={{ textAlign: 'right' }}><h2>Items received</h2><div className="muted">{stamp(h.created_at)}</div><div className="muted num">Job {job.quote_no}{job.invoice_no ? ` · ${job.invoice_no}` : ''}</div></div>
        </div>
        <p style={{ margin: '16px 0' }}><span className="muted">From</span><br /><b>{job.customer}</b>{job.phone && <><br />{job.phone}</>}</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th className="r">Qty</th><th>Item</th><th>Condition when handed in</th></tr></thead>
          <tbody>{h.items.map((i, k) => <tr key={k}><td className="r num">{i.qty}</td><td>{i.desc}</td><td>{i.condition || 'No damage noted'}</td></tr>)}</tbody>
        </table></div>
        {h.notes && <p className="muted">{h.notes}</p>}
        {photos.length > 0 && <>
          <p className="muted" style={{ marginBottom: 6 }}>Photos taken when received ({photos.length})</p>
          <div className="receipt-photos">{photos.map((p) => urls[p.path] && <figure key={p.id}><img src={urls[p.path]} alt="Received" /><figcaption className="muted">{stamp(p.created_at)}{p.note ? ` · ${p.note}` : ''}</figcaption></figure>)}</div>
        </>}
        <div className="terms">The items above were received by NJR Steelworks{h.received_by ? ` (${h.received_by})` : ''} in the condition described and shown in the photos. Please keep this receipt.</div>
        <div style={{ marginTop: 20 }}>
          <div className="muted">Handed in by the client</div>
          {sig ? <img src={sig} alt={`Signature of ${h.signed_name}`} style={{ height: 90, display: 'block', marginTop: 6 }} /> : <div style={{ borderBottom: '1px solid #999', height: 60, maxWidth: 320 }} />}
          <div>{h.signed_name || 'Name: ____________________'}{h.signed_at && <span className="muted"> · {stamp(h.signed_at)}</span>}</div>
        </div>
      </div>
    </div>
  )
}
