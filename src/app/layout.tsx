import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Z trouby', template: '%s · Z trouby' },
  description: 'Náklady, receptury a ceny domácí pekárny Z trouby.',
  applicationName: 'Z trouby',
  appleWebApp: { capable: true, title: 'Z trouby', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#fbf7f0',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster position="top-center" richColors closeButton />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}
