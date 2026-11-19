'use client';

import { useEffect, useState } from 'react';

/** Vrai dans l'application IVY Atelier (Windows), qui signe son User-Agent `IvyAtelier/<version>`. */
export function estAtelier(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('IvyAtelier/');
}

/** `estAtelier()` lu après le montage : le rendu serveur et le premier rendu client restent identiques. */
export function useAtelier(): boolean {
  const [atelier, setAtelier] = useState(false);
  useEffect(() => setAtelier(estAtelier()), []);
  return atelier;
}
