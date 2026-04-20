'use client';

import { Badge } from '@mantine/core';

interface DaysElapsedProps {
  createdAt: string;
  isFulfilled?: boolean;
}

export function DaysElapsed({ createdAt, isFulfilled }: DaysElapsedProps) {
  if (isFulfilled) {
    return (
      <Badge color="moss" variant="light">
        Expédié
      </Badge>
    );
  }

  const getColor = (days: number) => {
    if (days <= 7) return 'moss';
    if (days <= 14) return 'sand';
    return 'rust';
  };

  const getDaysElapsed = (date: string) => {
    const orderDate = new Date(date);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - orderDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const days = getDaysElapsed(createdAt);
  
  return (
    <Badge color={getColor(days)} variant="light">
      {days} jour{days > 1 ? 's' : ''}
    </Badge>
  );
}
