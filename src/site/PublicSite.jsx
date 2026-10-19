import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { money0, waNumber } from '../format.js'

const SERVICES = [
  { tag: 'Trailers', h: 'Trailers', items: ['New builds to your size, 1.8 m to 4 m', 'Mesh cages, lids, ramps and tool boxes', 'Floors, axles, springs, wiring and lights', 'Galvanised or painted finish'], from: 'trailer', fromLabel: '3.0 m cage trailer from' },
  { tag: 'Skips', h: 'Skips', items: ["New 4 m³ and 6 m³ builder's skips", 'Floor and side replacement', 'Lifting lugs and pins renewed', 'Fleet rates for skip hire companies'], from: 'skip', fromLabel: '6 m³ skip from' },
  { tag: 'Custom work', h: 'Steel fabrication', items: ['Frames, racks and brackets', 'Farm and workshop equipment', 'One-off parts made to drawing or sample'], from: null },
  { tag: 'All steel work', h: 'Welding', items: ['MIG and arc welding in the workshop', 'Cracked frames and broken brackets', 'On-site welding by arrangement'], from: 'skiprep', fromLabel: 'Skip floor repair from' },
  { tag: 'General repairs', h: 'Gates & structures', items: ['Driveway and farm gates', 'Burglar bars and security frames', 'Carports, canopies and steel structures'], from: null },
]

const PLACEHOLDER_WORK = [
  { title: '3.0 m cage trailer', caption: 'Galvanised, 750 kg GVM' },
  { title: '6 m³ skip', caption: '4.5 mm plate, new build' },
  { title: 'Skip floor', caption: 'Cut out and replaced' },
  { title: 'Gate & frame', caption: 'Custom farm work' },
]

const TYPES = ['New trailer', 'Trailer repair', 'New skip', 'Skip repair', 'Custom fabrication']
const TIMINGS = ['As soon as possible', 'Within 2 weeks', 'Within a month', 'Just pricing for now']
const MAX_PHOTOS = 6
const MAX_BYTES = 8 * 1024 * 1024

export default function PublicSite() {
  const [info, setInfo] = useState({ people: [], from_prices: {} })
  const [work, setWork] = useState([])

  useEffect(() => {
    supabase.rpc('public_site_info').then(({ data }) => data && setInfo(data))
    supabase.from('gallery').select('id,title,caption,path').eq('visible', true).order('sort').limit(8)
      .then(({ data }) => data && setWork(data))
  }, [])

  const galleryUrl = (path) => supabase.storage.from('gallery').getPublicUrl(path).data.publicUrl

  return (
    <>
      <header className="site-head">
        <div className="wrap">
          <a className="brand" href="#top"><img src="/logo.webp" alt="" /><b>NJR <span>STEELWORKS</span></b></a>
          <nav className="site-nav" aria-label="Main">
            <a href="#services">Services</a>
            <a href="#process">How it works</a>
            <a href="#work">Our work</a>
            <a href="#contact">Contact</a>
            <a href="#quote" className="cta">Get a quote</a>
          </nav>
        </div>
      </header>

      <div className="hero" id="top">
        <div className="wrap">
          <div>
            <div className="label" style={{ color: 'var(--accent-hi)' }}>Trailers · Skips · Fabrication · Welding · Gates</div>
            <h1>Steel work that's <em>built to last</em></h1>
            <p className="lead">NJR Steelworks builds and repairs utility trailers and builder's skips, and takes on custom fabrication, welding, gates and structures for farms, contractors and homeowners. You get a full written quote before any steel is cut.</p>
            <div className="actions">
              <a className="btn primary" href="#quote">Request a quote</a>
              <a className="btn" href="#services">See prices</a>
            </div>
            <div className="facts">
              <div><b className="num">48 h</b><span className="label">Quote turnaround</span></div>
              <div><b className="num">50%</b><span className="label">Deposit to start</span></div>
              <div><b>MIG &amp; arc</b><span className="label">Welding in-house</span></div>
            </div>
          </div>
          <div className="badge"><img src="/logo.webp" alt="NJR Steelworks: Built to Last" width="1254" height="1254" /></div>
        </div>
      </div>

      <section className="band" id="services">
        <div className="wrap">
          <div className="band-head">
            <h2>What we do</h2>
            <p>"From" prices come from our costing system using current steel prices, and include VAT. Your quote is priced to your exact size and spec.</p>
          </div>
          <div className="services five">
            {SERVICES.map((s) => {
              const price = s.from && info.from_prices?.[s.from]
              return (
                <article className="svc" key={s.h}>
                  <span className="tag">{s.tag}</span>
                  <h3>{s.h}</h3>
                  <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
                  <div className="from">
                    {price
                      ? <><span className="label">{s.fromLabel}</span><b className="num">{money0(price)}</b></>
                      : <><span className="label">Priced per job</span><a href="#quote">Ask for a quote</a></>}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="band" id="process">
        <div className="wrap">
          <div className="band-head"><h2>How a job runs</h2><p>Same steps for a new build or a repair.</p></div>
          <ol className="steps">
            <li><b>Request</b><span>Send the size, use and photos through the form or WhatsApp.</span></li>
            <li><b>Measure</b><span>Repairs are inspected at the workshop or on site.</span></li>
            <li><b>Quote</b><span>Itemised quote within 48 hours, valid for 14 days.</span></li>
            <li><b>Build</b><span>50% deposit books your slot. We send progress photos.</span></li>
            <li><b>Collect</b><span>Pay the balance and collect, or we deliver for a fee.</span></li>
          </ol>
        </div>
      </section>

      <section className="band" id="work">
        <div className="wrap">
          <div className="band-head"><h2>Recent work</h2></div>
          <div className="gallery">
            {(work.length ? work : PLACEHOLDER_WORK).map((w, i) => (
              <div className="ph" key={w.id || i}>
                {w.path && <img src={galleryUrl(w.path)} alt={w.title} loading="lazy" />}
                <span>{w.title}{w.caption && <small>{w.caption}</small>}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band" id="quote">
        <div className="wrap quote-grid">
          <QuoteForm />
          <aside className="card" id="contact">
            <h3 style={{ fontSize: '1.8rem', textTransform: 'uppercase' }}>Call or WhatsApp</h3>
            {info.people.map((p) => (
              <div className="contact-person" key={p.name}>
                <b>{p.name}</b><span className="hint">{p.role}</span>
                <div className="phone">
                  <a className="num" href={`tel:${p.phone.replace(/\s/g, '')}`}>{p.phone}</a>
                  <a className="btn small ghost" href={`https://wa.me/${waNumber(p.phone)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                </div>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 12 }}>Workshop: Mon–Fri 07:30–17:00, Sat 08:00–12:00.<br />Address shared on booking.</p>
          </aside>
        </div>
      </section>

      <footer className="site-foot">
        <div className="wrap">
          <span>© {new Date().getFullYear()} NJR Steelworks · Fabrication · Repairs · Custom work · Skip repairs &amp; builds</span>
          <span className="script">Built to Last</span>
          <a href="/admin">Staff login</a>
        </div>
      </footer>
    </>
  )
}

function QuoteForm() {
  const empty = { name: '', phone: '', email: '', type: TYPES[0], detail: '', timing: TIMINGS[0] }
  const [f, setF] = useState(empty)
  const [files, setFiles] = useState([])
  const [state, setState] = useState({ busy: false, error: '', done: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  function pickFiles(e) {
    const list = [...e.target.files]
    const tooBig = list.find((x) => x.size > MAX_BYTES)
    if (list.length > MAX_PHOTOS) setState({ ...state, error: `Send up to ${MAX_PHOTOS} photos.` })
    else if (tooBig) setState({ ...state, error: `${tooBig.name} is over 8 MB. Send a smaller photo.` })
    else { setState({ ...state, error: '' }); setFiles(list); return }
    e.target.value = ''
    setFiles([])
  }

  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim() || f.phone.replace(/\D/g, '').length < 9) {
      setState({ busy: false, error: 'Add your name and a cell number so we can reach you.', done: '' })
      return
    }
    setState({ busy: true, error: '', done: '' })
    const id = crypto.randomUUID()
    const photos = []
    for (const [i, file] of files.entries()) {
      const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60)
      const path = `incoming/${id}/${i + 1}-${safe}`
      const { error } = await supabase.storage.from('request-photos').upload(path, file, { contentType: file.type })
      if (error) { setState({ busy: false, error: `Photo upload failed (${file.name}). Try again or send without photos.`, done: '' }); return }
      photos.push(path)
    }
    const { error } = await supabase.from('requests').insert({
      id, name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || null,
      type: f.type, detail: f.detail.trim() || null, timing: f.timing, photos,
    })
    if (error) { setState({ busy: false, error: 'Your request did not go through. Please try again, or call us.', done: '' }); return }
    setState({ busy: false, error: '', done: `Thanks, ${f.name.trim()}. Your request is in. Nico or Jeanette will call you on ${f.phone.trim()}.` })
    setF(empty); setFiles([]); e.target.reset()
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="band-head" style={{ marginBottom: 16 }}><h2>Request a quote</h2></div>
      <div className="fgrid">
        <div className="field"><label htmlFor="q-name">Your name</label><input id="q-name" value={f.name} onChange={set('name')} maxLength={120} autoComplete="name" required /></div>
        <div className="field"><label htmlFor="q-phone">Cell number</label><input id="q-phone" value={f.phone} onChange={set('phone')} maxLength={30} inputMode="tel" autoComplete="tel" required /></div>
        <div className="field"><label htmlFor="q-email">Email (optional)</label><input id="q-email" type="email" value={f.email} onChange={set('email')} maxLength={200} autoComplete="email" /></div>
        <div className="field"><label htmlFor="q-type">What do you need?</label>
          <select id="q-type" value={f.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field full"><label htmlFor="q-detail">Size, use and anything we should know</label>
          <textarea id="q-detail" value={f.detail} onChange={set('detail')} maxLength={4000} placeholder="e.g. 3 m x 1.5 m trailer with a mesh cage, for garden refuse" /></div>
        <div className="field"><label htmlFor="q-when">When do you need it?</label>
          <select id="q-when" value={f.timing} onChange={set('timing')}>{TIMINGS.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="q-photo">Photos (optional, up to 6)</label><input id="q-photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={pickFiles} /></div>
      </div>
      {state.error && <div className="errmsg">{state.error}</div>}
      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary" type="submit" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send request'}</button>
        <span className="hint">We reply within one working day.</span>
      </div>
      {state.done && <div className="okmsg">{state.done}</div>}
    </form>
  )
}
