// Build 95 — web app manifest: lets agents (and staff) install 5H13 on a phone's home screen.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '5H13 Business Solutions',
    short_name: '5H13',
    description: 'Pili-Aire, Aton Aire and Ishabella — orders, clients, payments and expenses.',
    id: '/agent',
    // Build 117: the installed app opens on the home page, which sends office users to the Dashboard and
    // agents to the agent app (id kept as '/agent' so apps already installed on phones stay the same app)
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Build 121: links to the app (e.g. a password-reset email) open in the installed app where the browser allows it
    // (Chrome / Edge "Open supported links"); otherwise in a tab, which shares the same sign-in.
    ...({ launch_handler: { client_mode: ['navigate-existing', 'auto'] }, handle_links: 'preferred' } as Record<string, unknown>),
    orientation: 'any',   // Build 117: a computer window or a tablet in landscape too
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
