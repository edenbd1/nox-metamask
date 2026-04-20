import { useEffect, useState } from 'react';
import { createViemHandleClient } from '@iexec-nox/handle';
import type { WalletClient } from 'viem';

export type NoxHandleClient = Awaited<ReturnType<typeof createViemHandleClient>>;

export function useNox(walletClient: WalletClient | null) {
  const [client, setClient] = useState<NoxHandleClient | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!walletClient) {
      setClient(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const c = await createViemHandleClient(walletClient);
        if (!cancelled) setClient(c);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      }
    })();
    return () => { cancelled = true; };
  }, [walletClient]);

  return { client, error };
}
