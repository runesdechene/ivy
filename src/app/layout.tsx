import type { Metadata } from 'next';
import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';
import React from 'react';
import { ColorSchemeScript } from '@mantine/core';
import { createTheme } from '@mantine/core';
import { ClientLayout } from '@/components/ClientLayout';
import { AuthProvider } from '@/context/AuthContext';
import { ShopProvider } from '@/context/ShopContext';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/nprogress/styles.css';
import '@mantine/notifications/styles.css';
import './globals.scss';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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

const theme = createTheme({
  primaryColor: 'moss',
  fontFamily: 'var(--font-inter)',
  fontFamilyMonospace: 'var(--font-jetbrains)',
  headings: {
    fontFamily: 'var(--font-fraunces)',
  },
  defaultRadius: 'md',
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '14px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '20px',
    xl: '32px',
  },
  // Atelier boréal palettes. Mantine resolves <Button color="x"> to shade[6] by
  // default. Our design tokens (var(--x) / $x) don't always equal shade 6:
  //   - moss/plum/rust      : shade 6 == design token
  //   - slate               : shade 6 == --slate-soft; spec --slate is shade 8
  //                            (use <Badge color="slate.8" /> for exact --slate)
  //   - clay                : shade 5 == design token (--clay = #b38566)
  //   - sand                : shade 3 == design token (--sand = #d4c5a9)
  //   - cream               : used as BACKGROUND only — shade 2 == --cream.
  //     Avoid <Mantine color="cream">; use var(--cream) or $cream in styles.
  // When a component needs the spec color from Mantine, use the exact shade
  // (e.g., <Badge color="clay.5" />).
  colors: {
    moss: [
      '#f4f6ee', '#eaeee0', '#d8dfc3', '#c2cba3', '#a9b585',
      '#8a9a73', '#6b7a55', '#566344', '#424e33', '#2e3724',
    ],
    clay: [
      '#faf0e8', '#f2e1d3', '#e4c4a9', '#d4a887', '#c39070',
      '#b38566', '#9d6f54', '#855b45', '#6c4836', '#523628',
    ],
    sand: [
      '#faf4e7', '#f0e6cc', '#e6dcc7', '#d4c5a9', '#b8a885',
      '#998b67', '#7a6a45', '#625636', '#4a412a', '#332d1e',
    ],
    plum: [
      '#f8f2f5', '#ede2e9', '#dcc4d4', '#c5a8ba', '#ae8da2',
      '#94748a', '#7a5b72', '#63485c', '#4c3746', '#362630',
    ],
    rust: [
      '#fbefeb', '#f6dfd6', '#eebcaf', '#e39880', '#cf7862',
      '#b85f4b', '#a04b3d', '#843d31', '#683027', '#4d241d',
    ],
    slate: [
      '#f2f3f5', '#e0e4e9', '#c6ccd4', '#a8b0bb', '#8b95a3',
      '#6e798a', '#556070', '#3d4654', '#2b3440', '#1a1f2a',
    ],
    cream: [
      '#fdfcf9', '#faf7ef', '#f4f0e8', '#ede5d3', '#e0d5ba',
      '#c9ba97', '#ab9671', '#846f50', '#5c4d37', '#382f21',
    ],
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
        className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
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
