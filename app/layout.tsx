// app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';
import { DialogProvider } from '@/core/ui/Dialog';
import { BusyIndicator } from '@/core/ui/BusyIndicator';

export const metadata = {
  title: '5H13 Business Solutions',
  description: '5H13 Business Solutions — multi-business operations for Pili-Aire, Aton Aire and Ishabella.',
  // Build 95 — installable app (manifest from app/manifest.ts)
  appleWebApp: { capable: true, title: '5H13', statusBarStyle: 'default' as const },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-slate-800">
        <BusyIndicator />
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
