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
import { useAtelier } from '@/lib/atelier';

interface ClientLayoutProps {
  theme: any;
  children: React.ReactNode;
}

export function ClientLayout({ theme, children }: ClientLayoutProps) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/onboarding';
  const isIvySection = pathname.startsWith('/ivy');
  const isHubSection = pathname.startsWith('/ivy/hub');
  const isParametresPage = pathname.startsWith('/parametres');

  const atelier = useAtelier();
  // La section HUB a son propre layout sans TopNavbar ; IVY Atelier n'a que ses deux onglets
  const showTopNavbar = !isAuthPage && !isHubSection && !atelier;

  return (
    <MantineProvider theme={theme}>
      <ModalsProvider>
        <Notifications />
        <QueryClientProvider>
          <TerminalProvider>
            {showTopNavbar && <TopNavbar />}
            {isAuthPage ? (
              children
            ) : isHubSection ? (
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
