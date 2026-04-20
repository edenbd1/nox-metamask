import { useState } from 'react';
import type { Address, WalletClient } from 'viem';
import { wrapperAbi } from '../abi';
import type { NoxHandleClient } from '../hooks/useNox';
import { TARGET_CHAIN } from '../config';

type Props = {
  account: Address;
  walletClient: WalletClient;
  noxClient: NoxHandleClient | null;
};

export function Unwrap({ account, walletClient, noxClient }: Props) {
  const [wrapper, setWrapper] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<`0x${string}` | null>(null);

  const requestUnwrap = async () => {
    setError(null); setStatus(null);
    if (!noxClient) { setError('Nox client not ready'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(wrapper)) { setError('Invalid wrapper address'); return; }
    let amt: bigint;
    try { amt = BigInt(amount); } catch { setError('Invalid amount'); return; }

    setBusy(true);
    try {
      setStatus('Encrypting burn amount…');
      const { handle, handleProof } = await noxClient.encryptInput(
        amt, 'uint256', wrapper as `0x${string}`,
      );

      setStatus('Submitting unwrap request (burn)…');
      const hash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: wrapper as `0x${string}`,
        abi: wrapperAbi,
        functionName: 'unwrap',
        args: [account, account, handle as `0x${string}`, handleProof as `0x${string}`],
      });
      setStatus(
        `Unwrap tx: ${hash}. Wait for off-chain decryption, then read the ` +
        `unwrapRequestId from the tx receipt and finalize.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    setError(null);
    if (!pendingRequestId) { setError('Paste an unwrapRequestId first'); return; }
    setBusy(true);
    try {
      setStatus('Finalizing unwrap… (requires decryptedAmountAndProof from the protocol)');
      setError(
        'finalizeUnwrap requires a decryption proof from the Handle Gateway, ' +
        'not yet wired. See packages/site/src/components/Unwrap.tsx for the ' +
        'integration point.',
      );
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h3>Unwrap ERC-7984 → ERC-20</h3>
      <p className="muted">Two steps: (1) burn encrypted amount, (2) finalize after off-chain decryption.</p>
      <label>Wrapper address</label>
      <input placeholder="0x..." value={wrapper} onChange={(e) => setWrapper(e.target.value)} />
      <label>Amount (raw units)</label>
      <input placeholder="1000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button onClick={requestUnwrap} disabled={busy}>Request unwrap</button>

      <hr />
      <label>Unwrap request id (from tx logs)</label>
      <input
        placeholder="0x..."
        value={pendingRequestId ?? ''}
        onChange={(e) => setPendingRequestId(e.target.value as `0x${string}`)}
      />
      <button onClick={finalize} disabled={busy}>Finalize</button>

      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
