import { useState } from 'react'
import { supabase } from '../supabase.js'
import { money0 } from '../format.js'
import { OPTIONS } from '../calculator.js'

const KINDS = [['trailer', 'Trailer'], ['skip', 'Skip'], ['gate', 'Gate']]
const DEFAULTS = {
  trailer: { length: 3, width: 1.5, cage: 1, axles: 1, finish: 'Painted', ramp: false, lid: false },
  skip: { size: 2, work: 'New build', units: 1 },
  gate: { width: 3, height: 1.8, type: 'Swing', infill: 'Vertical bars', finish: 'Painted' },
}
const m = (v) => `${Number(v).toFixed(1)} m`

// Free instant price calculator: pick options → priced by the instant-price function from
// NJR's price list and rates (only the range comes back) → optionally send to NJR.
export default function InstantCalc() {
  const [kind, setKind] = useState('trailer')
  const [opts, setOpts] = useState(DEFAULTS)
  const [state, setState] = useState({ busy: false, error: '', result: null })
  const [contact, setContact] = useState({ name: '', phone: '', email: '', note: '' })
  const [sent, setSent] = useState(false)
  const o = opts[kind]
  const set = (k, v) => { setOpts({ ...opts, [kind]: { ...o, [k]: v } }); setState({ busy: false, error: '', result: null }); setSent(false) }

  async function call(save) {
    setState((s) => ({ ...s, busy: true, error: '' }))
    const { data, error } = await supabase.functions.invoke('instant-price', { body: { kind, options: o, save, ...(save ? contact : {}) } })
    if (error) {
      const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
      setState((s) => ({ ...s, busy: false, error: msg || 'That didn\'t work. Try again, or send a quote request below.' }))
      return
    }
    setState({ busy: false, error: '', result: data })
    if (save) setSent(true)
  }

  const r = state.result
  const select = (k, label, values, fmt = (v) => v) => (
    <div className="field"><label htmlFor={`ic-${kind}-${k}`}>{label}</label>
      <select id={`ic-${kind}-${k}`} value={o[k]} onChange={(e) => set(k, typeof values[0] === 'number' ? Number(e.target.value) : e.target.value)}>
        {values.map((v) => <option key={v} value={v}>{fmt(v)}</option>)}
      </select></div>
  )

  return (
    <div className="card calc" id="price">
      <div className="block-head" style={{ marginBottom: 6 }}>
        <h2 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', textTransform: 'uppercase' }}>Instant price</h2>
        <div className="seg-tabs" role="tablist" aria-label="What are you pricing?">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setState({ busy: false, error: '', result: null }); setSent(false) }}>{label}</button>
          ))}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Pick the options and see a price straight away. It's an estimate from our current prices. Nico or Jeanette confirm the final price.</p>

      <div className="fgrid calc-grid">
        {kind === 'trailer' && <>
          {select('length', 'Length', OPTIONS.trailer.length, m)}
          {select('width', 'Width', OPTIONS.trailer.width, m)}
          {select('cage', 'Sides', OPTIONS.trailer.cage, (v) => (v === 0 ? '400 mm steel sides, no cage' : v === 1 ? '1 m mesh cage' : '600 mm mesh cage'))}
          {select('axles', 'Axles', OPTIONS.trailer.axles, (v) => (v === 1 ? 'Single axle' : 'Double axle'))}
          {select('finish', 'Finish', OPTIONS.trailer.finish)}
          <div className="field"><span className="flabel">Extras</span>
            <label className="check"><input type="checkbox" checked={o.ramp} onChange={(e) => set('ramp', e.target.checked)} /> Ramp at the back</label>
            <label className="check"><input type="checkbox" checked={o.lid} disabled={o.cage === 0} onChange={(e) => set('lid', e.target.checked)} /> Lockable lid {o.cage === 0 && <span className="hint">(needs a cage)</span>}</label></div>
        </>}
        {kind === 'skip' && <>
          {select('size', 'Size', OPTIONS.skip.size, (v) => `${v} m³`)}
          {select('work', 'What do you need?', OPTIONS.skip.work)}
          <div className="field"><label htmlFor="ic-skip-units">How many</label>
            <input id="ic-skip-units" type="number" min="1" max="20" step="1" value={o.units} onChange={(e) => set('units', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></div>
        </>}
        {kind === 'gate' && <>
          <div className="field"><label htmlFor="ic-gate-w">Opening width: {m(o.width)}</label>
            <input id="ic-gate-w" type="range" min="1" max="8" step="0.1" value={o.width} onChange={(e) => set('width', Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="ic-gate-h">Height: {m(o.height)}</label>
            <input id="ic-gate-h" type="range" min="1.2" max="2.4" step="0.1" value={o.height} onChange={(e) => set('height', Number(e.target.value))} /></div>
          {select('type', 'Type', OPTIONS.gate.type)}
          {select('infill', 'Infill', OPTIONS.gate.infill)}
          {select('finish', 'Finish', OPTIONS.gate.finish)}
        </>}
      </div>

      {state.error && <div className="errmsg">{state.error}</div>}
      {!r && <div style={{ marginTop: 14 }}><button className="btn primary" type="button" disabled={state.busy} onClick={() => call(false)}>{state.busy ? 'Working it out…' : 'Show my price'}</button></div>}

      {r && (
        <div className="ai-result" style={{ marginTop: 16 }}>
          <span className="label">Estimated price{r.units > 1 ? ` for ${r.units}` : ''}, incl. VAT</span>
          <div className="ai-range num">{money0(r.low)} – {money0(r.high)}</div>
          <b>{r.title}</b>
          <ul>{r.assumptions.map((a) => <li key={a} className="hint">{a}</li>)}</ul>

          {sent ? (
            <p className="okmsg">Sent. Nico or Jeanette will call you on {contact.phone} to confirm the price and book it in.</p>
          ) : (
            <div className="calc-send">
              <b>Happy with this? Send it to us to confirm and book.</b>
              <div className="fgrid" style={{ marginTop: 8 }}>
                <div className="field"><label htmlFor="ic-name">Your name</label><input id="ic-name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" maxLength={120} /></div>
                <div className="field"><label htmlFor="ic-phone">Cell number</label><input id="ic-phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} inputMode="tel" autoComplete="tel" maxLength={30} /></div>
                <div className="field"><label htmlFor="ic-email">Email (optional)</label><input id="ic-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" maxLength={200} /></div>
                <div className="field"><label htmlFor="ic-note">Anything else? (optional)</label><input id="ic-note" value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} maxLength={1000} placeholder="e.g. need it by month-end" /></div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn primary" type="button" disabled={state.busy} onClick={() => call(true)}>{state.busy ? 'Sending…' : 'Send to NJR'}</button>
                <button className="btn ghost" type="button" onClick={() => setState({ busy: false, error: '', result: null })}>Change options</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
