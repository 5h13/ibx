// src/core/layout/Header.tsx
import type { SessionProfile } from '@/core/auth/types';

export function Header({ profile }: { profile: SessionProfile }) {
  return (
    <header className="bg-slate-900 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-wide">ISHABELLA AIRCON &amp; REFRIGERATION</h1>
          <p className="text-xs text-slate-400">Commission &amp; Sales Management System</p>
        </div>
        <div className="text-sm text-slate-300">
          {profile.user.full_name ?? profile.user.email} &middot;{' '}
          <span className="uppercase text-slate-400">{profile.user.role}</span>
        </div>
      </div>
    </header>
  );
}
