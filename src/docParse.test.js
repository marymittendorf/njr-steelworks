import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toAmount, amountsIn, findDate, parseSlip, parseQuote } from './docParse.js'

test('South African money formats', () => {
  assert.equal(toAmount('R1 234,50'), 1234.5)
  assert.equal(toAmount('1,234.50'), 1234.5)
  assert.equal(toAmount('R 89.70'), 89.7)
  assert.equal(toAmount('1.234,50'), 1234.5)
  assert.deepEqual(amountsIn('Phone 077 402 8662  Total R 1 499,00'), [1499])
})

test('dates', () => {
  assert.equal(findDate(['Date: 19/10/2026']), '2026-10-19')
  assert.equal(findDate(['Invoice Date Monday, October 19th, 2026']), '2026-10-19')
  assert.equal(findDate(['19 Oct 2026 14:32']), '2026-10-19')
  assert.equal(findDate(['2026-10-05']), '2026-10-05')
})

test('till slip: hardware store', () => {
  const slip = parseSlip([
    'BUILDERS GEORGE',
    'York Street, George',
    'TAX INVOICE',
    'VAT No: 4123456789',
    'Date 18/10/2026 10:14',
    'Invoice No: GE-778812',
    'CUTTING DISCS 115MM x10      R 189,90',
    'MIG WIRE 0.8MM 5KG           R 449,00',
    'TOTAL                         R 638,90',
    'VAT 15%                       R 83,33',
    'CARD                          R 638,90',
  ])
  assert.equal(slip.supplier, 'BUILDERS GEORGE')
  assert.equal(slip.date, '2026-10-18')
  assert.equal(slip.invoice_no, 'GE-778812')
  assert.equal(slip.total, 638.9)
  assert.equal(slip.vat, 83.33)
  assert.equal(slip.amount_excl, 555.57)
})

test('supplier: company name preferred over label lines', () => {
  const slip = parseSlip(['TAX INVOICE  #202610191481', 'ZAR Payments:', 'Bank: Nedbank, Bedfordview',
    'Account #: 1100571217932 | Cloudfusion (Pty) Ltd', 'INVOICED TO', 'Chip n dip', 'TOTAL  R169.46'])
  assert.equal(slip.supplier, 'Cloudfusion (Pty) Ltd')
})

test('Cloudfusion-style invoice', () => {
  const slip = parseSlip([
    'TAX INVOICE', '#202610191481', 'Invoice Date', 'Monday, October 19th, 2026',
    'Standard Hosting - njrsteelworks.co.za R65.00', 'Sub Total R148.01', '15.00% VAT R21.45', 'Total R169.46',
  ])
  assert.equal(slip.total, 169.46)
  assert.equal(slip.vat, 21.45)
  assert.equal(slip.amount_excl, 148.01)
  assert.equal(slip.date, '2026-10-19')
})

test('quote with lines that add up', () => {
  const q = parseQuote([
    'NJR STEELWORKS', 'QUOTATION', 'Quote No: Q-1042', 'Date: 12/10/2026',
    'Bill to:', 'Van Wyk Builders', 'Tel 083 555 0177',
    'Qty Description Amount',
    '2 6 m³ skip floor replacement   R 9 800,00',
    '1 Delivery George               R 650,00',
    'Subtotal R 10 450,00', 'VAT 15% R 1 567,50', 'Total R 12 017,50',
  ])
  assert.equal(q.customer, 'Van Wyk Builders')
  assert.equal(q.number, 'Q-1042')
  assert.equal(q.date, '2026-10-12')
  assert.equal(q.total, 12017.5)
  assert.equal(q.vat, 1567.5)
  assert.equal(q.subtotal, 10450)
  assert.equal(q.linesAddUp, true)
  assert.deepEqual(q.items.map((i) => i.amount), [9800, 650])
  assert.equal(q.phone, '083 555 0177')
})

test('quote whose lines do not add up falls back to one total', () => {
  const q = parseQuote(['Quotation 55', 'Customer: Hennie Botha', 'Trailer frame R 5 000,00', 'Total R 20 000,00'])
  assert.equal(q.customer, 'Hennie Botha')
  assert.equal(q.linesAddUp, false)
  assert.equal(q.items.length, 0)
  assert.equal(q.total, 20000)
})
