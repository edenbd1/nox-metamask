import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseUnits,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { createViemHandleClient } from '@iexec-nox/handle';

import deployments from '../deployments/arbitrumSepolia.json';

dotenv.config({ path: resolve(__dirname, '../../../.env.local') });

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const PK = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
if (!PK) throw new Error('DEPLOYER_PRIVATE_KEY missing');

const mUSDC = deployments.contracts.mUSDC as Address;
const cUSDC = deployments.contracts.cUSDC as Address;
const NOX_COMPUTE = deployments.nox.noxCompute as Address;

const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const erc7984Abi = [
  { type: 'function', name: 'confidentialBalanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;

const wrapperAbi = [
  ...erc7984Abi,
  { type: 'function', name: 'wrap', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'unwrap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'finalizeUnwrap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'unwrapRequestId', type: 'bytes32' },
      { name: 'decryptedAmountAndProof', type: 'bytes' },
    ],
    outputs: [] },
  { type: 'event', name: 'UnwrapRequested',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'unwrapRequestId', type: 'bytes32', indexed: false },
    ] },
  { type: 'event', name: 'UnwrapFinalized',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'unwrapRequestId', type: 'bytes32', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ] },
] as const;

const noxComputeAbi = [
  { type: 'function', name: 'addViewer', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  { type: 'function', name: 'isViewer', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

const log = (step: string, msg: string) => console.log(`\n[${step}] ${msg}`);

async function waitTx(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`Tx ${hash} failed`);
  return r;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  { attempts = 8, initialDelayMs = 3000 } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? '';
      const isIngestionLag = msg.includes('Object not found') || msg.includes('404');
      if (!isIngestionLag) throw err;
      const delay = initialDelayMs * (i + 1);
      console.log(`  ${label}: ingestion lag, retry ${i + 1}/${attempts} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function main() {
  const sender = privateKeyToAccount(PK);
  const observer = privateKeyToAccount(generatePrivateKey());
  console.log(`Sender:   ${sender.address}`);
  console.log(`Observer: ${observer.address} (ephemeral viewer)`);
  console.log(`cUSDC:    ${cUSDC}`);
  console.log(`mUSDC:    ${mUSDC}`);
  console.log(`NoxCompute: ${NOX_COMPUTE}`);

  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
  const senderWallet = createWalletClient({ account: sender, chain: arbitrumSepolia, transport: http(RPC) });
  const observerWallet = createWalletClient({ account: observer, chain: arbitrumSepolia, transport: http(RPC) });

  const noxSender = await createViemHandleClient(senderWallet);
  const noxObserver = await createViemHandleClient(observerWallet);

  const WRAP_AMOUNT = parseUnits('50', 6);
  const UNWRAP_AMOUNT = parseUnits('30', 6);

  // ============================================================
  // PRELUDE — ensure sender has fresh cUSDC to play with
  // ============================================================
  log('0', 'Ensure sender has enough cUSDC (wrap some mUSDC if needed)');
  const mBal = await publicClient.readContract({
    address: mUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [sender.address],
  });
  if (mBal < WRAP_AMOUNT) throw new Error('Not enough mUSDC to run test');
  const allowance = await publicClient.readContract({
    address: mUSDC, abi: erc20Abi, functionName: 'allowance',
    args: [sender.address, cUSDC],
  });
  if (allowance < WRAP_AMOUNT) {
    const h = await senderWallet.writeContract({
      address: mUSDC, abi: erc20Abi, functionName: 'approve',
      args: [cUSDC, WRAP_AMOUNT],
    });
    await waitTx(publicClient, h);
  }
  const wrapHash = await senderWallet.writeContract({
    address: cUSDC, abi: wrapperAbi, functionName: 'wrap',
    args: [sender.address, WRAP_AMOUNT],
  });
  await waitTx(publicClient, wrapHash);
  console.log(`  wrap tx: ${wrapHash}`);
  const senderHandle = await publicClient.readContract({
    address: cUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [sender.address],
  });
  const { value: senderBalBefore } = await noxSender.decrypt(senderHandle);
  console.log(`  sender cUSDC balance (decrypted): ${senderBalBefore}`);

  // ============================================================
  // TEST A — Unwrap full 2-step flow
  // ============================================================
  console.log('\n═══════════════════ TEST A: UNWRAP ═══════════════════');

  log('A1', `Request unwrap of ${UNWRAP_AMOUNT} cUSDC`);
  const encUnwrap = await noxSender.encryptInput(UNWRAP_AMOUNT, 'uint256', cUSDC);
  const unwrapHash = await senderWallet.writeContract({
    address: cUSDC, abi: wrapperAbi, functionName: 'unwrap',
    args: [sender.address, sender.address, encUnwrap.handle, encUnwrap.handleProof],
  });
  const unwrapReceipt = await waitTx(publicClient, unwrapHash);
  console.log(`  unwrap tx: ${unwrapHash}`);

  log('A2', 'Parse UnwrapRequested event to get unwrapRequestId');
  let unwrapRequestId: `0x${string}` | null = null;
  for (const logEntry of unwrapReceipt.logs) {
    if (logEntry.address.toLowerCase() !== cUSDC.toLowerCase()) continue;
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
  if (!unwrapRequestId) throw new Error('UnwrapRequested event not found');
  console.log(`  unwrapRequestId: ${unwrapRequestId}`);

  log('A3', 'publicDecrypt on unwrapRequestId (handle is publicly decryptable)');
  const pub = await withRetry('publicDecrypt', () => noxSender.publicDecrypt(unwrapRequestId!));
  console.log(`  decrypted: ${pub.value} (expected ${UNWRAP_AMOUNT})`);
  console.log(`  decryptionProof length: ${(pub.decryptionProof.length - 2) / 2} bytes`);
  if (pub.value !== UNWRAP_AMOUNT) {
    throw new Error(`Expected ${UNWRAP_AMOUNT}, got ${pub.value}`);
  }

  log('A4', 'Record sender mUSDC balance pre-finalize');
  const mBalBefore = await publicClient.readContract({
    address: mUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [sender.address],
  });
  console.log(`  mUSDC before: ${mBalBefore}`);

  log('A5', 'finalizeUnwrap with decryptionProof');
  const finalizeHash = await senderWallet.writeContract({
    address: cUSDC, abi: wrapperAbi, functionName: 'finalizeUnwrap',
    args: [unwrapRequestId, pub.decryptionProof],
  });
  await waitTx(publicClient, finalizeHash);
  console.log(`  finalize tx: ${finalizeHash}`);

  log('A6', 'Verify mUSDC balance increased by exactly UNWRAP_AMOUNT');
  const mBalAfter = await publicClient.readContract({
    address: mUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [sender.address],
  });
  console.log(`  mUSDC after:  ${mBalAfter}`);
  const delta = mBalAfter - mBalBefore;
  console.log(`  delta: ${delta}`);
  if (delta !== UNWRAP_AMOUNT) {
    throw new Error(`Expected +${UNWRAP_AMOUNT} mUSDC, got +${delta}`);
  }
  console.log('  ✅ Unwrap complete: cUSDC burnt, mUSDC received');

  // ============================================================
  // TEST B — Selective disclosure (viewers)
  // ============================================================
  console.log('\n═══════════════════ TEST B: VIEWERS ═══════════════════');

  log('B1', 'Read sender current balance handle');
  const handleForObserver = await publicClient.readContract({
    address: cUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [sender.address],
  });
  console.log(`  handle: ${handleForObserver}`);

  log('B2', 'Observer tries to decrypt WITHOUT being a viewer (should fail)');
  let observerBlockedBefore = false;
  try {
    await noxObserver.decrypt(handleForObserver);
  } catch (err) {
    observerBlockedBefore = true;
    console.log(`  ✅ blocked as expected: ${(err as Error).message.slice(0, 100)}`);
  }
  if (!observerBlockedBefore) {
    throw new Error('Observer decrypted without being a viewer — ACL broken');
  }

  log('B3', 'Check isViewer(handle, observer) before addViewer');
  const isViewerBefore = await publicClient.readContract({
    address: NOX_COMPUTE, abi: noxComputeAbi, functionName: 'isViewer',
    args: [handleForObserver, observer.address],
  });
  console.log(`  isViewer: ${isViewerBefore}`);

  log('B4', 'Sender calls addViewer(handle, observer) on NoxCompute');
  const addViewerHash = await senderWallet.writeContract({
    address: NOX_COMPUTE, abi: noxComputeAbi, functionName: 'addViewer',
    args: [handleForObserver, observer.address],
  });
  await waitTx(publicClient, addViewerHash);
  console.log(`  addViewer tx: ${addViewerHash}`);

  log('B5', 'Check isViewer after addViewer');
  const isViewerAfter = await publicClient.readContract({
    address: NOX_COMPUTE, abi: noxComputeAbi, functionName: 'isViewer',
    args: [handleForObserver, observer.address],
  });
  console.log(`  isViewer: ${isViewerAfter}`);
  if (!isViewerAfter) throw new Error('addViewer did not grant access');

  log('B6', "Observer decrypts sender's balance handle via SDK");
  const observerResult = await withRetry('observer.decrypt', () =>
    noxObserver.decrypt(handleForObserver),
  );
  console.log(`  observer-decrypted value: ${observerResult.value}`);
  const { value: senderSelfValue } = await noxSender.decrypt(handleForObserver);
  console.log(`  sender-self-decrypted:   ${senderSelfValue}`);
  if (observerResult.value !== senderSelfValue) {
    throw new Error("Observer's decryption doesn't match sender's");
  }
  console.log('  ✅ Observer saw the same plaintext as the owner');

  console.log('\n✅✅✅  E2E UNWRAP + VIEWERS: ALL PASS  ✅✅✅');
}

main().catch((err) => {
  console.error('\n❌ E2E failed:', err);
  process.exit(1);
});
