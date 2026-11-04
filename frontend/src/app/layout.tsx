/** Root layout: global styles and app-wide providers (language, toasts, login session). */
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Imtixaan - Online Exams',
  description: 'Fair, cheat-resistant online exams for Somali universities',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f5a35' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="so">
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
