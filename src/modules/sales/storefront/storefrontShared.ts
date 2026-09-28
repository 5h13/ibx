// Shared Storefront helpers (Build 67/68).
import type { PaymentInput } from './actions';

export type Pay = { method: PaymentInput['method']; amount: string; reference: string; account?: string };
export const METHODS: { v: PaymentInput['method']; l: string }[] = [
  { v: 'cash', l: 'Cash' }, { v: 'gcash', l: 'GCash' }, { v: 'maya', l: 'Maya' }, { v: 'card', l: 'Card' }, { v: 'bank_transfer', l: 'Bank transfer' },
];
export const methodLabel = (m: string) => METHODS.find((x) => x.v === m)?.l ?? m;
export const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
export const paysTotal = (pays: Pay[]) => r2(pays.reduce((s, p) => s + (Number.isFinite(num(p.amount)) ? num(p.amount) : 0), 0));
export const paysToInput = (pays: Pay[]): PaymentInput[] =>
  pays.filter((p) => num(p.amount) > 0).map((p) => ({ method: p.method, amount: num(p.amount), reference: p.reference, ...(p.account ? { account: p.account } : {}) }));
export const KIND_LABEL: Record<string, string> = { sale: 'Sale', ar_collection: 'AR payment', refund: 'Refund' };
/** Signed amount for variances: +₱6.50 / −₱6.50 / ₱0.00. */
export const pesoSigned = (v: unknown) => { const n = Number(v ?? 0); return n > 0 ? `+${peso(n)}` : n < 0 ? `−${peso(-n)}` : peso(0); };
