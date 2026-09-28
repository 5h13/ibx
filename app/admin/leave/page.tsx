import { redirect } from 'next/navigation';

// U020 — Timekeeping and Leave are now a single consolidated screen at
// /admin/timekeeping (Leave/Balances/Leave types tabs). This route is kept
// so old bookmarks and links still land somewhere useful.
export default function LeavePageRedirect() {
  redirect('/admin/timekeeping?tab=leave');
}
