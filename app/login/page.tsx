// app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="bg-white shadow-md rounded-lg p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/5h13-logo.jpg" alt="5H13" className="h-14 w-14 rounded-xl object-cover" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">5H13 Business Solutions</h1>
            <p className="text-xs text-slate-500">Business Management System</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className="block text-xs text-slate-500 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="you@company.com"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white text-sm font-semibold py-2 rounded hover:bg-slate-700"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-slate-500 pt-3 border-t text-center">
          Welcome to 5H13 Business Solutions. Sign in with the account your administrator gave you.
        </p>
      </form>
    </div>
  );
}
