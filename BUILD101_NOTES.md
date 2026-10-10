# Build 101: employer contributions in payroll

## Deploy
1. Unzip into desktop\ipa. Folder paths are kept.
2. Run `supabase db push`. This applies one migration: 20270108_payroll_employer.sql.
3. Run `git add -A`, then commit and push. Wait for Vercel to show "Ready".

Files to delete: none.

## What changed
- **Payroll > Payroll Runs > "Contribution rates"** sets the SSS, EC, PhilHealth and Pag-IBIG rates for each store. The defaults follow the 2025 schedules. HAVE YOUR ACCOUNTANT CONFIRM THEM.
  - SSS: 5% from the employee and 10% from the employer, on the monthly salary credit (₱5,000 to ₱35,000, in ₱500 steps).
  - EC: ₱10 when the credit is below ₱15,000, otherwise ₱30.
  - PhilHealth: 5% of basic monthly pay (floor ₱10,000, ceiling ₱100,000), split equally between employee and employer.
  - Pag-IBIG: 2% from the employee and 2% from the employer, on pay up to ₱10,000. The employee pays 1% when pay is ₱1,500 or less.
- **"Review entries" on a draft run > "Compute SSS / PhilHealth / Pag-IBIG"** fills in the employee and employer shares from each person's pay profile:
  - A daily rate is counted as rate × 26 for the month; an hourly rate as rate × 8 × 26.
  - Each period takes its share of the monthly amount: monthly 1, semi-monthly ½, weekly 12/52, daily 1/26.
  - Every figure can still be edited. The employer fields are the amber ones.
- **Approving a run** now records an extra expense, 5120 Employer Contributions. The SSS, PhilHealth and Pag-IBIG payables include both shares, so "Remit" pays out the full amount owed.
- **Bug fix:** saving an entry's deductions no longer resets its "other deductions" to zero.

## Tested
proof101: 19 checks; the full replay (proofs 78 to 101) has 0 failures; tsc and next build pass.
