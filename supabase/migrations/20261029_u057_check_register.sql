-- U057: Check Register
--
-- Checks issued are the same entity this app already models as a
-- finance_cash_transactions row (a withdrawal against a bank account, with
-- the same draft->prepared->reviewed->approved->posted workflow and the
-- same recalculate_finance_bank_balance() posting trigger) -- they just
-- need a couple of check-specific fields and their own value in the
-- transaction-type enum so they're distinguishable from a wire/cash
-- withdrawal and searchable/reportable as a register. This follows the
-- same "extend the existing table, don't fork a parallel one" pattern used
-- throughout finance (e.g. AP/AR payments/receipts already share
-- finance_cash_transactions via source_module/source_record_id).

alter type public.cash_transaction_type add value if not exists 'check';

alter table public.finance_cash_transactions add column if not exists check_number text;
alter table public.finance_cash_transactions add column if not exists payee text;

-- A given bank account should never issue the same check number twice.
-- Partial index: only meaningful once check_number is actually set.
create unique index if not exists finance_cash_transactions_check_number_per_account_idx
  on public.finance_cash_transactions(bank_account_id, check_number)
  where check_number is not null;
