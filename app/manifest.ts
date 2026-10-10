// Build 95 — web app manifest: lets agents (and staff) install 5H13 on a phone's home screen.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '5H13 Business Solutions',
    short_name: '5H13',
    description: 'Pili-Aire, Aton Aire and Ishabella — orders, clients, payments and expenses.',
    id: '/agent',
    start_url: '/agent',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Build 102c: the phone's own start screen is the blue of the 5H13 launch screen (a phone draws it in one colour);
    // the app then shows the full blue → red launch screen for a moment (LaunchScreen in app/layout.tsx)
    background_color: '#0a37a6',
    theme_color: '#0f172a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
