import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, shortDate } from '../format.js'
import { Loading, ErrorNote } from './ui.jsx'
import { parseStatement, suggestMatches, supplierFromDescription, confidence, invoiceForMatching } from '../bankStatements.js'

const BANKS = [['nedbank', 'Nedbank'], ['capitec', 'Capitec (coming)'], ['fnb', 'FNB'], ['other', 'Other']]
const near3days = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 3 * 86400000

// Banking, the skip program's way: upload a statement, money in gets matched to invoices
// (as payments), money out goes to Expenses to be checked and sorted.
export default function Banking({ me, toast, go }) {
  const [accounts, setAccounts] = useState(null)
  const [statements, setStatements] = useState([])
  const [lines, setLines] = useState([])
  const [invoices, setInvoices] = useState([])
  const [unlinked, setUnlinked] = useState([])
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('open')
  const [newAcc, setNewAcc] = useState(null)
  const [upload, setUpload] = useState(null) // { account_id, file, parsed, warning }
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(null) // { line, job_id, amount }
  const [ignoring, setIgnoring] = useState(null) // { line, note }

  const load = async () => {
    const [a, s, l, j, p] = await Promise.all([
      supabase.from('bank_accounts').select('*').order('created_at'),
      supabase.from('bank_statements').select('*').order('uploaded_at', { ascending: false }).limit(12),
      supabase.from('bank_lines').select('*').order('txn_date', { ascending: false }).limit(500),
      supabase.from('jobs').select('*').not('invoice_no', 'is', null).is('invoice_voided_at', null),
      supabase.from('payments').select('id,amount,paid_on,method,reference,job_id').is('bank_line_id', null).eq('method', 'EFT'),
    ])
    setAccounts(a.data || []); setStatements(s.data || []); setLines(l.data || [])
    setInvoices(j.data || []); setUnlinked(p.data || [])
    setError(a.error || s.error || l.error || j.error || p.error)
  }
  useEffect(() => { load() }, [])

  const openInvoices = useMemo(() => invoices.filter((j) => n(j.invoice_total) - n(j.amount_paid) > 0.005).map(invoiceForMatching), [invoices])
  const jobById = useMemo(() => Object.fromEntries(invoices.map((j) => [j.id, j])), [invoices])
  const unlinkedForMatch = useMemo(() => unlinked.map((p) => {
    const j = jobById[p.job_id]
    return j ? { ...p, invoice_number: j.invoice_no, invoice_numeric: Number(String(j.invoice_no).replace(/\D/g, '')), client_name: j.customer, client_email: j.email } : null
  }).filter(Boolean), [unlinked, jobById])

  if (!accounts) return error ? <ErrorNote error={error} /> : <Loading />
  const isOwner = me?.role === 'owner'
  const shown = lines.filter((l) => filter === 'all' || (filter === 'open' ? ['unallocated', 'part'].includes(l.status) : l.status === filter))
  const openCount = lines.filter((l) => ['unallocated', 'part'].includes(l.status)).length

  async function addAccount(e) {
    e.preventDefault()
    if (!newAcc.name.trim()) { setError('Give the account a name, e.g. "NJR Nedbank cheque".'); return }
    const { error } = await supabase.from('bank_accounts').insert({ name: newAcc.name.trim(), bank: newAcc.bank, account_number: newAcc.account_number.replace(/\D/g, '') || null })
    if (error) { setError(error); return }
    setNewAcc(null); toast('Bank account added'); load()
  }

  async function pickFile(file) {
    if (!file) return
    setError(null)
    try {
      const parsed = parseStatement(await file.text())
      const acc = accounts.find((a) => a.id === upload.account_id)
      let warning = ''
      if (acc?.account_number && parsed.accountNumber && acc.account_number !== parsed.accountNumber) warning = `This statement is for account ${parsed.accountNumber}, not ${acc.account_number} (${acc.name}). Check you picked the right account.`
      if (acc && acc.bank !== parsed.bank && acc.bank !== 'other') warning = (warning ? warning + ' ' : '') + `It looks like a ${parsed.bank.toUpperCase()} statement, but ${acc.name} is set as ${acc.bank.toUpperCase()}.`
      setUpload({ ...upload, file, parsed, warning })
    } catch (err) { setError(err.message) }
  }

  async function importStatement() {
    const { parsed, file, account_id } = upload
    setBusy(true); setError(null)
    try {
      const { data: st, error: e1 } = await supabase.from('bank_statements').insert({ bank_account_id: account_id, file_name: file.name, period_from: parsed.from, period_to: parsed.to, uploaded_by: me?.name || null }).select().single()
      if (e1) throw e1
      // Money in: stored once per line.
      let inAdded = 0
      if (parsed.credits.length) {
        const { data, error } = await supabase.from('bank_lines').upsert(parsed.credits.map((c) => ({
          bank_account_id: account_id, statement_id: st.id, txn_date: c.date, description: c.description, amount: c.amount, balance: c.balance, fingerprint: c.fingerprint,
        })), { onConflict: 'bank_account_id,fingerprint', ignoreDuplicates: true }).select('id')
        if (error) throw error
        inAdded = data?.length || 0
      }
      // Money out → expenses (to check). Link to an expense already typed in by hand when it's clearly the same.
      let outAdded = 0
      if (parsed.debits.length) {
        const { data: existing } = await supabase.from('expenses').select('id,fingerprint,total,paid_on,bank_account_id')
          .or(`bank_account_id.eq.${account_id},bank_account_id.is.null`).gte('paid_on', parsed.from).lte('paid_on', parsed.to || parsed.from)
        const known = new Set((existing || []).filter((x) => x.fingerprint).map((x) => x.fingerprint))
        const handTyped = (existing || []).filter((x) => !x.fingerprint)
        for (const d of parsed.debits) {
          if (known.has(d.fingerprint)) continue
          const twin = handTyped.find((x) => Math.abs(n(x.total) - d.amount) < 0.01 && near3days(x.paid_on, d.date))
          const bank = { bank_account_id: account_id, statement_id: st.id, fingerprint: d.fingerprint, bank_description: d.description }
          if (twin) {
            const { error } = await supabase.from('expenses').update(bank).eq('id', twin.id)
            if (error) throw error
            handTyped.splice(handTyped.indexOf(twin), 1)
          } else {
            const fee = /\b(FEE|CHARGE|SERVICE FEE|ADMIN FEE)\b/i.test(d.description)
            const { error } = await supabase.from('expenses').insert({
              ...bank, paid_on: d.date, supplier: supplierFromDescription(d.description), description: d.description,
              category: fee ? 'Bank & payment fees' : 'Other', amount_excl: d.amount, vat: 0, payment_method: 'EFT', needs_review: true,
            })
            if (error) throw error
            outAdded++
          }
          known.add(d.fingerprint)
        }
      }
      const skipped = parsed.credits.length + parsed.debits.length - inAdded - outAdded
      await supabase.from('bank_statements').update({ money_in_added: inAdded, money_out_added: outAdded, lines_skipped: skipped }).eq('id', st.id)
      toast(`Imported: ${inAdded} money in, ${outAdded} money out${skipped ? `, ${skipped} already on file` : ''}`)
      setUpload(null); load()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  async function allocate(line, jobId, amount) {
    const { error } = await supabase.from('payments').insert({
      job_id: jobId, amount: Math.round(amount * 100) / 100, paid_on: line.txn_date, method: 'EFT',
      reference: line.description.slice(0, 120), bank_line_id: line.id, recorded_by: me?.name || null,
    })
    if (error) throw error
  }

  async function accept(line, s) {
    setError(null)
    try {
      if (s.kind === 'invoice') await allocate(line, s.target.id, s.amount)
      else if (s.kind === 'split') {
        let left = n(line.amount) - n(line.allocated_amount)
        for (const inv of s.targets) { const a = Math.min(left, inv.total - inv.amount_paid); if (a > 0) await allocate(line, inv.id, a); left -= a }
      } else if (s.kind === 'payment') {
        const { error } = await supabase.from('payments').update({ bank_line_id: line.id }).eq('id', s.target.id)
        if (error) throw error
      }
      toast(s.kind === 'payment' ? 'Linked to the payment already recorded' : 'Payment recorded on the invoice'); load()
    } catch (err) { setError(err) }
  }

  async function saveManual() {
    const amt = n(manual.amount)
    if (!manual.job_id || !(amt > 0)) { setError('Pick the invoice and the amount.'); return }
    try { await allocate(manual.line, manual.job_id, amt); setManual(null); toast('Payment recorded on the invoice'); load() } catch (err) { setError(err) }
  }

  async function setIgnored(line, note) {
    const { error } = await supabase.from('bank_lines').update(note === null ? { status: 'unallocated', ignore_note: null } : { status: 'ignored', ignore_note: note || null }).eq('id', line.id)
    if (error) setError(error); else { setIgnoring(null); load() }
  }

  return (
    <>
      <div className="pagehead">
        <h1>Banking</h1>
        {accounts.length > 0 && !upload && <button className="btn primary" type="button" onClick={() => setUpload({ account_id: accounts[0].id })}>Upload statement</button>}
      </div>
      <ErrorNote error={error} />

      <div className="block-head"><h3>Bank accounts</h3>{isOwner && !newAcc && <button className="btn small" type="button" onClick={() => setNewAcc({ name: '', bank: 'nedbank', account_number: '' })}>Add account</button>}</div>
      {!accounts.length && !newAcc && <div className="card hint block">No bank accounts yet. {isOwner ? 'Add NJR\'s Nedbank account to start.' : 'Ask an owner to add NJR\'s bank account.'}</div>}
      {accounts.length > 0 && <div className="acc-row block">{accounts.map((a) => (
        <div key={a.id} className="kpi"><span className="label">{BANKS.find((b) => b[0] === a.bank)?.[1].replace(' (coming)', '')}</span><b style={{ fontSize: '1.3rem' }}>{a.name}</b><span className="sub num">{a.account_number || 'No account number'}</span></div>
      ))}</div>}
      {newAcc && (
        <form className="card block" onSubmit={addAccount}>
          <div className="fgrid">
            <div className="field"><label htmlFor="ba-name">Name</label><input id="ba-name" value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} placeholder="NJR Nedbank cheque" /></div>
            <div className="field"><label htmlFor="ba-bank">Bank</label><select id="ba-bank" value={newAcc.bank} onChange={(e) => setNewAcc({ ...newAcc, bank: e.target.value })}>{BANKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field"><label htmlFor="ba-no">Account number</label><input id="ba-no" value={newAcc.account_number} onChange={(e) => setNewAcc({ ...newAcc, account_number: e.target.value })} inputMode="numeric" /><span className="hint">Used to warn if the wrong statement is uploaded</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn primary" type="submit">Add account</button><button className="btn ghost" type="button" onClick={() => setNewAcc(null)}>Cancel</button></div>
        </form>
      )}

      {upload && (
        <div className="card block pay-form">
          <b>Upload a statement</b>
          <p className="hint" style={{ marginTop: 4 }}>In Nedbank online banking: Statement Enquiry → pick the dates → download as <b>CSV</b>. Uploading overlapping dates is fine: lines already on file are skipped.</p>
          <div className="fgrid">
            <div className="field"><label htmlFor="up-acc">Account</label><select id="up-acc" value={upload.account_id} onChange={(e) => setUpload({ account_id: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div className="field"><label htmlFor="up-file">Statement file (CSV)</label><input id="up-file" type="file" accept=".csv,text/csv" onChange={(e) => pickFile(e.target.files[0])} /></div>
          </div>
          {upload.parsed && <>
            <p style={{ marginBottom: 4 }}><b>{upload.parsed.bank.toUpperCase()}</b> statement{upload.parsed.accountNumber ? ` for ${upload.parsed.accountNumber}` : ''}, {shortDate(upload.parsed.from)} to {shortDate(upload.parsed.to)}:
              {' '}<b>{upload.parsed.credits.length}</b> money in ({money(upload.parsed.credits.reduce((a, c) => a + c.amount, 0))}), <b>{upload.parsed.debits.length}</b> money out ({money(upload.parsed.debits.reduce((a, c) => a + c.amount, 0))}).</p>
            {upload.warning && <div className="errmsg">{upload.warning}</div>}
          </>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn primary" type="button" disabled={!upload.parsed || busy} onClick={importStatement}>{busy ? 'Importing…' : 'Import'}</button>
            <button className="btn ghost" type="button" onClick={() => setUpload(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="block-head" style={{ alignItems: 'flex-end' }}>
        <h3>Money in</h3>
        <div className="filters" role="group" aria-label="Show" style={{ marginBottom: 0 }}>
          {[['open', `To match (${openCount})`], ['allocated', 'Matched'], ['ignored', 'Not customer payments'], ['all', 'All']].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      {!shown.length ? <div className="card hint block">{lines.length ? 'Nothing here.' : 'Upload a statement to see money in.'}</div> : shown.map((l) => {
        const left = n(l.amount) - n(l.allocated_amount)
        const open = ['unallocated', 'part'].includes(l.status)
        const sugg = open ? suggestMatches(l, openInvoices, unlinkedForMatch) : []
        return (
          <div key={l.id} className="card block bank-line">
            <div className="block-head">
              <div><b className="num">{shortDate(l.txn_date)}</b> · {l.description}</div>
              <div className="num"><b>{money(l.amount)}</b>{l.status === 'part' && <span className="hint"> · {money(left)} still to match</span>}</div>
            </div>
            {l.status === 'allocated' && <span className="pill st-Done">Matched to invoice</span>}
            {l.status === 'ignored' && <div><span className="pill st-Cancelled">Not a customer payment</span>{l.ignore_note && <span className="hint"> · {l.ignore_note}</span>}
              {' '}<button className="linkbtn" type="button" onClick={() => setIgnored(l, null)}>Undo</button></div>}
            {open && <>
              {sugg.length > 0 ? sugg.map((s, i) => {
                const c = confidence(s.score)
                const label = s.kind === 'split' ? `${s.targets.map((t) => t.invoice_number).join(' + ')} (${s.target.client_name})`
                  : s.kind === 'payment' ? `Payment already recorded on ${s.target.invoice_number} (${s.target.client_name}), ${money(s.target.amount)}`
                    : `${s.target.invoice_number} · ${s.target.client_name} · ${money(s.target.total - s.target.amount_paid)} owing`
                return (
                  <div key={i} className="sugg">
                    <span className={`pill ${c.cls}`}>{c.label}</span>
                    <span>{label}<div className="hint">{s.reasons.join(' · ')}</div></span>
                    <button className="btn small primary" type="button" onClick={() => accept(l, s)}>{s.kind === 'payment' ? 'Link' : `Match ${money(s.amount)}`}</button>
                  </div>)
              }) : <p className="hint" style={{ margin: '4px 0' }}>No obvious invoice. Match it by hand, or mark it as not a customer payment.</p>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                <button className="linkbtn" type="button" onClick={() => setManual({ line: l, job_id: '', amount: left.toFixed(2) })}>Match to an invoice by hand</button>
                <button className="linkbtn" type="button" onClick={() => setIgnoring({ line: l, note: '' })}>Not a customer payment</button>
              </div>
              {manual?.line.id === l.id && (
                <div className="sugg">
                  <select aria-label="Invoice" value={manual.job_id} onChange={(e) => setManual({ ...manual, job_id: e.target.value })} style={{ flex: 1 }}>
                    <option value="">Pick the invoice…</option>
                    {openInvoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.invoice_number} · {inv.client_name} · {money(inv.total - inv.amount_paid)} owing</option>)}
                  </select>
                  <input className="money num" aria-label="Amount" type="number" step="0.01" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
                  <button className="btn small primary" type="button" onClick={saveManual}>Match</button>
                  <button className="btn small ghost" type="button" onClick={() => setManual(null)}>Cancel</button>
                </div>)}
              {ignoring?.line.id === l.id && (
                <div className="sugg">
                  <input aria-label="Why" value={ignoring.note} onChange={(e) => setIgnoring({ ...ignoring, note: e.target.value })} placeholder="e.g. transfer from savings, owner loan, refund" style={{ flex: 1 }} />
                  <button className="btn small" type="button" onClick={() => setIgnored(l, ignoring.note)}>Save</button>
                  <button className="btn small ghost" type="button" onClick={() => setIgnoring(null)}>Cancel</button>
                </div>)}
            </>}
          </div>
        )
      })}

      {unlinkedForMatch.length > 0 && <>
        <div className="block-head"><h3>EFT payments not yet seen on a statement ({unlinkedForMatch.length})</h3></div>
        <div className="tbl-wrap block"><table>
          <thead><tr><th>Recorded</th><th>Invoice</th><th>Customer</th><th className="r">Amount</th></tr></thead>
          <tbody>{unlinkedForMatch.map((p) => <tr key={p.id}><td className="num">{shortDate(p.paid_on)}</td><td className="num">{p.invoice_number}</td><td>{p.client_name}</td><td className="r num">{money(p.amount)}</td></tr>)}</tbody>
        </table></div>
        <p className="hint">These were recorded by hand (e.g. from a proof of payment). When the statement with them is uploaded, they show up above as "Link".</p>
      </>}

      {statements.length > 0 && <>
        <div className="block-head"><h3>Statements uploaded</h3><button className="linkbtn" type="button" onClick={() => go('expenses')}>Money out is in Expenses</button></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Uploaded</th><th>Account</th><th>Period</th><th className="r">Money in</th><th className="r">Money out</th><th className="r">Already on file</th></tr></thead>
          <tbody>{statements.map((s) => <tr key={s.id}><td className="num">{shortDate(s.uploaded_at)}{s.uploaded_by && <div className="hint">{s.uploaded_by}</div>}</td>
            <td>{accounts.find((a) => a.id === s.bank_account_id)?.name}<div className="hint">{s.file_name}</div></td>
            <td className="num">{s.period_from ? `${shortDate(s.period_from)} – ${shortDate(s.period_to)}` : '—'}</td>
            <td className="r num">{s.money_in_added}</td><td className="r num">{s.money_out_added}</td><td className="r num">{s.lines_skipped}</td></tr>)}</tbody>
        </table></div>
      </>}
    </>
  )
}
