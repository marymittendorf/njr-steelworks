# NJR Steelworks: to do

## 1. Invoices and quotes
What exists now: the job costing screen prints a customer quote, and the same
document becomes a tax invoice when the job status is Invoiced or Paid. It uses
the quote number (NJR-Q-…) for both.

Still to build:
- Separate invoice numbers (e.g. NJR-INV-0001), issued once and never reused
- Record payments against an invoice (deposit, balance, part payments) and show what's still owed
- Send a quote or invoice to the customer by email or WhatsApp as a PDF
- Customer accepts a quote online (link on the quote)
- Credit notes for refunds or corrections
- Statement per customer and an "unpaid invoices" list on the dashboard

## 2. Petty cash system
- Cash float with a running balance
- Cash in (top-ups from the bank) and cash out (small purchases), with a photo of each slip
- Monthly cash count, showing the difference between counted and expected
- Each cash-out also appears in Expenses, with its category, so nothing is captured twice

## 3. Bank reconciliation with bank statement upload
- Upload the bank statement (CSV export from the bank; PDF if the bank only offers that)
- Match each bank line automatically to an expense, an invoice payment or a petty cash top-up (by amount, date and reference)
- Show unmatched lines so they can be captured as a new expense or payment in one click
- Month-end report: bank balance vs. the system's balance, with the differences listed
- Which bank NJR uses decides the statement format; confirm it before building
