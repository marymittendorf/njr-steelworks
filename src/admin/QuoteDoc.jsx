import { useEffect } from 'react'
import { calc, customerLines } from '../costing.js'
import { addDays, money, shortDate } from '../format.js'

export default function QuoteDoc({ job, settings, onClose }) {
  const t = calc(job)
  const r = job.rates
  const isInvoice = Boolean(job.invoice_no) // an accepted quote becomes an invoice (numbered by the database)
  const lines = customerLines(job)

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
          <button className="btn small primary" type="button" onClick={() => window.print()}>Print / save PDF</button>
          <button className="btn small" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="doc">
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
        <p style={{ margin: '16px 0' }}><span className="muted">For</span><br /><b>{job.customer}</b><br />{job.phone}{job.email && <><br />{job.email}</>}</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Amount excl. VAT</th></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td>{l.desc}</td><td className="r num">{l.qty}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody>
        </table></div>
        <div className="totals num">
          <span>Subtotal</span><span>{money(t.excl)}</span>
          <span>VAT {r.vat}%</span><span>{money(t.vat)}</span>
          <span className="grand">Total</span><span className="grand">{money(t.total)}</span>
          {!isInvoice && <><span className="muted">Deposit {r.deposit}% to book</span><span className="muted">{money(t.deposit)}</span></>}
          {isInvoice && job.payment_status === 'Awaiting deposit' && <><span><b>Deposit due now ({r.deposit}%)</b></span><span><b>{money(t.deposit)}</b></span></>}
          {isInvoice && job.payment_status === 'Deposit paid' && <><span className="muted">Deposit received</span><span className="muted">−{money(t.deposit)}</span><span><b>Balance due</b></span><span><b>{money(t.total - t.deposit)}</b></span></>}
          {isInvoice && job.payment_status === 'Paid' && <><span><b>Paid in full</b></span><span><b>{money(0)} due</b></span></>}
        </div>
        <div className="terms">
          <b>Terms. </b>
          {isInvoice
            ? (job.payment_status === 'Paid' ? 'Thank you, this invoice is paid in full.' : `A ${r.deposit}% deposit is due before work starts; the balance is due on collection or delivery.`)
            : `Quote valid for ${r.validity} days. Steel prices can change after that. Work is booked once the ${r.deposit}% deposit reflects; the balance is paid on collection.`}
          {settings.bank_details && `\n\nBanking details:\n${settings.bank_details}\nReference: ${isInvoice ? job.invoice_no : job.quote_no}`}
        </div>
      </div>
    </div>
  )
}
