'use client';

import React from 'react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@/state/QueryClientProvider';
import { TerminalProvider } from '@/contexts/TerminalContext';
import { TerminalFloating } from '@/components/Terminal/TerminalFloating';
import { IvyLayout } from '@/layout/IvyLayout';
import { ParametresLayout } from '@/layout/ParametresLayout';
import { TopNavbar } from '@/components/TopNavbar/TopNavbar';
import { usePathname } from 'next/navigation';

interface ClientLayoutProps {
  theme: any;
  children: React.ReactNode;
}

export function ClientLayout({ theme, children }: ClientLayoutProps) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/onboarding';
  const isIvySection = pathname.startsWith('/ivy');
  const isCaisseSection = pathname.startsWith('/ivy/caisse');
  const isParametresPage = pathname.startsWith('/parametres');

  // La section Caisse a son propre layout sans TopNavbar
  const showTopNavbar = !isAuthPage && !isCaisseSection;

  return (
    <MantineProvider theme={theme}>
      <ModalsProvider>
        <Notifications />
        <QueryClientProvider>
          <TerminalProvider>
            {showTopNavbar && <TopNavbar />}
            {isAuthPage ? (
              children
            ) : isCaisseSection ? (
              children
            ) : isParametresPage ? (
              <ParametresLayout>{children}</ParametresLayout>
            ) : isIvySection ? (
              <IvyLayout>{children}</IvyLayout>
            ) : (
              <div style={{ padding: '2rem' }}>{children}</div>
            )}
            <TerminalFloating />
          </TerminalProvider>
        </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  );
}
