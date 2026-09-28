// src/shared/expenses/actions-create.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createExpenseDraft } from './service';
import type { SectionCode } from '@/core/auth/types';

const EXPENSE_PATH_BY_SECTION: Record<SectionCode, string> = {
  admin: '/admin/expenses',
  finance: '/finance/expenses',
  logistics: '/logistics/expenses',
  marketing: '/marketing/expenses',
  sales: '/sales/expenses',
};

export async function createExpenseDraftAction(sectionCode: SectionCode, monthId: string, formData: FormData) {
  const description = String(formData.get('description') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  const costCenterId = String(formData.get('cost_center_id') ?? '').trim() || null;
  const categoryId = String(formData.get('category_id') ?? '').trim() || null;
  const supplierId = String(formData.get('supplier_id') ?? '').trim() || null;
  await createExpenseDraft(sectionCode, monthId, description, amount, costCenterId, categoryId, supplierId);
  revalidatePath(EXPENSE_PATH_BY_SECTION[sectionCode]);
}
