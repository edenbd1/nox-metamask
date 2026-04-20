import { useCallback, useEffect, useState } from 'react';
import type { Address, PublicClient } from 'viem';
import { erc7984Abi } from '../abi';
import type { NoxHandleClient } from '../hooks/useNox';
import type { TrackedToken } from '../hooks/useSnap';

type Props = {
  tokens: TrackedToken[];
  account: Address;
  publicClient: PublicClient;
  noxClient: NoxHandleClient | null;
  onRemove: (address: `0x${string}`) => Promise<void>;
};

type BalanceRow = {
  handle: `0x${string}` | null;
  plaintext: bigint | null;
  decrypting: boolean;
  error: string | null;
};

const emptyRow: BalanceRow = { handle: null, plaintext: null, decrypting: false, error: null };

export function TokenList({ tokens, account, publicClient, noxClient, onRemove }: Props) {
  const [rows, setRows] = useState<Record<string, BalanceRow>>({});

  const loadHandles = useCallback(async () => {
    const next: Record<string, BalanceRow> = {};
    for (const token of tokens) {
      try {
        const handle = await publicClient.readContract({
          address: token.address,
          abi: erc7984Abi,
          functionName: 'confidentialBalanceOf',
          args: [account],
        });
        next[token.address] = {
          ...emptyRow,
          handle: handle as `0x${string}`,
        };
      } catch (err) {
        next[token.address] = {
          ...emptyRow,
          error: (err as Error).message,
        };
      }
    }
    setRows(next);
  }, [tokens, account, publicClient]);

  useEffect(() => { void loadHandles(); }, [loadHandles]);

  const decrypt = async (address: string, handle: `0x${string}`) => {
    if (!noxClient) return;
    setRows((prev) => ({ ...prev, [address]: { ...prev[address]!, decrypting: true, error: null } }));
    try {
      const { value } = await noxClient.decrypt(handle as never);
      setRows((prev) => ({
        ...prev,
        [address]: { ...prev[address]!, decrypting: false, plaintext: value as bigint },
      }));
    } catch (err) {
      setRows((prev) => ({
        ...prev,
        [address]: { ...prev[address]!, decrypting: false, error: (err as Error).message },
      }));
    }
  };

  if (tokens.length === 0) {
    return <p className="muted">No tokens tracked. Add one below.</p>;
  }

  return (
    <div className="stack">
      {tokens.map((token) => {
        const row = rows[token.address] ?? emptyRow;
        const isZeroHandle = row.handle && /^0x0+$/.test(row.handle);
        return (
          <div key={token.address} className="card">
            <div className="row">
              <div>
                <div className="symbol">{token.symbol}</div>
                <div className="muted mono">{token.address}</div>
              </div>
              <button className="ghost" onClick={() => onRemove(token.address)}>
                remove
              </button>
            </div>
            <div className="row">
              <span className="muted">Balance handle:</span>
              <span className="mono">
                {row.handle ? `${row.handle.slice(0, 10)}…${row.handle.slice(-8)}` : '—'}
              </span>
            </div>
            {isZeroHandle ? (
              <p className="muted">No balance yet on this account.</p>
            ) : row.plaintext !== null ? (
              <div className="balance">
                <Bold>{row.plaintext.toString()}</Bold> <span className="muted">(raw units)</span>
              </div>
            ) : (
              <button
                disabled={!row.handle || !noxClient || row.decrypting}
                onClick={() => row.handle && decrypt(token.address, row.handle)}
              >
                {row.decrypting ? 'Decrypting…' : 'Decrypt balance'}
              </button>
            )}
            {row.error && <p className="error">{row.error}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return <strong>{children}</strong>;
}
