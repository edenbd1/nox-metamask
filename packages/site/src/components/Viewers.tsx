import { useEffect, useState } from 'react';
import type { Address, PublicClient, WalletClient } from 'viem';
import { erc7984Abi, noxComputeAbi } from '../abi';
import { NOX_COMPUTE, TARGET_CHAIN } from '../config';
import type { NoxHandleClient } from '../hooks/useNox';
import type { TrackedToken } from '../hooks/useSnap';
import { withIngestionRetry } from '../lib/retry';

type Props = {
  tokens: TrackedToken[];
  account: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  noxClient: NoxHandleClient | null;
};

export function Viewers({
  tokens, account, publicClient, walletClient, noxClient,
}: Props) {
  return (
    <div className="stack">
      <GrantViewer
        tokens={tokens}
        account={account}
        publicClient={publicClient}
        walletClient={walletClient}
      />
      <DecryptAnyHandle noxClient={noxClient} />
    </div>
  );
}

function GrantViewer({
  tokens, account, publicClient, walletClient,
}: {
  tokens: TrackedToken[];
  account: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
}) {
  const [tokenAddr, setTokenAddr] = useState<`0x${string}` | ''>(tokens[0]?.address ?? '');
  const [viewer, setViewer] = useState('');
  const [handle, setHandle] = useState<`0x${string}` | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tokenAddr) { setHandle(null); return; }
    (async () => {
      try {
        const h = await publicClient.readContract({
          address: tokenAddr, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
          args: [account],
        });
        setHandle(h as `0x${string}`);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [tokenAddr, account, publicClient]);

  const grant = async () => {
    setError(null);
    setStatus(null);
    if (!handle) { setError('No handle loaded'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(viewer)) { setError('Invalid viewer address'); return; }
    setBusy(true);
    try {
      const hash = await walletClient.writeContract({
        chain: TARGET_CHAIN,
        account,
        address: NOX_COMPUTE,
        abi: noxComputeAbi,
        functionName: 'addViewer',
        args: [handle, viewer as Address],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('addViewer reverted');
      setStatus(`Granted. tx: ${hash.slice(0, 10)}…${hash.slice(-8)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isZeroHandle = handle && /^0x0+$/.test(handle);

  return (
    <div className="card">
      <h3>Grant a viewer access to your balance</h3>
      <p className="muted">
        Grants the viewer permission to decrypt your current balance handle.
        <br />
        <strong>Warning:</strong> access is tied to the current handle. After any
        transfer/wrap/unwrap, your balance handle changes and you need to re-grant.
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

      <label>Your current balance handle</label>
      <p className="mono muted" style={{ fontSize: 12 }}>
        {handle ?? '—'}
        {isZeroHandle && ' (no balance — nothing to share)'}
      </p>

      <label>Viewer address</label>
      <input
        placeholder="0x..."
        value={viewer}
        onChange={(e) => setViewer(e.target.value)}
        disabled={busy}
      />

      <button onClick={grant} disabled={busy || !handle || isZeroHandle || !viewer}>
        {busy ? 'Granting…' : 'Grant viewer'}
      </button>

      {status && <p className="ok">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function DecryptAnyHandle({ noxClient }: { noxClient: NoxHandleClient | null }) {
  const [handle, setHandle] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const tryDecrypt = async () => {
    setError(null);
    setResult(null);
    setStatus(null);
    if (!noxClient) { setError('Nox client not ready'); return; }
    if (!/^0x[0-9a-fA-F]{64}$/.test(handle)) { setError('Handle must be 32 bytes (0x + 64 hex)'); return; }
    setBusy(true);
    try {
      const { value, solidityType } = await withIngestionRetry(
        () => noxClient.decrypt(handle as `0x${string}`),
        { onAttempt: ({ attempt, delayMs }) => setStatus(`Ingestion lag — retry ${attempt} in ${delayMs}ms`) },
      );
      setResult(`${solidityType}: ${value}`);
      setStatus(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Decrypt a handle as me</h3>
      <p className="muted">
        Paste any handle. Succeeds only if your connected wallet is in the ACL
        (the handle's owner or a viewer you've been granted).
      </p>

      <label>Handle (bytes32)</label>
      <input
        placeholder="0x... (32 bytes)"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        disabled={busy}
      />

      <button onClick={tryDecrypt} disabled={busy || !noxClient}>
        {busy ? 'Decrypting…' : 'Decrypt'}
      </button>

      {status && <p className="muted">{status}</p>}
      {result && <p className="ok mono">{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
