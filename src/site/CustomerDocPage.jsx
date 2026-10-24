import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { addDays, money, shortDate } from '../format.js'

// njrsteelworks.co.za/q/<token>: the customer's own copy of a quote or invoice, from the link in the email.
// A quote can be accepted or declined here; accepting books the job and NJR issues the invoice.
export default function CustomerDocPage({ token }) {
  const [d, setD] = useState(undefined)
  const [answer, setAnswer] = useState(null) // { accept, name, note }
  const [state, setState] = useState({ busy: false, error: '', done: '' })

  const load = () => supabase.rpc('customer_document', { p_token: token }).then(({ data }) => setD(data || null))
  useEffect(() => { load() }, [token])

  if (d === undefined) return <Shell><p className="hint">Loading…</p></Shell>
  if (!d) return <Shell><h2>Link not found</h2><p>This link isn't valid any more. Please contact NJR Steelworks for a new copy.</p></Shell>

  const doc = d.doc
  const isInvoice = d.kind === 'invoice'
  const number = isInvoice ? d.invoice_no : d.quote_no
  const date = isInvoice ? d.invoice_date : d.quote_date
  const validUntil = !isInvoice && d.quote_date ? addDays(d.quote_date, doc.validity || 14) : null
  const paid = Number(d.amount_paid || 0)

  async function send() {
    if (!answer.name.trim()) { setState({ busy: false, error: 'Please type your name.', done: '' }); return }
    setState({ busy: true, error: '', done: '' })
    const { data, error } = await supabase.rpc('answer_quote', { p_token: token, p_accept: answer.accept, p_name: answer.name.trim(), p_note: answer.note.trim() })
    if (error || !data?.ok) { setState({ busy: false, error: data?.error || 'That did not go through. Please try again, or call us.', done: '' }); return }
    setState({ busy: false, error: '', done: answer.accept
      ? `Thank you, ${answer.name.trim()}. Your quote is accepted and your job is booked. We'll be in touch about the ${doc.deposit_pct}% deposit and timing.`
      : `Thank you for letting us know, ${answer.name.trim()}.` })
    setAnswer(null); load()
  }

  return (
    <Shell>
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn small" type="button" onClick={() => window.print()}>Print / save PDF</button>
      </div>
      <div className="doc" style={{ margin: 0 }}>
        <div className="dh">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <img src="/logo.webp" alt="NJR Steelworks" />
            <div><b style={{ fontFamily: 'var(--f-display)', fontSize: '1.6rem' }}>NJR STEELWORKS</b>
              <div className="muted">George, Western Cape</div>
              {(d.people || []).map((p) => <div className="muted" key={p.name}>{p.name} {p.phone}{p.email && ` · ${p.email}`}</div>)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2>{isInvoice ? 'Tax invoice' : 'Quotation'}</h2>
            <div className="num"><b>{number}</b></div>
            {date && <div className="muted">Date {shortDate(date)}</div>}
            {validUntil && <div className="muted">Valid until {shortDate(validUntil)}</div>}
          </div>
        </div>
        <p style={{ margin: '16px 0', whiteSpace: 'pre-line' }}><span className="muted">For</span><br />
          {d.customer_company ? <><b>{d.customer_company}</b><br />{d.customer}</> : <b>{d.customer}</b>}
          {d.customer_address && <><br />{d.customer_address}</>}{d.customer_vat && <><br />VAT no. {d.customer_vat}</>}</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Amount excl. VAT</th></tr></thead>
          <tbody>{doc.lines.map((l, i) => <tr key={i}><td>{l.desc}</td><td className="r num">{l.qty}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody>
        </table></div>
        <div className="totals num">
          <span>Subtotal</span><span>{money(doc.excl)}</span>
          <span>VAT {doc.vat_rate}%</span><span>{money(doc.vat)}</span>
          <span className="grand">Total</span><span className="grand">{money(doc.total)}</span>
          {!isInvoice && <><span className="muted">Deposit {doc.deposit_pct}% to book</span><span className="muted">{money(doc.deposit)}</span></>}
          {isInvoice && paid > 0 && <><span className="muted">Paid to date</span><span className="muted">−{money(paid)}</span></>}
          {isInvoice && !d.voided && <><span><b>Balance due</b></span><span><b>{money(Math.max(0, doc.total - paid))}</b></span></>}
        </div>
        {doc.client_parts?.length > 0 && <p className="muted" style={{ marginTop: 14 }}><b>Supplied by you (not charged):</b> {doc.client_parts.join(', ')}.</p>}
        {d.bank_details && <div className="terms">Banking details:{'\n'}{d.bank_details}{'\n'}Reference: {number}</div>}
      </div>

      {!isInvoice && (
        <div className="card no-print" style={{ marginTop: 16 }}>
          {state.done && <p className="okmsg" style={{ marginTop: 0 }}>{state.done}</p>}
          {d.response && !state.done && <p style={{ margin: 0 }}><b>You {d.response.toLowerCase()} this quote</b> on {shortDate(d.response_at)}. Questions? Call or WhatsApp us.</p>}
          {!d.response && !d.can_answer && !state.done && <p style={{ margin: 0 }}>This quote can't be answered online any more. Please call or WhatsApp us.</p>}
          {d.can_answer && !answer && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <b style={{ marginRight: 'auto' }}>Happy with this quote?</b>
              <button className="btn primary" type="button" onClick={() => setAnswer({ accept: true, name: d.customer || '', note: '' })}>Accept quote</button>
              <button className="btn" type="button" onClick={() => setAnswer({ accept: false, name: d.customer || '', note: '' })}>Decline</button>
            </div>)}
          {answer && (
            <div>
              <b>{answer.accept ? `Accept quote ${number} for ${money(doc.total)}` : `Decline quote ${number}`}</b>
              <div className="fgrid" style={{ marginTop: 10 }}>
                <div className="field"><label htmlFor="ans-name">Your name</label><input id="ans-name" value={answer.name} onChange={(e) => setAnswer({ ...answer, name: e.target.value })} autoComplete="name" maxLength={120} /></div>
                <div className="field"><label htmlFor="ans-note">{answer.accept ? 'Anything we should know? (optional)' : 'Reason (optional)'}</label>
                  <input id="ans-note" value={answer.note} onChange={(e) => setAnswer({ ...answer, note: e.target.value })} maxLength={1000} placeholder={answer.accept ? 'e.g. delivery address, best time' : ''} /></div>
              </div>
              {state.error && <div className="errmsg">{state.error}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" type="button" disabled={state.busy} onClick={send}>{state.busy ? 'Sending…' : answer.accept ? 'Confirm: accept' : 'Confirm: decline'}</button>
                <button className="btn ghost" type="button" onClick={() => setAnswer(null)}>Back</button>
              </div>
            </div>)}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return <main className="wrap" style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 64px' }}>{children}</main>
}
