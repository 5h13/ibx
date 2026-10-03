'use client';
import { Form } from '@/core/ui/Form';
import { useRouter } from 'next/navigation';
import { SetPasswordForm } from '@/modules/account/SetPasswordForm';

export function ChangePasswordClient({ forced }: { forced: boolean }) {
  const router = useRouter();
  return (
    <>
      <SetPasswordForm submitLabel={forced ? 'Save and continue' : 'Save password'} onDone={() => { router.push(forced ? '/dashboard' : '/profile'); router.refresh(); }} />
      {!forced && <a href="/profile" className="block text-center text-xs text-slate-500 underline">Cancel</a>}
      {forced && <Form action="/api/auth/signout" method="post"><button className="w-full text-center text-xs text-slate-500 underline">Sign out</button></Form>}
    </>
  );
}
