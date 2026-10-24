import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase.js'
import { moveJob } from '../orders.js'
import { shortDate } from '../format.js'
import { Pill, Loading, ErrorNote } from './ui.jsx'

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => iso(new Date())
const longDate = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeText = (t) => (t ? String(t).slice(0, 5) : 'Time to confirm')
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const blank = (date) => ({ kind: 'Delivery', delivery_date: date, delivery_time: '', job_id: '', stock_item_id: null, customer: '', phone: '', address: '', what: '', notes: '' })

export default function Deliveries({ target, toast }) {
  const [list, setList] = useState(null)
  const [orders, setOrders] = useState([])
  const [error, setError] = useState(null)
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [day, setDay] = useState(todayIso)
  const [form, setForm] = useState(null)
  const [signing, setSigning] = useState(null)
  const [note, setNote] = useState(null)

  const load = async () => {
    const [d, j] = await Promise.all([
      supabase.from('deliveries').select('*').order('delivery_date').order('delivery_time', { nullsFirst: false }),
      supabase.from('jobs').select('id,quote_no,customer,phone,title,units,status,job_type,accepted_at,production_started_at,ready_at,delivered_at')
        .in('status', ['Received', 'In production', 'Ready', 'Delivered']).eq('job_type', 'Customer job').order('created_at', { ascending: false }),
    ])
    setList(d.data || []); setOrders(j.data || []); setError(d.error || j.error)
    return j.data || []
  }

  // Arriving from Orders ("Book delivery") or Stock: open the form filled in.
  useEffect(() => {
    load().then(async (jobs) => {
      if (target?.jobId) {
        const j = jobs.find((x) => x.id === target.jobId)
        if (j) setForm({ ...blank(todayIso()), job_id: j.id, customer: j.customer, phone: j.phone || '', what: `${j.title}${j.units > 1 ? ` × ${j.units}` : ''} (${j.quote_no})` })
      } else if (target?.stockItemId) {
        const { data: s } = await supabase.from('stock_items').select('*').eq('id', target.stockItemId).single()
        if (s) setForm({ ...blank(todayIso()), stock_item_id: s.id, customer: s.sold_to || '', phone: s.sold_phone || '', what: s.title })
      }
    })
  }, [target?.jobId, target?.stockItemId])

  if (!list) return error ? <ErrorNote error={error} /> : <Loading />

  const byDate = list.reduce((a, d) => ({ ...a, [d.delivery_date]: [...(a[d.delivery_date] || []), d] }), {})
  const first = new Date(month)
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1)))]
  while (cells.length % 7) cells.push(null)
  const dayList = byDate[day] || []
  const upcoming = list.filter((d) => d.status === 'Scheduled' && d.delivery_date >= todayIso()).slice(0, 5)

  async function save(e) {
    e.preventDefault()
    if (!form.customer.trim() || !form.delivery_date) { setError('Add the customer and the date.'); return }
    const row = {
      kind: form.kind, delivery_date: form.delivery_date, delivery_time: form.delivery_time || null,
      job_id: form.job_id || null, stock_item_id: form.stock_item_id || null, customer: form.customer.trim(),
      phone: form.phone.trim() || null, address: form.address.trim() || null, what: form.what.trim() || null, notes: form.notes.trim() || null,
    }
    const res = form.id ? await supabase.from('deliveries').update(row).eq('id', form.id) : await supabase.from('deliveries').insert(row)
    if (res.error) { setError(res.error); return }
    setError(null); setForm(null); setDay(row.delivery_date)
    const d = new Date(`${row.delivery_date}T12:00:00`); setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    toast(`${row.kind} booked for ${shortDate(row.delivery_date)}`); load()
  }

  function pickOrder(id) {
    const j = orders.find((x) => x.id === id)
    setForm({ ...form, job_id: id, ...(j ? { customer: j.customer, phone: j.phone || '', what: `${j.title}${j.units > 1 ? ` × ${j.units}` : ''} (${j.quote_no})` } : {}) })
  }

  async function cancel(d) {
    await supabase.from('deliveries').update({ status: 'Cancelled' }).eq('id', d.id)
    toast(`${d.kind} cancelled`); load()
  }

  async function signed(d, name, blob) {
    const path = `${d.id}.png`
    const up = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png', upsert: true })
    if (up.error) { setError(up.error); return }
    const { error } = await supabase.from('deliveries').update({ status: 'Done', signed_name: name, signature_path: path, signed_at: new Date().toISOString() }).eq('id', d.id)
    if (error) { setError(error); return }
    const job = d.job_id && orders.find((x) => x.id === d.job_id)
    if (job && job.status !== 'Delivered') await moveJob(job, 'Delivered')
    setSigning(null); toast(`Signed by ${name}${job ? `; ${job.quote_no} marked delivered` : ''}`); load()
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <>
      <div className="pagehead">
        <div><h1>Deliveries</h1><p>Deliveries and collections by day. The customer signs on this screen when it's done.</p></div>
        <button className="btn primary" type="button" onClick={() => setForm(blank(day))}>Book delivery or collection</button>
      </div>
      <ErrorNote error={error} />

      {form && (
        <form className="card block" onSubmit={save}>
          <div className="block-head"><h3>{form.id ? 'Change booking' : 'New booking'}</h3></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="d-kind">Type</label>
              <select id="d-kind" value={form.kind} onChange={set('kind')}><option>Delivery</option><option value="Collection">Collection (customer fetches)</option></select></div>
            <div className="field"><label htmlFor="d-job">Order (optional)</label>
              <select id="d-job" value={form.job_id || ''} onChange={(e) => pickOrder(e.target.value)}>
                <option value="">Not linked to an order</option>
                {orders.filter((o) => o.status !== 'Delivered' || o.id === form.job_id).map((o) => <option key={o.id} value={o.id}>{o.quote_no} · {o.customer} · {o.title}</option>)}
              </select></div>
            <div className="field"><label htmlFor="d-date">Date</label><input id="d-date" type="date" value={form.delivery_date} onChange={set('delivery_date')} /></div>
            <div className="field"><label htmlFor="d-time">Time (optional)</label><input id="d-time" type="time" value={form.delivery_time || ''} onChange={set('delivery_time')} /></div>
            <div className="field"><label htmlFor="d-cust">Customer</label><input id="d-cust" value={form.customer} onChange={set('customer')} /></div>
            <div className="field"><label htmlFor="d-ph">Cell</label><input id="d-ph" value={form.phone} onChange={set('phone')} /></div>
            {form.kind === 'Delivery' && <div className="field full"><label htmlFor="d-addr">Delivery address</label><input id="d-addr" value={form.address} onChange={set('address')} /></div>}
            <div className="field full"><label htmlFor="d-what">What's going</label><input id="d-what" value={form.what} onChange={set('what')} /></div>
            <div className="field full"><label htmlFor="d-notes">Notes (optional)</label><input id="d-notes" value={form.notes} onChange={set('notes')} placeholder="Gate code, call 30 min before, needs a tow hitch…" /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button className="btn primary" type="submit">Save booking</button><button className="btn ghost" type="button" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="cal-layout">
        <div className="card cal">
          <div className="block-head">
            <button className="btn small ghost" type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
            <h3>{month.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</h3>
            <button className="btn small ghost" type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
          </div>
          <div className="cal-grid">
            {DAYS.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {cells.map((c, i) => {
              const items = (c && byDate[c]) || []
              const live = items.filter((x) => x.status !== 'Cancelled')
              return c ? (
                <button key={c} type="button" className={`cal-day${c === day ? ' on' : ''}${c === todayIso() ? ' today' : ''}`} onClick={() => setDay(c)} aria-label={`${longDate(c)}: ${live.length} booked`}>
                  <span>{Number(c.slice(8))}</span>
                  {live.length > 0 && <i className={live.every((x) => x.status === 'Done') ? 'done' : ''}>{live.length}</i>}
                </button>
              ) : <div key={`x${i}`} />
            })}
          </div>
        </div>

        <div>
          <div className="block-head"><h3>{longDate(day)}</h3><button className="btn small" type="button" onClick={() => setForm(blank(day))}>Book for this day</button></div>
          {!dayList.length ? <div className="card hint block">Nothing booked for this day.</div> : dayList.map((d) => (
            <div key={d.id} className="card block" style={{ opacity: d.status === 'Cancelled' ? 0.55 : 1 }}>
              <div className="block-head">
                <div><b className="num">{timeText(d.delivery_time)}</b> · {d.kind} · <b>{d.customer}</b></div>
                <Pill status={d.status} />
              </div>
              {d.what && <div>{d.what}</div>}
              {d.address && <div className="hint">{d.address}</div>}
              {d.phone && <div className="hint">{d.phone}</div>}
              {d.notes && <div className="hint">{d.notes}</div>}
              {d.status === 'Done' && <div className="hint" style={{ marginTop: 4 }}>Signed by {d.signed_name} on {shortDate(d.signed_at)}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {d.status === 'Scheduled' && <button className="btn small primary" type="button" onClick={() => setSigning(d)}>Done: customer signs</button>}
                <button className="btn small" type="button" onClick={() => setNote(d)}>{d.kind} note</button>
                {d.status === 'Scheduled' && <button className="btn small ghost" type="button" onClick={() => setForm({ ...d, delivery_time: d.delivery_time ? String(d.delivery_time).slice(0, 5) : '', job_id: d.job_id || '', phone: d.phone || '', address: d.address || '', what: d.what || '', notes: d.notes || '' })}>Change</button>}
                {d.status === 'Scheduled' && <button className="btn small ghost" type="button" onClick={() => cancel(d)}>Cancel</button>}
              </div>
            </div>
          ))}
          {upcoming.length > 0 && (
            <>
              <div className="block-head"><h3>Coming up</h3></div>
              <div className="card">
                {upcoming.map((d) => (
                  <button key={d.id} type="button" className="up-row" onClick={() => { setDay(d.delivery_date); const x = new Date(`${d.delivery_date}T12:00:00`); setMonth(new Date(x.getFullYear(), x.getMonth(), 1)) }}>
                    <span className="num">{shortDate(d.delivery_date)} · {timeText(d.delivery_time)}</span><span>{d.kind}: {d.customer}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {signing && <SignDialog delivery={signing} onCancel={() => setSigning(null)} onSave={signed} />}
      {note && <DeliveryNote delivery={note} onClose={() => setNote(null)} />}
    </>
  )
}

export function SignDialog({ delivery, onCancel, onSave, title, statement }) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const [name, setName] = useState(delivery.customer)
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const c = canvas.current
    const ratio = window.devicePixelRatio || 1
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight)
  }, [])

  const point = (e) => { const r = canvas.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = (e) => { e.preventDefault(); canvas.current.setPointerCapture(e.pointerId); drawing.current = true; const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...point(e)) }
  const move = (e) => { if (!drawing.current) return; const ctx = canvas.current.getContext('2d'); ctx.lineTo(...point(e)); ctx.stroke(); setHasInk(true) }
  const up = () => { drawing.current = false }
  const clear = () => { const c = canvas.current; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight); setHasInk(false) }

  function save() {
    setBusy(true)
    canvas.current.toBlob((blob) => onSave(delivery, name.trim(), blob).finally(() => setBusy(false)), 'image/png')
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h3 style={{ fontSize: '1.6rem', textTransform: 'uppercase' }}>{title || `${delivery.kind} done`}</h3>
        <p className="hint">{delivery.what || delivery.customer}. Hand the screen to the customer to sign.</p>
        <div className="field"><label htmlFor="sg-name">Name of person signing</label><input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ marginTop: 12 }}><span className="flabel">Signature</span>
          <canvas ref={canvas} className="sig-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Signature pad" /></div>
        <p className="hint">{statement || 'By signing, the customer confirms they received the items in good order.'}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn primary" type="button" disabled={!hasInk || !name.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save signature'}</button>
          <button className="btn ghost" type="button" onClick={clear}>Clear</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function DeliveryNote({ delivery: d, onClose }) {
  const [sig, setSig] = useState(null)
  useEffect(() => {
    if (d.signature_path) supabase.storage.from('signatures').createSignedUrl(d.signature_path, 600).then(({ data }) => setSig(data?.signedUrl || null))
  }, [d.signature_path])
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-bar">
        <span className="label" style={{ color: '#fff' }}>{d.kind} note</span>
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
          <div style={{ textAlign: 'right' }}><h2>{d.kind} note</h2><div className="muted">{longDate(d.delivery_date)}</div></div>
        </div>
        <p style={{ margin: '16px 0' }}><span className="muted">Customer</span><br /><b>{d.customer}</b>{d.phone && <><br />{d.phone}</>}{d.address && <><br />{d.address}</>}</p>
        <div className="tbl-wrap"><table><thead><tr><th>Items</th></tr></thead><tbody><tr><td>{d.what || '—'}</td></tr></tbody></table></div>
        {d.notes && <p className="muted">{d.notes}</p>}
        <div style={{ marginTop: 28 }}>
          <div className="muted">Received in good order by</div>
          {sig ? <img src={sig} alt={`Signature of ${d.signed_name}`} style={{ height: 90, display: 'block', marginTop: 6 }} /> : <div style={{ borderBottom: '1px solid #999', height: 60, maxWidth: 320 }} />}
          <div>{d.signed_name || 'Name: ____________________'}{d.signed_at && <span className="muted"> · {new Date(d.signed_at).toLocaleString('en-ZA')}</span>}</div>
        </div>
      </div>
    </div>
  )
}
