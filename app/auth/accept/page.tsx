'use client';
// Build 72 (U065) — landing page of an invitation or password-reset email.
// Supabase sends the user here with a one-time sign-in in the link (tokens in
// the #fragment, a ?code, or a ?token_hash); we open that session, then the
// user chooses their own password.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseClient';
import { AuthCard } from '@/modules/account/AuthCard';
import { SetPasswordForm } from '@/modules/account/SetPasswordForm';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [email, setEmail] = useState('');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const query = new URLSearchParams(window.location.search);
        const linkError = hash.get('error_description') || query.get('error_description');
        if (linkError) throw new Error(linkError.replace(/\+/g, ' '));
        if (hash.get('access_token') && hash.get('refresh_token')) {
          const { error } = await supabase.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
          if (error) throw error;
        } else if (query.get('code')) {
          const { error } = await supabase.auth.exchangeCodeForSession(query.get('code')!);
          if (error) throw error;
        } else if (query.get('token_hash')) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: query.get('token_hash')!, type: (query.get('type') as any) || 'invite' });
          if (error) throw error;
        }
        window.history.replaceState(null, '', '/auth/accept'); // do not leave the one-time tokens in the address bar
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('This link has expired or was already used.');
        setEmail(user.email ?? '');
        setState('ready');
      } catch (e: any) {
        setDetail(e?.message ?? '');
        setState('invalid');
      }
    })();
  }, []);

  return (
    <AuthCard title="Set your password" subtitle="5H13 Business Solutions">
      {state === 'checking' && <p className="text-sm text-slate-500">Opening your link…</p>}
      {state === 'invalid' && (
        <div className="space-y-3 text-sm">
          <p className="text-red-600">This link has expired or was already used.{detail ? ` (${detail})` : ''}</p>
          <p className="text-slate-600">Ask your administrator to send a new invitation or reset link, or sign in if you already set your password.</p>
          <a href="/login" className="block w-full rounded bg-slate-900 py-2 text-center text-sm font-semibold text-white">Go to sign in</a>
        </div>
      )}
      {state === 'ready' && (
        <>
          <p className="text-sm text-slate-600">Welcome{email ? `, ${email}` : ''}. Choose the password you will use to sign in.</p>
          <SetPasswordForm submitLabel="Save and continue" onDone={() => { router.push('/dashboard'); router.refresh(); }} />
        </>
      )}
    </AuthCard>
  );
}
