// src/shared/expenses/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { submitForReview, markReviewed, markApproved } from './service';

export async function submitForReviewAction(expenseId: string) {
  await submitForReview(expenseId);
  revalidatePath('/', 'layout');
}

export async function markReviewedAction(expenseId: string) {
  await markReviewed(expenseId);
  revalidatePath('/', 'layout');
}

export async function markApprovedAction(expenseId: string) {
  await markApproved(expenseId);
  revalidatePath('/', 'layout');
}
