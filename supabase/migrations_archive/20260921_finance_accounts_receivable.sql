-- IBX Finance Accounts Receivable foundation
-- Customer master, customer invoices, receipts and receivable aging foundation.

DO $$ BEGIN
  CREATE TYPE public.ar_invoice_status AS ENUM ('draft','prepared','reviewed','approved','partially_paid','paid','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.ar_receipt_status AS ENUM ('draft','prepared','reviewed','approved','posted','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.finance_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  trade_name text,
  contact_person text,
  email text,
  phone text,
  address text,
  tax_id text,
  payment_terms text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_customer_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.finance_customers(id),
  invoice_date date NOT NULL,
  due_date date,
  currency text NOT NULL DEFAULT 'PHP',
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  other_charges numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS ((subtotal + tax_amount + other_charges) - discount_amount) STORED,
  amount_received numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  balance_due numeric(14,2) GENERATED ALWAYS AS (((subtotal + tax_amount + other_charges) - discount_amount) - amount_received) STORED,
  status public.ar_invoice_status NOT NULL DEFAULT 'draft',
  notes text,
  prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz,
  approved_by uuid REFERENCES public.users(id), approved_at timestamptz,
  created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_customer_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.finance_customer_invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'unit',
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes text
);

CREATE TABLE IF NOT EXISTS public.finance_customer_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.finance_customer_invoices(id),
  receipt_date date NOT NULL DEFAULT current_date,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'Bank transfer',
  reference_number text,
  bank_account text,
  notes text,
  status public.ar_receipt_status NOT NULL DEFAULT 'draft',
  prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz,
  approved_by uuid REFERENCES public.users(id), approved_at timestamptz,
  posted_by uuid REFERENCES public.users(id), posted_at timestamptz,
  created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_customer_active ON public.finance_customers(active, legal_name);
CREATE INDEX IF NOT EXISTS idx_ar_invoice_customer ON public.finance_customer_invoices(customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ar_invoice_status_due ON public.finance_customer_invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_ar_invoice_items_invoice ON public.finance_customer_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ar_receipt_invoice ON public.finance_customer_receipts(invoice_id, receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_ar_receipt_status ON public.finance_customer_receipts(status, receipt_date DESC);

ALTER TABLE public.finance_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_customer_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_customer_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance AR customers access" ON public.finance_customers;
CREATE POLICY "finance AR customers access" ON public.finance_customers FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);
DROP POLICY IF EXISTS "finance AR invoices access" ON public.finance_customer_invoices;
CREATE POLICY "finance AR invoices access" ON public.finance_customer_invoices FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);
DROP POLICY IF EXISTS "finance AR invoice items access" ON public.finance_customer_invoice_items;
CREATE POLICY "finance AR invoice items access" ON public.finance_customer_invoice_items FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);
DROP POLICY IF EXISTS "finance AR receipts access" ON public.finance_customer_receipts;
CREATE POLICY "finance AR receipts access" ON public.finance_customer_receipts FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);

CREATE OR REPLACE FUNCTION public.recalculate_customer_invoice_received(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_received numeric(14,2);
BEGIN
  SELECT coalesce(sum(amount),0) INTO v_received
  FROM public.finance_customer_receipts
  WHERE invoice_id=p_invoice_id AND status='posted';
  UPDATE public.finance_customer_invoices
  SET amount_received=v_received,
      status=CASE
        WHEN status='voided' THEN status
        WHEN v_received >= total_amount THEN 'paid'::public.ar_invoice_status
        WHEN v_received > 0 THEN 'partially_paid'::public.ar_invoice_status
        ELSE status
      END,
      updated_at=now()
  WHERE id=p_invoice_id;
END; $$;

INSERT INTO public.finance_customers (customer_code, legal_name, trade_name, payment_terms)
VALUES ('CUS-001','Sample Customer','Sample Customer','30 days')
ON CONFLICT (customer_code) DO NOTHING;
