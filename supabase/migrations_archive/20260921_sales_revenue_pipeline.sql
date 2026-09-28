-- IBX Sales / Revenue Pipeline foundation
DO $$ BEGIN CREATE TYPE public.sales_opportunity_status AS ENUM ('open','qualified','proposal','won','lost','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sales_quotation_status AS ENUM ('draft','prepared','reviewed','approved','sent','accepted','rejected','expired','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sales_order_status AS ENUM ('draft','prepared','reviewed','approved','processing','fulfilled','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sales_commission_status AS ENUM ('draft','prepared','reviewed','approved','paid','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sales_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_number text NOT NULL UNIQUE, lead_id uuid REFERENCES public.marketing_leads(id), customer_id uuid REFERENCES public.finance_customers(id), opportunity_name text NOT NULL, owner_id uuid REFERENCES public.users(id), expected_close_date date, estimated_value numeric(14,2) NOT NULL DEFAULT 0, probability numeric(5,2) NOT NULL DEFAULT 0 CHECK(probability between 0 and 100), status public.sales_opportunity_status NOT NULL DEFAULT 'open', source text, notes text, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sales_quotations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_number text NOT NULL UNIQUE, opportunity_id uuid REFERENCES public.sales_opportunities(id), customer_id uuid NOT NULL REFERENCES public.finance_customers(id), quotation_date date NOT NULL DEFAULT current_date, valid_until date, currency text NOT NULL DEFAULT 'PHP', subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0, other_charges numeric(14,2) NOT NULL DEFAULT 0, total_amount numeric(14,2) GENERATED ALWAYS AS ((subtotal + tax_amount + other_charges) - discount_amount) STORED, status public.sales_quotation_status NOT NULL DEFAULT 'draft', notes text, prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, approved_by uuid REFERENCES public.users(id), approved_at timestamptz, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sales_quotation_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES public.sales_quotations(id) ON DELETE CASCADE, description text NOT NULL, quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK(quantity>0), unit text NOT NULL DEFAULT 'unit', unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK(unit_price>=0), amount numeric(14,2) GENERATED ALWAYS AS (quantity*unit_price) STORED, notes text
);
CREATE TABLE IF NOT EXISTS public.sales_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number text NOT NULL UNIQUE, quotation_id uuid REFERENCES public.sales_quotations(id), opportunity_id uuid REFERENCES public.sales_opportunities(id), customer_id uuid NOT NULL REFERENCES public.finance_customers(id), order_date date NOT NULL DEFAULT current_date, requested_delivery_date date, delivery_address text, contact_name text, contact_phone text, currency text NOT NULL DEFAULT 'PHP', subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0, other_charges numeric(14,2) NOT NULL DEFAULT 0, total_amount numeric(14,2) GENERATED ALWAYS AS ((subtotal+tax_amount+other_charges)-discount_amount) STORED, status public.sales_order_status NOT NULL DEFAULT 'draft', notes text, prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, approved_by uuid REFERENCES public.users(id), approved_at timestamptz, fulfilled_at timestamptz, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sales_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE, inventory_item_id uuid REFERENCES public.logistics_inventory_items(id), description text NOT NULL, quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK(quantity>0), unit text NOT NULL DEFAULT 'unit', unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK(unit_price>=0), amount numeric(14,2) GENERATED ALWAYS AS (quantity*unit_price) STORED, notes text
);
CREATE TABLE IF NOT EXISTS public.sales_commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), commission_number text NOT NULL UNIQUE, sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id), employee_id uuid REFERENCES public.employees(id), user_id uuid REFERENCES public.users(id), commission_rate numeric(7,4) NOT NULL DEFAULT 0, commission_base numeric(14,2) NOT NULL DEFAULT 0, commission_amount numeric(14,2) GENERATED ALWAYS AS (commission_base*commission_rate/100) STORED, status public.sales_commission_status NOT NULL DEFAULT 'draft', notes text, prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, approved_by uuid REFERENCES public.users(id), approved_at timestamptz, paid_at timestamptz, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_opps_status ON public.sales_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_customer ON public.sales_quotations(customer_id, quotation_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON public.sales_orders(customer_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON public.sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_order ON public.sales_commissions(sales_order_id);

ALTER TABLE public.sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_commissions ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['sales_opportunities','sales_quotations','sales_quotation_items','sales_orders','sales_order_items','sales_commissions'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I_access ON public.%I',t,t); EXECUTE format('CREATE POLICY %I_access ON public.%I FOR ALL USING (public.is_super_admin() OR (select role from public.users where id=auth.uid())=\'sales\' OR public.in_section((select id from public.sections where code=\'sales\'))) WITH CHECK (public.is_super_admin() OR (select role from public.users where id=auth.uid())=\'sales\' OR public.in_section((select id from public.sections where code=\'sales\')))',t,t); END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.sales_refresh_opportunity(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN UPDATE public.sales_opportunities SET estimated_value=COALESCE((SELECT total_amount FROM public.sales_quotations WHERE opportunity_id=p_id AND status IN ('approved','sent','accepted') ORDER BY created_at DESC LIMIT 1),estimated_value), status=CASE WHEN EXISTS(SELECT 1 FROM public.sales_orders WHERE opportunity_id=p_id AND status NOT IN ('cancelled')) THEN 'won'::public.sales_opportunity_status ELSE status END, updated_at=now() WHERE id=p_id; END; $$;
GRANT EXECUTE ON FUNCTION public.sales_refresh_opportunity(uuid) TO authenticated;
