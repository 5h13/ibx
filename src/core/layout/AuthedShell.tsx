// src/core/layout/AuthedShell.tsx
import type { ReactNode } from 'react';
import type { SessionProfile } from '@/core/auth/types';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AuthedShell({ profile, children }: { profile: SessionProfile; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header profile={profile} />
      <div className="flex">
        <Sidebar profile={profile} />
        <main className="flex-1 max-w-5xl mx-auto p-6">{children}</main>
      </div>
    </div>
  );
}
