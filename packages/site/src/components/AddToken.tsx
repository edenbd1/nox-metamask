import { useState } from 'react';
import type { PublicClient } from 'viem';
import { erc7984Abi } from '../abi';
import { TARGET_CHAIN, PRESET_TOKENS } from '../config';

type Props = {
  publicClient: PublicClient;
  onAdd: (token: { address: `0x${string}`; symbol: string; name: string; chainId: number }) => Promise<void>;
};

export function AddToken({ publicClient, onAdd }: Props) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setError('Invalid address');
      return;
    }
    setLoading(true);
    try {
      const addr = address as `0x${string}`;
      const [symbol, name] = await Promise.all([
        publicClient.readContract({ address: addr, abi: erc7984Abi, functionName: 'symbol' }),
        publicClient.readContract({ address: addr, abi: erc7984Abi, functionName: 'name' }),
      ]);
      await onAdd({
        address: addr,
        symbol: symbol as string,
        name: name as string,
        chainId: TARGET_CHAIN.id,
      });
      setAddress('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h3>Add a confidential token</h3>
      <div className="row">
        <input
          className="grow"
          placeholder="0x... (ERC-7984 address)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button onClick={submit} disabled={loading}>
          {loading ? 'Adding…' : 'Add'}
        </button>
      </div>
      {PRESET_TOKENS.length > 0 && (
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
          <span className="muted">Presets:</span>
          {PRESET_TOKENS.map((t) => (
            <button key={t.address} className="ghost" onClick={() => setAddress(t.address)}>
              {t.symbol}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
