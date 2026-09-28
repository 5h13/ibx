# Approvals / Decision Engine

Central cross-module approval queue for the cumulative IBX build.

## Included
- Section-aware queue for Admin, Finance, Logistics, Sales and Marketing.
- Reviewer action: prepared -> reviewed.
- Approver action: reviewed -> approved.
- Return action: prepared/reviewed -> draft with reason captured in central decision history.
- Central decision history with actor, source, status transition, reason and timestamp.
- Supported posting from the central queue for supplier payments, customer receipts, cash transactions, journal entries, payroll runs, goods receipts and stock transfers by calling the existing module posting actions.
- Fleet expenses now have the standard approval lifecycle.
- Server-side role/section validation and stale-record protection.

The source module remains authoritative for operational status and posting. `approval_decisions` is the centralized decision/audit layer.
