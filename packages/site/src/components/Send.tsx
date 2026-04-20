import { useState } from 'react';
import type { Address, WalletClient } from 'viem';
import { erc7984Abi } from '../abi';
import type { NoxHandleClient } from '../hooks/useNox';
import type { TrackedToken } from '../hooks/useSnap';
import { TARGET_CHAIN } from '../config';

type Props = {
  tokens: TrackedToken[];
  account: Address;
  walletClient: WalletClient;
  noxClient: NoxHandleClient | null;
};

export function Send({ tokens, account, walletClient, noxClient }: Props) {
  const [tokenAddr, setTokenAddr] = useState<`0x${string}` | ''>(tokens[0]?.address ?? '');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setStatus(null);
    setError(null);
    if (!noxClient) { setError('Nox client not ready'); return; }
    if (!tokenAddr) { setError('Select a token'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { setError('Invalid recipient'); return; }
    let amt: bigint;
    try { amt = BigInt(amount); } catch { setError('Invalid amount'); return; }

    setBusy(true);
    try {
      setStatus('Encrypting amount via Handle Gateway…');
      const { handle, handleProof } = await noxClient.encryptInput(
        amt, 'uint256', tokenAddr,
      );

      setStatus('Sending confidential transfer…');
      const hash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: tokenAddr,
        abi: erc7984Abi,
        functionName: 'confidentialTransfer',
        args: [to as Address, handle as `0x${string}`, handleProof as `0x${string}`],
      });
      setStatus(`Tx submitted: ${hash}`);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Send confidential tokens</h3>
      <label>Token</label>
      <select value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value as `0x${string}`)}>
        <option value="">Select a token</option>
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} — {t.address.slice(0, 6)}…{t.address.slice(-4)}
          </option>
        ))}
      </select>
      <label>Recipient</label>
      <input placeholder="0x..." value={to} onChange={(e) => setTo(e.target.value)} />
      <label>Amount (raw units)</label>
      <input placeholder="1000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button onClick={submit} disabled={busy}>
        {busy ? 'Working…' : 'Send'}
      </button>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
