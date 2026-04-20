import { useState } from 'react';
import {
  decodeEventLog,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { erc20Abi, wrapperAbi } from '../abi';
import type { NoxHandleClient } from '../hooks/useNox';
import type { TrackedToken } from '../hooks/useSnap';
import { TARGET_CHAIN } from '../config';
import { withIngestionRetry } from '../lib/retry';

type Props = {
  tokens: TrackedToken[];
  account: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  noxClient: NoxHandleClient | null;
};

type Step =
  | 'idle'
  | 'encrypting'
  | 'burning'
  | 'waiting-ingestion'
  | 'public-decrypting'
  | 'finalizing'
  | 'done';

const STEP_LABELS: Record<Step, string> = {
  idle: '',
  encrypting: '1/5 Encrypting amount…',
  burning: '2/5 Burning confidential tokens…',
  'waiting-ingestion': '3/5 Waiting for Handle Gateway to index…',
  'public-decrypting': '4/5 Fetching decryption proof…',
  finalizing: '5/5 Finalizing (transferring ERC-20)…',
  done: '✅ Unwrap complete',
};

export function Unwrap({
  tokens,
  account,
  publicClient,
  walletClient,
  noxClient,
}: Props) {
  const [tokenAddr, setTokenAddr] = useState<`0x${string}` | ''>(tokens[0]?.address ?? '');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [txs, setTxs] = useState<{ burn?: string; finalize?: string }>({});
  const [result, setResult] = useState<{ before: bigint; after: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setResult(null);
    setTxs({});
    if (!noxClient) { setError('Nox client not ready'); return; }
    if (!tokenAddr) { setError('Select a token'); return; }
    let amt: bigint;
    try { amt = BigInt(amount); } catch { setError('Invalid amount'); return; }

    try {
      const underlying = await publicClient.readContract({
        address: tokenAddr, abi: wrapperAbi, functionName: 'underlying',
      }) as Address;
      const balBefore = await publicClient.readContract({
        address: underlying, abi: erc20Abi, functionName: 'balanceOf', args: [account],
      }) as bigint;

      setStep('encrypting');
      const enc = await noxClient.encryptInput(amt, 'uint256', tokenAddr);

      setStep('burning');
      const burnHash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: tokenAddr,
        abi: wrapperAbi,
        functionName: 'unwrap',
        args: [account, account, enc.handle, enc.handleProof],
      });
      setTxs((t) => ({ ...t, burn: burnHash }));
      const receipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
      if (receipt.status !== 'success') throw new Error('Unwrap burn tx reverted');

      let unwrapRequestId: `0x${string}` | null = null;
      for (const logEntry of receipt.logs) {
        if (logEntry.address.toLowerCase() !== tokenAddr.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: wrapperAbi, data: logEntry.data, topics: logEntry.topics,
          });
          if (decoded.eventName === 'UnwrapRequested') {
            unwrapRequestId = (decoded.args as { unwrapRequestId: `0x${string}` }).unwrapRequestId;
            break;
          }
        } catch { /* not our event */ }
      }
      if (!unwrapRequestId) throw new Error('UnwrapRequested event not found in receipt');

      setStep('waiting-ingestion');
      setStep('public-decrypting');
      const pub = await withIngestionRetry(() => noxClient.publicDecrypt(unwrapRequestId!));

      setStep('finalizing');
      const finalizeHash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: tokenAddr,
        abi: wrapperAbi,
        functionName: 'finalizeUnwrap',
        args: [unwrapRequestId, pub.decryptionProof],
      });
      setTxs((t) => ({ ...t, finalize: finalizeHash }));
      await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

      const balAfter = await publicClient.readContract({
        address: underlying, abi: erc20Abi, functionName: 'balanceOf', args: [account],
      }) as bigint;
      setResult({ before: balBefore, after: balAfter });
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
      setStep('idle');
    }
  };

  const busy = step !== 'idle' && step !== 'done';

  return (
    <div className="card">
      <h3>Unwrap ERC-7984 → ERC-20</h3>
      <p className="muted">
        2-step flow: burn encrypted amount, then finalize with a decryption proof
        from the Handle Gateway. Both steps run automatically.
      </p>

      <label>Token</label>
      <select value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value as `0x${string}`)} disabled={busy}>
        <option value="">Select a token</option>
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} — {t.address.slice(0, 6)}…{t.address.slice(-4)}
          </option>
        ))}
      </select>

      <label>Amount (raw units)</label>
      <input placeholder="1000000" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />

      <button onClick={run} disabled={busy || !noxClient || !tokenAddr || !amount}>
        {busy ? 'Working…' : 'Unwrap'}
      </button>

      {step !== 'idle' && (
        <div className="stack" style={{ marginTop: 12 }}>
          <p className={step === 'done' ? 'ok' : 'muted'}>{STEP_LABELS[step]}</p>
          {txs.burn && (
            <p className="muted mono" style={{ fontSize: 12 }}>
              burn tx: {txs.burn.slice(0, 10)}…{txs.burn.slice(-8)}
            </p>
          )}
          {txs.finalize && (
            <p className="muted mono" style={{ fontSize: 12 }}>
              finalize tx: {txs.finalize.slice(0, 10)}…{txs.finalize.slice(-8)}
            </p>
          )}
          {result && (
            <p className="ok">
              ERC-20 balance: {result.before.toString()} → {result.after.toString()}
              {' '}(+{(result.after - result.before).toString()})
            </p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
