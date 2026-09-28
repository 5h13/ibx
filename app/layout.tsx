// app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';
import { DialogProvider } from '@/core/ui/Dialog';

export const metadata = {
  title: '5H13 Business Solutions',
  description: '5H13 Business Solutions — multi-business operations for Pili-Aire, Aton Aire and Ishabella.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-slate-800">
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
