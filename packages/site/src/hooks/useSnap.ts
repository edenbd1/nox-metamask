import { useCallback, useEffect, useState } from 'react';
import { SNAP_ORIGIN, SNAP_VERSION } from '../config';

export type TrackedToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  chainId: number;
  addedAt: number;
};

async function ethRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
  if (!window.ethereum) throw new Error('MetaMask not detected');
  return (await window.ethereum.request({ method, params: params as object })) as T;
}

export function useSnap() {
  const [installed, setInstalled] = useState(false);
  const [tokens, setTokens] = useState<TrackedToken[]>([]);

  const checkInstalled = useCallback(async () => {
    try {
      const snaps = await ethRequest<Record<string, { version: string }>>(
        'wallet_getSnaps',
      );
      setInstalled(Boolean(snaps?.[SNAP_ORIGIN]));
    } catch {
      setInstalled(false);
    }
  }, []);

  const install = useCallback(async () => {
    await ethRequest('wallet_requestSnaps', {
      [SNAP_ORIGIN]: { version: SNAP_VERSION },
    });
    await checkInstalled();
  }, [checkInstalled]);

  const invokeSnap = useCallback(
    async <T = unknown>(method: string, params?: unknown): Promise<T> => {
      return ethRequest<T>('wallet_invokeSnap', {
        snapId: SNAP_ORIGIN,
        request: { method, params },
      });
    },
    [],
  );

  const refreshTokens = useCallback(async () => {
    if (!installed) return;
    const list = await invokeSnap<TrackedToken[]>('nox_listTokens');
    setTokens(list ?? []);
  }, [installed, invokeSnap]);

  const addToken = useCallback(
    async (token: Omit<TrackedToken, 'addedAt'>) => {
      const list = await invokeSnap<TrackedToken[]>('nox_addToken', token);
      setTokens(list ?? []);
    },
    [invokeSnap],
  );

  const removeToken = useCallback(
    async (address: `0x${string}`) => {
      const list = await invokeSnap<TrackedToken[]>('nox_removeToken', { address });
      setTokens(list ?? []);
    },
    [invokeSnap],
  );

  useEffect(() => { void checkInstalled(); }, [checkInstalled]);
  useEffect(() => { void refreshTokens(); }, [refreshTokens]);

  return { installed, install, tokens, addToken, removeToken, refreshTokens, invokeSnap };
}
