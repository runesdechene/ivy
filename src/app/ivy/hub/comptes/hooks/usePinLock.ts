'use client';
import { useCallback, useEffect, useState } from 'react';
import { hubJson } from '../api-client';

const KEY = 'hub_comptes_unlock';
const AUTO_LOCK_MS = 2 * 60 * 1000; // re-verrouille après 2 min d'inactivité

export type PinState = 'loading' | 'needs-setup' | 'locked' | 'unlocked';

export function usePinLock(shopId: string | undefined) {
  const [state, setState] = useState<PinState>('loading');

  const lock = useCallback(() => {
    sessionStorage.removeItem(KEY);
    setState('locked');
  }, []);

  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    hubJson<{ pinSet: boolean }>(`/api/hub/comptes/pin?shopId=${shopId}`)
      .then((r) => {
        if (!alive) return;
        if (!r.pinSet) setState('needs-setup');
        else setState(sessionStorage.getItem(KEY) ? 'unlocked' : 'locked');
      })
      .catch(() => alive && setState('locked'));
    return () => { alive = false; };
  }, [shopId]);

  useEffect(() => {
    if (state !== 'unlocked') return;
    let timer = setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, AUTO_LOCK_MS); };
    const onHide = () => { if (document.visibilityState === 'hidden') lock(); };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [state, lock]);

  const setup = useCallback(async (pin: string) => {
    if (!shopId) return;
    const { unlockToken } = await hubJson<{ unlockToken: string }>('/api/hub/comptes/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, action: 'setup', pin }),
    });
    sessionStorage.setItem(KEY, unlockToken);
    setState('unlocked');
  }, [shopId]);

  const unlock = useCallback(async (pin: string) => {
    if (!shopId) return;
    const { unlockToken } = await hubJson<{ unlockToken: string }>('/api/hub/comptes/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, action: 'unlock', pin }),
    });
    sessionStorage.setItem(KEY, unlockToken);
    setState('unlocked');
  }, [shopId]);

  return { state, setup, unlock, lock };
}
