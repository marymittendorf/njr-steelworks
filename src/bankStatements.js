// Reading bank statement exports and suggesting which invoice each payment belongs to.
// Ported from the skip rental program (skip-run-web/src/lib/statements.js), adapted to
// NJR's invoice numbers (NJR-INV-0004). Pure functions, so they can be tested on real files.
// Banks: Nedbank and FNB CSV exports. Capitec to be added from a sample file.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function toAmount(s) {
  if (s == null) return null
  const clean = String(s).replace(/[\sR]/g, '').replace(/,(?=\d{3}\b)/g, '')
  if (clean === '') return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// FNB "Transaction history" CSV:
//   Account:, 62519808929, [Business Account]
//   Date, Amount, Balance, Description
//   2026/10/22, 1092.50, -285351.75, INV-0004
function parseFnb(lines) {
  const accountLine = lines.find((l) => /^account:/i.test(l))
  const accountNumber = accountLine ? splitCsvLine(accountLine)[1]?.replace(/\D/g, '') : null
  const headerAt = lines.findIndex((l) => /^date\s*,\s*amount\s*,\s*balance/i.test(l))
  const rows = []
  for (const line of lines.slice(headerAt + 1)) {
    const [date, amount, balance, ...rest] = splitCsvLine(line)
    const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(date || '')
    if (!m) continue
    rows.push({ date: iso(m[1], m[2], m[3]), amount: toAmount(amount), balance: toAmount(balance), description: rest.join(', ').trim() })
  }
  return { bank: 'fnb', accountNumber, rows }
}

// Nedbank "Statement Enquiry" CSV:
//   Account Number : ,1135727880
//   22Sep2026,J W HUGO WW KNYSNA (,2800,33907.03,
function parseNedbank(lines) {
  const accountLine = lines.find((l) => /^account number/i.test(l))
  const accountNumber = accountLine ? splitCsvLine(accountLine)[1]?.replace(/\D/g, '') : null
  const rows = []
  for (const line of lines) {
    const [date, description, amount, balance] = splitCsvLine(line)
    const m = /^(\d{1,2})([A-Za-z]{3})(\d{4})$/.exec(date || '')
    if (!m || !MONTHS[m[2].toLowerCase()]) continue
    rows.push({ date: iso(m[3], MONTHS[m[2].toLowerCase()], m[1]), amount: toAmount(amount), balance: toAmount(balance), description: (description || '').trim() })
  }
  return { bank: 'nedbank', accountNumber, rows }
}

// Works out which bank the export came from. Returns money in (credits) and money out (debits,
// as positive amounts), each with a fingerprint so the same line is never stored twice.
export function parseStatement(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const head = lines.slice(0, 8).join('\n')
  let parsed
  if (/account transaction history/i.test(head) || lines.some((l) => /^date\s*,\s*amount\s*,\s*balance/i.test(l))) parsed = parseFnb(lines)
  else if (/statement enquiry/i.test(head) || lines.some((l) => /^\d{1,2}[A-Za-z]{3}\d{4},/.test(l))) parsed = parseNedbank(lines)
  else throw new Error("This doesn't look like a Nedbank or FNB CSV export. Download the statement as CSV (not PDF) from online banking. Capitec isn't supported yet.")

  const withPrint = (r) => ({ ...r, fingerprint: [r.date, r.amount.toFixed(2), r.description.toUpperCase(), r.balance == null ? '' : r.balance.toFixed(2)].join('|') })
  const credits = parsed.rows.filter((r) => r.amount != null && r.amount > 0).map(withPrint)
  const debits = parsed.rows.filter((r) => r.amount != null && r.amount < 0).map(withPrint).map((r) => ({ ...r, amount: -r.amount }))
  const dates = parsed.rows.map((r) => r.date).sort()
  return { ...parsed, credits, debits, from: dates[0] || null, to: dates[dates.length - 1] || null, totalRows: parsed.rows.length }
}

// The description without card numbers and references, so lines from one payee group together.
export function payeeKey(description) {
  return String(description || '').toUpperCase().replace(/[0-9*#]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// A tidier supplier name for an expense made from a statement line.
export function supplierFromDescription(description) {
  const k = payeeKey(description).replace(/\b(POS PURCHASE|PURCHASE|CARD|DEBIT ORDER|PAYMENT TO|PAYMENT|EFT|IB|FEE)\b/g, ' ').replace(/\s+/g, ' ').trim()
  return (k || String(description || '').trim()).slice(0, 60).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// Numbers someone might have typed as a reference: "INV-0004", "inv 4", "NJR INV 12".
// Short numbers count here because NJR's invoice numbers are small.
export function referenceNumbers(description) {
  const s = String(description || '')
  const tagged = [...s.matchAll(/\b(?:INV|NJR|INVOICE|Q|QUOTE)\s*[-#:]?\s*(?:INV\s*[-#]?\s*)?0*(\d{1,6})\b/gi)].map((m) => Number(m[1]))
  const bare = (s.match(/\d+/g) || []).filter((d) => d.length >= 3 && d.length <= 7).map(Number)
  return [...new Set([...tagged, ...bare])]
}

const NAME_NOISE = new Set(['the', 'and', 'pty', 'ltd', 'cc', 'inc', 'trading', 'construction', 'services', 'mr', 'mrs', 'ms', 'dr', 'steel', 'steelworks'])
const nameWords = (name) => (name || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NAME_NOISE.has(w))
const FREE_MAIL = new Set(['gmail', 'googlemail', 'yahoo', 'hotmail', 'outlook', 'live', 'icloud', 'mweb', 'telkomsa', 'absamail', 'lantic', 'global', 'webmail', 'iafrica', 'vodamail', 'rocketmail', 'msn', 'me'])
function emailBusinessName(email) {
  const label = (email || '').toLowerCase().split('@')[1]?.split('.')[0]
  return label && label.length >= 5 && !FREE_MAIL.has(label) ? label : null
}

// 30 = the customer's name (or their email's business name) is on the line, 18 = part of it.
// Banks cut descriptions short, so a cut-off word still counts.
function nameScore(description, name, email) {
  const lower = description.toLowerCase()
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  const words = nameWords(name)
  const hits = words.filter((w) => tokens.includes(w) || (w.length >= 5 && lower.includes(w)) || tokens.some((t) => t.length >= 5 && w.startsWith(t)))
  if (words.length && (hits.length === words.length || hits.length >= 2)) return { score: 30, via: 'name' }
  const business = emailBusinessName(email)
  if (business && lower.replace(/[^a-z0-9]/g, '').includes(business)) return { score: 30, via: 'email' }
  if (hits.length) return { score: 18, via: 'part' }
  return { score: 0 }
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

function invoiceCombination(list, amount, outstandingOf) {
  for (let size = 2; size <= Math.min(4, list.length); size++) {
    const pick = (start, chosen, sum) => {
      if (chosen.length === size) return near(sum, amount) ? chosen : null
      for (let i = start; i < list.length; i++) {
        const next = sum + outstandingOf(list[i])
        if (next > amount + 0.005) continue
        const found = pick(i + 1, [...chosen, list[i]], next)
        if (found) return found
      }
      return null
    }
    const found = pick(0, [], 0)
    if (found) return found
  }
  return null
}

export function confidence(score) {
  if (score >= 80) return { label: 'Strong', cls: 'st-Done' }
  if (score >= 50) return { label: 'Good', cls: 'st-Quote-sent' }
  return { label: 'Possible', cls: 'st-Draft' }
}

// Invoice shape: { id, number, invoice_number, quote_number, total, amount_paid, issue_date, client_name, client_email }
// Payment shape (recorded, not yet seen on a statement): { id, amount, paid_on, invoice_number, invoice_numeric, client_name, client_email }
export function suggestMatches(line, invoices, payments = []) {
  const refs = referenceNumbers(line.description)
  const remaining = Number(line.amount) - Number(line.allocated_amount || 0)
  const out = []
  const outstandingOf = (inv) => Number(inv.total) - Number(inv.amount_paid || 0)
  const sameAmount = invoices.filter((inv) => near(outstandingOf(inv), remaining)).length
  const names = new Map(invoices.map((inv) => [inv, nameScore(line.description, inv.client_name, inv.client_email)]))
  const namedOutright = [...names.values()].some((x) => x.via === 'name')

  for (const inv of invoices) {
    const outstanding = outstandingOf(inv)
    if (outstanding <= 0) continue
    const reasons = []
    let score = 0
    if (refs.includes(Number(inv.number))) { score += 60; reasons.push(`reference ${inv.invoice_number}`) }
    else if (inv.quote_number && refs.includes(Number(inv.quote_number))) { score += 45; reasons.push('quote number as reference') }
    else if (refs.length) score -= 15
    const deposit = inv.deposit_pct ? Math.round(Number(inv.total) * inv.deposit_pct) / 100 : null
    if (near(remaining, outstanding)) {
      score += 30
      reasons.push(sameAmount === 1 ? 'only open invoice for this amount' : 'exact amount')
      if (sameAmount === 1) score += 15
    } else if (deposit && near(remaining, deposit) && Number(inv.amount_paid || 0) === 0) {
      score += 30; reasons.push('exactly the deposit')
    } else if (remaining > outstanding && score >= 60) reasons.push('covers this and more')
    let ns = names.get(inv)
    if (ns.via === 'email' && namedOutright) ns = { score: 0 }
    if (ns.score) {
      score += ns.score
      reasons.push(ns.via === 'email' ? 'name from their email' : ns.via === 'name' ? 'customer name' : 'part of the customer name')
      if (ns.score === 30 && remaining < outstanding - 0.005) { score += 15; reasons.push(`part payment, ${(outstanding - remaining).toFixed(2)} still due`) }
    }
    if (inv.issue_date && daysBetween(inv.issue_date, line.txn_date) < -3) score -= 40
    if (score >= 40) out.push({ kind: 'invoice', target: inv, score: Math.min(score, 100), reasons, amount: Math.min(remaining, outstanding) })
  }

  const byClient = new Map()
  for (const inv of invoices) {
    if (outstandingOf(inv) <= 0 || !names.get(inv).score || names.get(inv).via === 'part') continue
    if (names.get(inv).via === 'email' && namedOutright) continue
    byClient.set(inv.client_name, [...(byClient.get(inv.client_name) || []), inv])
  }
  for (const [client, list] of byClient) {
    if (list.length < 2) continue
    const combo = invoiceCombination([...list].sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date))).slice(0, 10), remaining, outstandingOf)
    if (combo) out.push({ kind: 'split', targets: combo, target: { client_name: client }, score: 75, reasons: ['customer name', `adds up to ${combo.length} of their invoices`], amount: remaining })
  }

  for (const pay of payments) {
    const reasons = []
    let score = 0
    if (!near(pay.amount, remaining) && Number(pay.amount) > remaining) continue
    if (near(pay.amount, remaining)) { score += 40; reasons.push('same amount') }
    if (refs.includes(Number(pay.invoice_numeric))) { score += 50; reasons.push(`reference ${pay.invoice_number}`) }
    const ns = nameScore(line.description, pay.client_name, pay.client_email)
    if (ns.score) { score += ns.score; reasons.push('customer name') }
    const gap = daysBetween(pay.paid_on, line.txn_date)
    if (gap >= -1 && gap <= 7) { score += 10; reasons.push('date fits') } else if (gap < -3) score -= 30
    if (score >= 60) out.push({ kind: 'payment', target: pay, score: Math.min(score, 100), reasons, amount: Number(pay.amount) })
  }

  const dated = (s) => String((s.kind === 'split' ? s.targets[0] : s.target)?.issue_date || s.target?.paid_on || '')
  return out.sort((a, b) => b.score - a.score || dated(a).localeCompare(dated(b))).slice(0, 3)
}

// Job (invoice) row → the shape suggestMatches expects.
export const invoiceForMatching = (j) => ({
  id: j.id, number: Number(String(j.invoice_no).replace(/\D/g, '')), invoice_number: j.invoice_no,
  quote_number: Number(String(j.quote_no || '').replace(/\D/g, '')) || null,
  total: Number(j.invoice_total || 0), amount_paid: Number(j.amount_paid || 0), issue_date: j.invoice_date,
  client_name: j.customer, client_email: j.email, deposit_pct: Number(j.rates?.deposit ?? 50),
})
