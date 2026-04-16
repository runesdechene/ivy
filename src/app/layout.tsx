import type { Metadata } from 'next';
import { Inter, Alegreya, Fraunces, JetBrains_Mono } from 'next/font/google';
import React from 'react';
import { ColorSchemeScript } from '@mantine/core';
import { createTheme } from '@mantine/core';
import { ClientLayout } from '@/components/ClientLayout';
import { AuthProvider } from '@/context/AuthContext';
import { ShopProvider } from '@/context/ShopContext';
import '@mantine/core/styles.css';
import '@mantine/nprogress/styles.css';
import '@mantine/notifications/styles.css';
import './globals.scss';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const alegreya = Alegreya({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-alegreya',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  style: ['normal', 'italic'],
});

const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ivy - Gestion de production',
  description: 'Application de gestion de production et facturation',
};

// NOTE: theme is created/overridden in Task 3. Keep the existing minimal theme for now.
const theme = createTheme({
  fontFamily: 'var(--font-inter)',
  headings: {
    fontFamily: 'var(--font-alegreya)', // will change to --font-fraunces in Task 3
  },
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <ColorSchemeScript />
      </head>
      <body
        className={`${inter.variable} ${alegreya.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
      >
        <AuthProvider>
          <ShopProvider>
            <ClientLayout theme={theme}>
              {children}
            </ClientLayout>
          </ShopProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
