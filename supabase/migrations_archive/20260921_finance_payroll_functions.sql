-- Payroll totals helper
create or replace function public.recalculate_payroll_run_totals(p_run_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.payroll_runs r set
    employee_count=(select count(*) from public.payroll_entries e where e.payroll_run_id=r.id),
    gross_pay=coalesce((select sum(gross_pay) from public.payroll_entries e where e.payroll_run_id=r.id),0),
    total_deductions=coalesce((select sum(total_deductions) from public.payroll_entries e where e.payroll_run_id=r.id),0),
    net_pay=coalesce((select sum(net_pay) from public.payroll_entries e where e.payroll_run_id=r.id),0),
    updated_at=now()
  where r.id=p_run_id;
end; $$;
