import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { Loading, ErrorNote } from './ui.jsx'

export default function Gallery({ toast }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', caption: '' })
  const [file, setFile] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = () => supabase.from('gallery').select('*').order('sort').then(({ data, error }) => { setItems(data || []); setError(error) })
  useEffect(() => { load() }, [])

  const url = (path) => supabase.storage.from('gallery').getPublicUrl(path).data.publicUrl

  async function upload(e) {
    e.preventDefault()
    if (!file || !form.title.trim()) { setError('Pick a photo and give it a title.'); return }
    if (file.size > 8 * 1024 * 1024) { setError('That photo is over 8 MB. Use a smaller one.'); return }
    setBusy(true)
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${crypto.randomUUID()}.${ext}`
    const up = await supabase.storage.from('gallery').upload(path, file, { contentType: file.type })
    if (up.error) { setError(up.error); setBusy(false); return }
    const sort = Math.max(0, ...items.map((i) => i.sort)) + 10
    const { error } = await supabase.from('gallery').insert({ title: form.title.trim(), caption: form.caption.trim() || null, path, sort })
    setBusy(false)
    if (error) { setError(error); return }
    setForm({ title: '', caption: '' }); setFile(null); e.target.reset(); setError(null); load(); toast('Photo added to the website')
  }

  async function toggle(item) {
    await supabase.from('gallery').update({ visible: !item.visible }).eq('id', item.id)
    load()
  }

  async function remove(item) {
    await supabase.storage.from('gallery').remove([item.path])
    await supabase.from('gallery').delete().eq('id', item.id)
    setConfirmDel(null); load(); toast('Photo deleted')
  }

  return (
    <>
      <div className="pagehead"><div><h1>Website photos</h1><p>Photos in the "Recent work" section of the website. The first 8 visible photos are shown.</p></div></div>
      <ErrorNote error={error} />
      <form className="card block" onSubmit={upload}>
        <div className="fgrid">
          <div className="field"><label htmlFor="g-file">Photo</label><input id="g-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
          <div className="field"><label htmlFor="g-title">Title</label><input id="g-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="3.0 m cage trailer" /></div>
          <div className="field"><label htmlFor="g-cap">Caption (optional)</label><input id="g-cap" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} placeholder="Galvanised, 750 kg GVM" /></div>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Add to website'}</button></div>
        </div>
      </form>
      {items === null ? <Loading /> : !items.length ? <div className="card hint">No photos yet. Until you add some, the website shows placeholder tiles.</div> : (
        <div className="gal-admin">
          {items.map((it) => (
            <div className="card" key={it.id} style={{ opacity: it.visible ? 1 : 0.55 }}>
              <img src={url(it.path)} alt={it.title} loading="lazy" />
              <b>{it.title}</b>{it.caption && <span className="hint">{it.caption}</span>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn small" type="button" onClick={() => toggle(it)}>{it.visible ? 'Hide' : 'Show'}</button>
                {confirmDel === it.id
                  ? <button className="btn small danger" type="button" onClick={() => remove(it)}>Confirm delete</button>
                  : <button className="btn small ghost" type="button" onClick={() => setConfirmDel(it.id)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
