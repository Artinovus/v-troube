import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Z trouby',
    short_name: 'Z trouby',
    description: 'Náklady, receptury a ceny domácí pekárny',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fbf7f0',
    theme_color: '#fbf7f0',
    lang: 'cs',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
