# Build 103: purchase price control

## Deploy
1. Unzip into desktop\ipa. Folder paths are kept.
2. Run `supabase db push`. This applies one migration, 20270109_po_price_control.sql.
3. Run `git add -A`, commit and push, then wait for Vercel "Ready".

Files to delete: none.

## How it works

### Every PO line needs a price choice
Each line now has a **Price** choice: Priced, To be quoted, or Free / no charge.
- A priced line needs a price above zero.
- A free line needs a reason, such as a warranty claim number or a free sample.
- A line with no price and neither choice is refused when the PO is prepared, reviewed or approved.
- POs approved before this build are not affected.

### New lines start from the last price paid
A new line starts from the last price paid to that supplier. You can change it.

### The PO review compares against the last price
"View" on a PO shows each line against the last price paid to that supplier.
- A price more than 10% above it is shown in red for the approver.
- The Approvals queue also notes flagged prices, to-be-quoted lines and free lines on each PO.

### Printed PO
Lines show "To be quoted" or "Free of charge", and the total reads "₱X + N items to be quoted". A note asks the supplier to send a quotation before billing.

### Waiting for supplier quotes (Purchase Orders tab)
This list shows every to-be-quoted line, with how many days it has been open (red after 7 days) and how much has been received.
1. **Enter quote:** a Finance preparer, reviewer or approver enters the price and the quote reference.
2. **Approve / reject:** a Finance approver or the Business Admin decides. It can't be the person who entered the quote, unless that person is the Business Admin. Rejecting needs a reason, and the line goes back to waiting.

When a quote is approved, the line takes the price and the PO subtotal updates.

### Receiving before the price is confirmed
Goods can be received before the price is confirmed. They come in at no value at first. When the quote is approved:
- They are booked into inventory (Dr 1200, Cr 2010).
- They are added to the item's average cost and lots.
- Deliveries still in draft pick up the price.

### Supplier bills
- A bill line for a quote that isn't confirmed yet can't be approved, by anyone.
- A billed price more than 2% above the PO price needs the Business Admin to approve the bill. So does any charge on a free line.
- The bill entry screen shows these states on each linked line.

### Price-control levels (Business Admin)
Set the 10% flag and the 2% tolerance per store with the "Price-control levels" button on the Purchase Orders tab.

### Purchase price history
To-be-quoted and free lines don't record a ₱0 "last price". A confirmed quote is recorded when it's approved.

## Tested
- proof103: 32 checks.
- Full replay, proofs 78 to 103: 0 failures.
- tsc and next build pass.
- proof99 was updated: its sample bill is 5% over the PO price, so the Business Admin now approves it.
