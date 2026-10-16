// app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';
import { DialogProvider } from '@/core/ui/Dialog';
import { BusyIndicator } from '@/core/ui/BusyIndicator';
import { LaunchScreen } from '@/core/ui/LaunchScreen';
import { ServiceWorkerRegister } from '@/core/ui/InstallAppButton';
import { LAUNCH_CSS } from '@/core/ui/launchCss';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Build 102c: only when opened as the installed app, once per opening — decided before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: "try{var s=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;if(s&&!sessionStorage.getItem('ibx-launched')){document.documentElement.classList.add('ibx-launching');sessionStorage.setItem('ibx-launched','1')}}catch(e){}" }} />
        <style dangerouslySetInnerHTML={{ __html: LAUNCH_CSS }} />
        <link rel="preload" href="/fonts/roboto-condensed-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/icons/launch-logo.png" as="image" />
      </head>
      <body className="font-sans text-slate-800">
        <LaunchScreen />
        <ServiceWorkerRegister />
        <BusyIndicator />
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
