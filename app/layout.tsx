// app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'IBX — Ishabella Commission & Sales System',
  description: 'Department-partitioned commission and sales management system.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-slate-800">{children}</body>
    </html>
  );
}
