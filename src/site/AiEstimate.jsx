import { useState } from 'react'
import { supabase } from '../supabase.js'
import { money0 } from '../format.js'

const TYPES = ['New trailer', 'Trailer repair', 'New skip', 'Skip repair', 'Custom fabrication']
const HINTS = {
  'New trailer': 'e.g. 3 m × 1.5 m single-axle trailer with a 1 m mesh cage, ramp at the back, galvanised. For garden refuse.',
  'Trailer repair': 'e.g. 2.4 m trailer, the floor is rusted through and the lights don\'t work. Want a chequer-plate floor.',
  'New skip': 'e.g. Two 3 m³ builder\'s skips with lifting lugs, painted yellow.',
  'Skip repair': 'e.g. 6 m³ skip with a cracked floor and one bent lifting lug.',
  'Custom fabrication': 'e.g. Sliding driveway gate 4 m wide × 1.8 m high, square tube with vertical bars.',
}

// "Instant estimate" on the website: the visitor describes the job, the ai-estimate function
// works out a price range from NJR's own price list and rates, and the request lands in Requests.
export default function AiEstimate() {
  const [f, setF] = useState({ name: '', phone: '', email: '', type: TYPES[0], description: '' })
  const [state, setState] = useState({ busy: false, error: '', result: null })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim() || f.phone.replace(/\D/g, '').length < 9) { setState({ busy: false, error: 'Add your name and a cell number so we can confirm the price with you.', result: null }); return }
    if (f.description.trim().length < 15) { setState({ busy: false, error: 'Tell us a bit more: what it is, the size, and what it\'s for.', result: null }); return }
    setState({ busy: true, error: '', result: null })
    const { data, error } = await supabase.functions.invoke('ai-estimate', { body: f })
    if (error) {
      const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
      setState({ busy: false, error: msg || 'The estimate didn\'t come through. Try again, or send a quote request below.', result: null })
      return
    }
    setState({ busy: false, error: '', result: data })
  }

  const r = state.result
  return (
    <div className="card ai-est" id="estimate">
      <div className="band-head" style={{ marginBottom: 6 }}><h2>Instant estimate</h2></div>
      <p className="hint" style={{ marginTop: 0 }}>Describe what you need, with sizes, and get a price range in about half a minute. It's an estimate: Nico or Jeanette will confirm the final price.</p>

      {r ? (
        <div className="ai-result">
          {r.ok ? (
            <>
              <span className="label">Estimated price{r.units > 1 ? ` for ${r.units}` : ''}, incl. VAT</span>
              <div className="ai-range num">{money0(r.low)} – {money0(r.high)}</div>
              <b>{r.title}</b>
              {r.assumptions?.length > 0 && <><p className="hint" style={{ marginBottom: 4 }}>Based on:</p><ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></>}
              {r.questions?.length > 0 && <><p className="hint" style={{ marginBottom: 4 }}>To firm up the price we'll ask:</p><ul>{r.questions.map((q) => <li key={q}>{q}</li>)}</ul></>}
              <p className="okmsg">We've received your request. Nico or Jeanette will call you on {f.phone} to confirm the price.</p>
            </>
          ) : (
            <>
              <p>{r.message}</p>
              {r.questions?.length > 0 && <ul>{r.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
            </>
          )}
          <button className="btn small" type="button" onClick={() => { setState({ busy: false, error: '', result: null }); setF({ ...f, description: '' }) }}>Estimate something else</button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="fgrid">
            <div className="field"><label htmlFor="ai-type">What do you need?</label>
              <select id="ai-type" value={f.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="ai-name">Your name</label><input id="ai-name" value={f.name} onChange={set('name')} maxLength={120} autoComplete="name" /></div>
            <div className="field full"><label htmlFor="ai-desc">Describe it: sizes, use, extras</label>
              <textarea id="ai-desc" value={f.description} onChange={set('description')} maxLength={2000} placeholder={HINTS[f.type]} /></div>
            <div className="field"><label htmlFor="ai-phone">Cell number</label><input id="ai-phone" value={f.phone} onChange={set('phone')} maxLength={30} inputMode="tel" autoComplete="tel" /></div>
            <div className="field"><label htmlFor="ai-email">Email (optional)</label><input id="ai-email" type="email" value={f.email} onChange={set('email')} maxLength={200} autoComplete="email" /></div>
          </div>
          {state.error && <div className="errmsg">{state.error}</div>}
          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" type="submit" disabled={state.busy}>{state.busy ? 'Working it out…' : 'Get my estimate'}</button>
            <span className="hint">{state.busy ? 'This takes up to a minute.' : 'Prices include VAT.'}</span>
          </div>
        </form>
      )}
    </div>
  )
}
