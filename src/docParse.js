// Reads the useful figures out of a quote, invoice or till slip, given its text lines.
// Same idea as Forever Planks' invoice reader, but not tied to one invoice template:
// it looks for common labels (Total, VAT, Invoice no., Bill to…) and South African
// money formats ("R1 234,50", "1,234.50"). Staff always check the result before saving.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = (v) => String(v).padStart(2, '0')

// "R 1 234,50" / "1,234.50" / "1234.5" → 1234.5 ; returns null if not money-like.
export function toAmount(raw) {
  let s = String(raw).replace(/[R\s ]/g, '')
  if (!/\d/.test(s)) return null
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,50 or 1234,50
  else s = s.replace(/,/g, '')                                                           // 1,234.50
  const v = Number(s)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
}

// Money amounts on a line: need cents or an R, so years and phone numbers are ignored.
const MONEY = /(?:R\s?)?-?\d{1,3}(?:[ , ]\d{3})*(?:[.,]\d{2})(?!\d)|R\s?\d+(?!\d)/g
export function amountsIn(line) {
  return (line.match(MONEY) || []).map(toAmount).filter((v) => v !== null)
}

export function findDate(lines) {
  for (const l of lines) {
    let m = l.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
    m = l.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/) // dd/mm/yyyy (South Africa)
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
    m = l.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/)
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`
    m = l.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/)
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`
  }
  return null
}

const NUMBER_LABEL = /\b(?:tax\s+)?(?:invoice|inv|quotation|quote|receipt|slip|document|doc|ref(?:erence)?)\s*(?:no\.?|number|nr|#)?\s*[:#.]?\s*([A-Z]{0,6}[-/]?\d[\w/-]{1,20})/i
export function findNumber(lines) {
  for (const l of lines) {
    if (/vat\s*(?:no|reg|number)/i.test(l)) continue
    const m = l.match(NUMBER_LABEL)
    if (m) return m[1]
  }
  return null
}

const isTotalLine = (l) => /\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+incl|total\s*\(incl|total)\b/i.test(l) && !/sub\s*-?\s*total|total\s+excl|excl\.?\s+vat|vat\s+total|total\s+vat|items|qty|quantity|discount|savings|tendered|change/i.test(l)
const isVatLine = (l) => /\b(vat|tax)\b/i.test(l) && !/vat\s*(?:no|reg|number|#)|tax\s+invoice|incl|excl|exempt|registration/i.test(l)
const isSubtotalLine = (l) => /sub\s*-?\s*total|total\s+excl|excl\.?\s+vat|nett?\s+total/i.test(l)

const HEADING = /^(tax\s+)?(invoice|quotation|quote|receipt|till\s+slip|statement|credit\s+note|delivery\s+note)\b/i
const COMPANY = /([A-Z][\w&'.-]*(?:\s+[A-Z&][\w&'.-]*){0,4}\s+(?:\(Pty\)\s*Ltd|Pty\.?\s*Ltd|\(Pty\)|Ltd|CC|Inc))\b/
export function findSupplier(lines) {
  // A registered company name anywhere on the slip beats the first line.
  for (const l of lines) {
    if (/invoiced\s+to|bill(?:ed)?\s+to|attn|customer/i.test(l)) continue
    const m = l.match(COMPANY)
    if (m) return m[1].replace(/^(?:Account|Beneficiary|Bank)\b.*?\|\s*/i, '').trim()
  }
  for (const l of lines.slice(0, 8)) {
    const t = l.trim()
    if (t.length < 3 || HEADING.test(t) || /:\s*$/.test(t) || /^(date|tel|phone|fax|email|vat|reg|www\.|http|page|bank|account|zar|usd|payment)\b/i.test(t) || amountsIn(t).length || /^\d/.test(t)) continue
    return t.replace(/\s{2,}.*/, '')
  }
  return null
}

const lastAmount = (line) => { const a = amountsIn(line); return a.length ? a[a.length - 1] : null }

function totals(lines) {
  let total = null; let vat = null; let subtotal = null
  for (const l of lines) {
    if (isSubtotalLine(l)) subtotal = lastAmount(l) ?? subtotal
    else if (isTotalLine(l)) total = lastAmount(l) ?? total
    else if (isVatLine(l)) { const v = lastAmount(l); if (v !== null && !/15\s*%$/.test(l.trim())) vat = v; else if (v !== null) vat = v }
  }
  if (total === null) { // fall back to the biggest amount on the document
    const all = lines.flatMap(amountsIn)
    if (all.length) total = Math.max(...all)
  }
  if (vat === null && total !== null && subtotal !== null && total > subtotal) vat = Math.round((total - subtotal) * 100) / 100
  if (subtotal === null && total !== null && vat !== null) subtotal = Math.round((total - vat) * 100) / 100
  return { total, vat, subtotal }
}

// Till slip or supplier invoice → expense fields.
export function parseSlip(lines) {
  const t = totals(lines)
  const vat = t.vat ?? 0
  return {
    supplier: findSupplier(lines),
    date: findDate(lines),
    invoice_no: findNumber(lines),
    total: t.total,
    vat,
    amount_excl: t.total !== null ? Math.round((t.total - vat) * 100) / 100 : null,
  }
}

const CUSTOMER_LABEL = /^(?:bill(?:ed)?\s+to|invoice\s+to|quote\s+to|quoted\s+to|sold\s+to|deliver\s+to|customer|client|to)\s*[:\-]?\s*(.*)$/i

// Quote or invoice → order fields, with its priced lines (amounts excl. VAT where shown).
export function parseQuote(lines) {
  let customer = null
  for (let i = 0; i < lines.length && !customer; i++) {
    const m = lines[i].trim().match(CUSTOMER_LABEL)
    if (!m) continue
    const rest = m[1].trim()
    customer = rest && !amountsIn(rest).length ? rest : (lines[i + 1] || '').trim() || null
  }
  const phone = (lines.join(' ').match(/(?:\+27|0)\s?\d{2}\s?\d{3}\s?\d{4}/) || [])[0] || null
  const t = totals(lines)
  const items = []
  for (const l of lines) {
    if (isTotalLine(l) || isVatLine(l) || isSubtotalLine(l) || /balance|deposit|paid|amount\s+due|bank|branch|account/i.test(l)) continue
    const amt = amountsIn(l)
    if (!amt.length) continue
    const desc = l.replace(MONEY, '').replace(/\s{2,}/g, ' ').replace(/^\s*\d+\s+/, '').trim()
    if (desc.length < 3 || /^(qty|quantity|description|item|unit|price|amount)\b/i.test(desc)) continue
    items.push({ desc, amount: amt[amt.length - 1] })
  }
  // Only keep the lines if they add up to the document (excl. or incl. VAT); otherwise use one line.
  const sum = Math.round(items.reduce((a, x) => a + x.amount, 0) * 100) / 100
  const matches = (v) => v !== null && Math.abs(sum - v) <= 1
  const excl = t.subtotal ?? (t.total !== null && t.vat !== null ? t.total - t.vat : t.total)
  const goodLines = items.length > 0 && (matches(t.subtotal) || matches(excl) || matches(t.total))
  return {
    customer, phone,
    number: findNumber(lines),
    date: findDate(lines),
    total: t.total, vat: t.vat ?? 0, subtotal: excl,
    items: goodLines ? items : [],
    linesAddUp: goodLines,
  }
}

// Some PDFs print the description twice side by side ("Services Fees Services Fees").
function undouble(text) {
  const w = text.split(' ')
  if (w.length >= 2 && w.length % 2 === 0) {
    const half = w.length / 2
    if (w.slice(0, half).join(' ').toLowerCase() === w.slice(half).join(' ').toLowerCase()) return w.slice(0, half).join(' ')
  }
  return text
}

// Supplier invoice / till slip → item lines { desc, qty, unit, total }.
// Looks for lines with a quantity and/or two money amounts (unit price and line total).
// Staff check every line before it goes into stock, so this aims to get most lines right.
const NOT_ITEM = /\b(sub\s*-?\s*total|total|vat|tax|balance|change|tendered|cash|card|eft|amount\s+due|discount|rounding|deposit|paid|bank|branch|account|tel|fax|invoice|date|page)\b/i
export function parseInvoiceLines(lines) {
  const out = []
  for (const raw of lines) {
    const l = raw.trim()
    if (l.length < 4 || NOT_ITEM.test(l)) continue
    const amts = amountsIn(l)
    if (!amts.length) continue
    const total = amts[amts.length - 1]
    const unitGiven = amts.length >= 2 ? amts[amts.length - 2] : null
    // Quantity: a small number at the start ("2 x", "2.00", "6 EA") or "x 6".
    const qm = l.match(/^\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:x|ea|each|pcs?|no|units?)?\s+(?=[A-Za-z])/i) || l.match(/\b[x×]\s*(\d{1,4}(?:[.,]\d{1,2})?)\b/i)
    let qty = qm ? Number(qm[1].replace(',', '.')) : null
    let unit = unitGiven
    if (qty && !unit) unit = Math.round((total / qty) * 100) / 100
    if (!qty && unit) { const q = total / unit; qty = Math.abs(q - Math.round(q * 100) / 100) < 0.02 ? Math.round(q * 100) / 100 : 1 }
    if (!qty) { qty = 1; unit = total }
    if (unit && Math.abs(unit * qty - total) > Math.max(1, total * 0.02)) { unit = Math.round((total / qty) * 100) / 100 } // keep qty × unit = total
    const desc = l.replace(MONEY, ' ').replace(/^\s*\d{1,4}(?:[.,]\d{1,2})?\s*(?:x|ea|each|pcs?|no|units?)?\s+/i, '')
      .replace(/\b[x×]\s*\d{1,4}(?:[.,]\d{1,2})?\b/gi, ' ').replace(/\b[A-Z0-9]{2,}-?\d{3,}\b/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (desc.length < 3 || !/[a-z]{3}/i.test(desc)) continue
    out.push({ desc: undouble(desc), qty, unit: Math.round(unit * 100) / 100, total })
  }
  return out
}
