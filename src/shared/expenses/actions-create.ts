// src/shared/expenses/actions-create.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createExpenseDraft } from './service';
import type { SectionCode } from '@/core/auth/types';

export async function createExpenseDraftAction(sectionCode: SectionCode, monthId: string, formData: FormData) {
  const description = String(formData.get('description') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  await createExpenseDraft(sectionCode, monthId, description, amount);
  revalidatePath('/', 'layout');
}
