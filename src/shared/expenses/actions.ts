// src/shared/expenses/actions.ts
'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { submitForReview, markReviewed, markApproved, deleteExpenseDraft } from './service';

// Keep cache invalidation scoped to the page that actually changed.
// Revalidating the root layout forced the entire authenticated shell to
// re-render after every small workflow transition.
const EXPENSE_PATHS = new Set([
  '/admin/expenses',
  '/finance/expenses',
  '/logistics/expenses',
  '/marketing/expenses',
  '/sales/expenses',
]);

function revalidateExpensePage(pathname: string) {
  if (!EXPENSE_PATHS.has(pathname)) {
    throw appError('Invalid expense page');
  }
  revalidatePath(pathname);
}

export async function submitForReviewAction(expenseId: string, pathname: string) {
  await submitForReview(expenseId);
  revalidateExpensePage(pathname);
}

export async function markReviewedAction(expenseId: string, pathname: string) {
  await markReviewed(expenseId);
  revalidateExpensePage(pathname);
}

export async function markApprovedAction(expenseId: string, pathname: string) {
  await markApproved(expenseId);
  revalidateExpensePage(pathname);
}

export async function deleteExpenseDraftAction(expenseId: string, pathname: string) { await deleteExpenseDraft(expenseId); revalidateExpensePage(pathname); }
