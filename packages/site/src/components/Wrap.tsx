import { useEffect, useState } from 'react';
import type { Address, PublicClient, WalletClient } from 'viem';
import { erc20Abi, wrapperAbi } from '../abi';
import { TARGET_CHAIN } from '../config';

type Props = {
  account: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export function Wrap({ account, publicClient, walletClient }: Props) {
  const [wrapper, setWrapper] = useState('');
  const [underlying, setUnderlying] = useState<`0x${string}` | null>(null);
  const [amount, setAmount] = useState('');
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUnderlying(null);
    setAllowance(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wrapper)) return;
    (async () => {
      try {
        const u = await publicClient.readContract({
          address: wrapper as `0x${string}`,
          abi: wrapperAbi,
          functionName: 'underlying',
        });
        setUnderlying(u as `0x${string}`);
        const a = await publicClient.readContract({
          address: u as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, wrapper as `0x${string}`],
        });
        setAllowance(a as bigint);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [wrapper, account, publicClient]);

  const needsApproval = () => {
    try { return allowance !== null && BigInt(amount) > allowance; } catch { return false; }
  };

  const approve = async () => {
    if (!underlying) return;
    setBusy(true); setError(null);
    try {
      const hash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: underlying,
        abi: erc20Abi,
        functionName: 'approve',
        args: [wrapper as `0x${string}`, BigInt(amount)],
      });
      setStatus(`Approval tx: ${hash}`);
      setAllowance(BigInt(amount));
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  const wrap = async () => {
    setBusy(true); setError(null);
    try {
      const hash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: wrapper as `0x${string}`,
        abi: wrapperAbi,
        functionName: 'wrap',
        args: [account, BigInt(amount)],
      });
      setStatus(`Wrap tx: ${hash}`);
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h3>Wrap ERC-20 → ERC-7984</h3>
      <label>Wrapper address</label>
      <input placeholder="0x..." value={wrapper} onChange={(e) => setWrapper(e.target.value)} />
      {underlying && <p className="muted">Underlying: <span className="mono">{underlying}</span></p>}
      <label>Amount (raw units)</label>
      <input placeholder="1000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="row">
        <button onClick={approve} disabled={busy || !needsApproval()}>Approve</button>
        <button onClick={wrap} disabled={busy || !amount}>Wrap</button>
      </div>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
