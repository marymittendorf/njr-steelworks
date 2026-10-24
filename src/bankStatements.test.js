import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatement, referenceNumbers, suggestMatches, supplierFromDescription, payeeKey } from './bankStatements.js'

const NEDBANK = `Statement Enquiry
Account Number : ,1135727880
Date,Description,Amount,Balance,
22Sep2026,J W HUGO WW KNYSNA (,2800,33907.03,
23Sep2026,POS PURCHASE BUILDERS GEORGE 4587*1234,-638.90,33268.13,
24Sep2026,VAN WYK BUILDERS INV 3,12017.50,45285.63,
25Sep2026,DEBIT ORDER CLOUDFUSION,-74.75,45210.88,
`

test('reads a Nedbank CSV: money in and money out, with fingerprints', () => {
  const s = parseStatement(NEDBANK)
  assert.equal(s.bank, 'nedbank')
  assert.equal(s.accountNumber, '1135727880')
  assert.equal(s.credits.length, 2)
  assert.equal(s.debits.length, 2)
  assert.equal(s.debits[0].amount, 638.9)
  assert.equal(s.credits[1].date, '2026-09-24')
  assert.equal(s.from, '2026-09-22'); assert.equal(s.to, '2026-09-25')
  assert.ok(s.credits[0].fingerprint.includes('J W HUGO'))
})

test('reads an FNB CSV', () => {
  const s = parseStatement('Account:, 62519808929, [Business Account]\nDate, Amount, Balance, Description\n2026/10/22, 1092.50, 5000.00, NJR INV 0007\n2026/10/23, -200.00, 4800.00, FEE')
  assert.equal(s.bank, 'fnb'); assert.equal(s.credits.length, 1); assert.equal(s.debits[0].amount, 200)
})

test('rejects other files with a helpful message', () => {
  assert.throws(() => parseStatement('hello,world'), /Nedbank or FNB CSV/)
})

test('reference numbers: NJR invoice styles', () => {
  assert.ok(referenceNumbers('VAN WYK BUILDERS INV 3').includes(3))
  assert.ok(referenceNumbers('NJR-INV-0004 deposit').includes(4))
  assert.ok(referenceNumbers('inv0012').includes(12))
})

test('suggests the invoice by reference and name; deposit amount counts', () => {
  const invoices = [
    { id: 'a', number: 3, invoice_number: 'NJR-INV-0003', total: 12017.5, amount_paid: 0, issue_date: '2026-09-20', client_name: 'Van Wyk Builders', deposit_pct: 50 },
    { id: 'b', number: 4, invoice_number: 'NJR-INV-0004', total: 5600, amount_paid: 0, issue_date: '2026-09-21', client_name: 'Hennie Botha', deposit_pct: 50 },
  ]
  const full = suggestMatches({ description: 'VAN WYK BUILDERS INV 3', amount: 12017.5, txn_date: '2026-09-24' }, invoices)
  assert.equal(full[0].target.id, 'a'); assert.ok(full[0].score >= 80)
  const dep = suggestMatches({ description: 'H BOTHA TRAILER', amount: 2800, txn_date: '2026-09-24' }, invoices)
  assert.equal(dep[0].target.id, 'b'); assert.ok(dep[0].reasons.includes('exactly the deposit'))
})

test('supplier names from statement lines', () => {
  assert.equal(supplierFromDescription('POS PURCHASE BUILDERS GEORGE 4587*1234'), 'Builders George')
  assert.equal(payeeKey('POS PURCHASE BUILDERS GEORGE 4587*1234'), 'POS PURCHASE BUILDERS GEORGE')
})
