import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, clientParts, customerDoc, customerLines } from '../costing.js'
import { addDays, money, shortDate } from '../format.js'
import { BillTo } from './ui.jsx'

// email: open with the Email panel already showing (the Email button on quotes and invoices).
export default function QuoteDoc({ job, settings, onClose, onSent, email = false }) {
  const docRef = useRef(null)
  const [emailing, setEmailing] = useState(email && Boolean(job.id))
  const t = calc(job)
  const isInvoice = Boolean(job.invoice_no) // an accepted quote becomes an invoice (numbered by the database)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-bar">
        <span className="label" style={{ color: '#fff' }}>Customer view · {isInvoice ? 'tax invoice' : 'quotation'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {job.id && <button className="btn small primary" type="button" onClick={() => setEmailing(!emailing)}>Email to client</button>}
          <button className="btn small" type="button" onClick={() => window.print()}>Print / save PDF</button>
          <button className="btn small" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      {emailing && <EmailPanel job={job} isInvoice={isInvoice} total={t.total} docRef={docRef} onSent={(msg) => { setEmailing(false); onSent?.(msg) }} />}
      <DocPaper job={job} settings={settings} paperRef={docRef} />
    </div>
  )
}

// The quote or invoice exactly as the customer gets it (white A4). Used in the pop-up and on the invoice page.
export function DocPaper({ job, settings, paperRef }) {
  const t = calc(job)
  const r = job.rates
  const isInvoice = Boolean(job.invoice_no)
  const lines = customerLines(job)
  return (
    <div className="doc" ref={paperRef}>
      <div className="dh">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <img src="/logo.webp" alt="NJR Steelworks" />
          <div>
            <b style={{ fontFamily: 'var(--f-display)', fontSize: '1.6rem' }}>NJR STEELWORKS</b>
            <div className="muted">Fabrication · Repairs · Custom work</div>
            {settings.people.map((p) => <div className="muted" key={p.name}>{p.name} {p.phone}{p.email && ` · ${p.email}`}</div>)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2>{isInvoice ? 'Tax invoice' : 'Quotation'}</h2>
          <div className="num"><b>{isInvoice ? job.invoice_no : job.quote_no}</b></div>
          <div className="muted">Date {shortDate(isInvoice ? job.invoice_date : job.quote_date)}</div>
          {isInvoice && <div className="muted num">Quote ref {job.quote_no}</div>}
          {!isInvoice && <div className="muted">Valid until {shortDate(addDays(job.quote_date, r.validity))}</div>}
        </div>
      </div>
      <BillTo who={job} />
      <div className="tbl-wrap"><table>
        <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Amount excl. VAT</th></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}><td>{l.desc}</td><td className="r num">{l.qty}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody>
      </table></div>
      <div className="totals num">
        <span>Subtotal</span><span>{money(t.excl)}</span>
        <span>VAT {r.vat}%</span><span>{money(t.vat)}</span>
        <span className="grand">Total</span><span className="grand">{money(t.total)}</span>
        {!isInvoice && <><span className="muted">Deposit {r.deposit}% to book</span><span className="muted">{money(t.deposit)}</span></>}
        {isInvoice && Number(job.amount_paid) > 0 && <><span className="muted">Paid to date</span><span className="muted">−{money(job.amount_paid)}</span></>}
        {isInvoice && !job.invoice_voided_at && (Number(job.amount_paid) > 0
          ? <><span><b>Balance due</b></span><span><b>{money(Math.max(0, t.total - Number(job.amount_paid)))}</b></span></>
          : <><span><b>Deposit due now ({r.deposit}%)</b></span><span><b>{money(t.deposit)}</b></span></>)}
        {isInvoice && job.invoice_voided_at && <><span><b>VOID</b></span><span><b>{money(0)}</b></span></>}
      </div>
      {clientParts(job).length > 0 && <p className="muted" style={{ marginTop: 14 }}><b>Supplied by the customer (not charged):</b> {clientParts(job).map((m) => `${m.qty} × ${m.name}`).join(', ')}. NJR fits these as supplied.</p>}
      <div className="terms">
        <b>Terms. </b>
        {isInvoice
          ? (Number(job.amount_paid) >= t.total - 0.5 ? 'Thank you, this invoice is paid in full.' : `A ${r.deposit}% deposit is due before work starts; the balance is due on collection or delivery.`)
          : `Quote valid for ${r.validity} days. Steel prices can change after that. Work is booked once the ${r.deposit}% deposit reflects; the balance is paid on collection.`}
        {settings.bank_details && `\n\nBanking details:\n${settings.bank_details}\nReference: ${isInvoice ? job.invoice_no : job.quote_no}`}
      </div>
    </div>
  )
}

// Turns the document on screen into a PDF and sends it through the send-document Edge Function.
function EmailPanel({ job, isInvoice, total, docRef, onSent }) {
  const kind = isInvoice ? 'Invoice' : 'Quote'
  const number = isInvoice ? job.invoice_no : job.quote_no
  const first = (job.customer || '').split(' ')[0]
  const link = job.share_token ? `${window.location.origin}/q/${job.share_token}` : ''
  const [to, setTo] = useState(job.email || '')
  const [subject, setSubject] = useState(`${isInvoice ? 'Invoice' : 'Quotation'} ${number} from NJR Steelworks`)
  const [message, setMessage] = useState(isInvoice
    ? `Hi ${first},

Please find attached invoice ${number} for ${job.title} (${money(total)} incl. VAT).
${link ? `\nView it online: ${link}\n` : ''}
Thank you for your business.

Kind regards
NJR Steelworks
George, Western Cape`
    : `Hi ${first},

Thank you for your enquiry. Please find attached quotation ${number} for ${job.title} (${money(total)} incl. VAT).

${link ? `Accept or decline it online here: ${link}\n\nOr reply` : 'Reply'} to this email or WhatsApp us to accept, and we'll book your job.

Kind regards
NJR Steelworks
George, Western Cape`)
  const [state, setState] = useState({ busy: false, error: '' })
  const [log, setLog] = useState([])

  useEffect(() => {
    supabase.from('job_emails').select('*').eq('job_id', job.id).order('sent_at', { ascending: false }).then(({ data }) => setLog(data || []))
  }, [job.id])

  async function send() {
    setState({ busy: true, error: '' })
    try {
      // The online copy (link) shows what was emailed.
      await supabase.from('jobs').update({ customer_doc: customerDoc(job) }).eq('id', job.id)
      const { default: html2pdf } = await import('html2pdf.js')
      const dataUri = await html2pdf().set({
        margin: 8, image: { type: 'jpeg', quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(docRef.current).outputPdf('datauristring')
      const { error } = await supabase.functions.invoke('send-document', {
        body: { job_id: job.id, kind, to: to.trim(), subject, message, filename: `${number}.pdf`, pdf_base64: dataUri.split(',')[1] },
      })
      if (error) {
        const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
        throw new Error(msg || 'The email did not go. Try again.')
      }
      onSent(`${kind} ${number} emailed to ${to.trim()}`)
    } catch (e) {
      setState({ busy: false, error: e.message })
      return
    }
    setState({ busy: false, error: '' })
  }

  return (
    <div className="card email-panel">
      <div className="fgrid">
        <div className="field"><label htmlFor="em-to">To</label><input id="em-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" /></div>
        <div className="field"><label htmlFor="em-subj">Subject</label><input id="em-subj" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field full"><label htmlFor="em-msg">Message</label><textarea id="em-msg" value={message} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: 150 }} /></div>
      </div>
      {state.error && <div className="errmsg">{state.error}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn primary" type="button" disabled={state.busy || !to.trim()} onClick={send}>{state.busy ? 'Making the PDF and sending…' : `Send ${kind.toLowerCase()} as PDF`}</button>
        <span className="hint">{number}.pdf is attached. Replies come to your own NJR mailbox.</span>
      </div>
      {log.length > 0 && <p className="hint" style={{ marginBottom: 0 }}>Sent before: {log.map((l) => `${l.kind} to ${l.sent_to} on ${shortDate(l.sent_at)}${l.sent_by ? ` by ${l.sent_by}` : ''}`).join(' · ')}</p>}
    </div>
  )
}
