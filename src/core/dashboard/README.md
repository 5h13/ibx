Dashboard data access currently lives inline in app/dashboard/page.tsx
(reads public.financial_summary). Pull it into a service here if the
dashboard grows beyond the 4-figure staff-minimum view (Total Sales,
Total Expense, Bottomline, Commission — build plan section 4).
