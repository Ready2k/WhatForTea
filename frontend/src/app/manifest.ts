import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "What's for Tea?",
    short_name: 'WhatsForTea',
    description: 'AI-powered recipe manager and kitchen assistant',
    start_url: '/',
    display: 'standalone',
    background_color: '#111827',
    theme_color: '#6366f1',
    orientation: 'portrait-primary',
    categories: ['food', 'lifestyle'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
