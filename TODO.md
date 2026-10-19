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

## 2. Petty cash system ("Bank and cash" page)
Model: the DF Elements shop admin → Bank and cash page (screenshot 19 Oct 2026).
- One card per account: the bank account and Petty cash, each with its current balance
  and "started at R… on <date>", plus an "All together" total card
- Buttons: **Move money** (e.g. bank → petty cash top-up), **Money in**, **Money out**,
  **Check against statement** (links to item 3), **Download CSV**
- This month at a glance: balance now, money in this month (paid invoices + money in),
  money out this month (expenses + money out), number of expenses paid from this account
- Running ledger per account: date, what, in, out, balance; starting balance at the bottom
- Cash out needs a photo of the slip; each cash-out also lands in Expenses with its
  category, so nothing is captured twice
- Monthly cash count, showing the difference between counted and expected

## 3. Bank reconciliation with bank statement upload
- Upload the bank statement (CSV export from the bank; PDF if the bank only offers that)
- Match each bank line automatically to an expense, an invoice payment or a petty cash top-up (by amount, date and reference)
- Show unmatched lines so they can be captured as a new expense or payment in one click
- Month-end report: bank balance vs. the system's balance, with the differences listed
- Which bank NJR uses decides the statement format; confirm it before building

## 4. Q & A page
Model: the DF Elements shop admin → Q and A.
- Public "Questions" page on the website (e.g. "Do you deliver?", "Do you galvanise?",
  "How long does a trailer build take?", "Do you do roadworthy paperwork?")
- Staff add, edit, reorder and hide questions in the back end; no coding needed
- Link it from the menu and from the quote form ("Check our Q & A")

## 5. Settings: business and bank details
Model: the DF Elements shop admin → Settings (screenshot 19 Oct 2026).
- **Bank details for EFT** as separate boxes (bank, account name, account number, branch code)
  instead of one text box; printed on invoices and shown to customers who accept a quote
- **Business details**: business name, address, email, phone, VAT number (if registered)
- **VAT on/off switch** with the rate. While off, quotes and invoices show no VAT and are
  not called "tax invoice". Quotes and invoices already issued keep the VAT they were made with
- NJR currently always adds 15% VAT; confirm whether NJR is VAT registered
