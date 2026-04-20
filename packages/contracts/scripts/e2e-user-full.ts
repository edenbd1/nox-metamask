/**
 * Full E2E for the user's wallet (0x91591a…20D) against the
 * Circle-USDC-backed confidential wrapper on Arbitrum Sepolia.
 *
 * Flows covered:
 *   A. Approve + Wrap (Circle USDC → cUSDC)
 *   B. Read + Decrypt confidential balance
 *   C. Confidential transfer to an ephemeral recipient
 *   D. Re-decrypt sender (delta check)
 *   E. Viewer grant + third-party decrypt (selective disclosure)
 *   F. Unwrap: encrypt → burn → publicDecrypt → finalizeUnwrap
 */
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

// Hardcoded user key — testnet only, already compromised in chat history.
const USER_PK =
  '0x455d4284a8ae223f6a21739888d1ad82568cc1307c1e94ead3bb636881095c56' as `0x${string}`;

const RPC =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc';

const USDC = deployments.circle.USDC as Address;
const CUSDC = deployments.circle.cUSDC as Address;
const NOX_COMPUTE = deployments.nox.noxCompute as Address;

const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'string' }] },
] as const;

const erc7984Abi = [
  { type: 'function', name: 'confidentialBalanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'confidentialTransfer', stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes32' }] },
] as const;

const wrapperAbi = [
  ...erc7984Abi,
  { type: 'function', name: 'wrap', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'unwrap', stateMutability: 'nonpayable',
    inputs: [
      { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes' },
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
] as const;

const noxComputeAbi = [
  { type: 'function', name: 'addViewer', stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  { type: 'function', name: 'isViewer', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  { attempts = 8, initialDelayMs = 3000 } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? '';
      const isLag = msg.includes('Object not found') || msg.includes('404');
      if (!isLag) throw err;
      const delay = initialDelayMs * (i + 1);
      console.log(`  [${label}] ingestion lag, retry ${i + 1}/${attempts} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

const log = (step: string, msg: string) => console.log(`\n[${step}] ${msg}`);

async function waitTx(publicClient: ReturnType<typeof createPublicClient>, hash: Hash) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`Tx ${hash} reverted`);
  return r;
}

function fmt(v: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = v / unit;
  const frac = v % unit;
  if (frac === 0n) return `${whole}.0`;
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

async function main() {
  const user = privateKeyToAccount(USER_PK);
  const observer = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey());

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   Nox E2E — User wallet full flow on Arbitrum Sepolia         ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║ User      : ${user.address}     ║`);
  console.log(`║ Recipient : ${recipient.address} (ephemeral)  ║`);
  console.log(`║ Observer  : ${observer.address} (ephemeral)  ║`);
  console.log(`║ USDC      : ${USDC}     ║`);
  console.log(`║ cUSDC     : ${CUSDC}     ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
  const userWallet = createWalletClient({ account: user, chain: arbitrumSepolia, transport: http(RPC) });
  const observerWallet = createWalletClient({ account: observer, chain: arbitrumSepolia, transport: http(RPC) });

  const noxUser = await createViemHandleClient(userWallet);
  const noxObserver = await createViemHandleClient(observerWallet);

  const WRAP_AMOUNT = parseUnits('1', 6);          // 1 USDC
  const SEND_AMOUNT = parseUnits('0.3', 6);        // 0.3 cUSDC
  const UNWRAP_AMOUNT = parseUnits('0.2', 6);      // 0.2 cUSDC back → USDC

  // ============================================================
  // A. APPROVE + WRAP
  // ============================================================
  console.log('\n═══════════════════ A. WRAP 1 USDC ═══════════════════');

  log('A1', 'Check user USDC balance');
  const usdcBal = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address],
  });
  console.log(`  USDC: ${fmt(usdcBal, 6)}`);
  if (usdcBal < WRAP_AMOUNT) throw new Error('Need at least 1 USDC to run');

  log('A2', `Approve cUSDC wrapper for ${fmt(WRAP_AMOUNT, 6)} USDC`);
  const approveHash = await userWallet.writeContract({
    address: USDC, abi: erc20Abi, functionName: 'approve',
    args: [CUSDC, WRAP_AMOUNT],
  });
  await waitTx(publicClient, approveHash);
  console.log(`  tx: ${approveHash}`);

  log('A3', `Wrap ${fmt(WRAP_AMOUNT, 6)} USDC → cUSDC`);
  const wrapHash = await userWallet.writeContract({
    address: CUSDC, abi: wrapperAbi, functionName: 'wrap',
    args: [user.address, WRAP_AMOUNT],
  });
  await waitTx(publicClient, wrapHash);
  console.log(`  tx: ${wrapHash}`);

  // ============================================================
  // B. READ + DECRYPT BALANCE
  // ============================================================
  console.log('\n═══════════════════ B. DECRYPT BALANCE ═══════════════════');

  log('B1', 'Read confidentialBalanceOf handle');
  const handle1 = await publicClient.readContract({
    address: CUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [user.address],
  });
  console.log(`  handle: ${handle1}`);

  log('B2', 'Decrypt via SDK (gasless EIP-712)');
  const { value: bal1 } = await withRetry('decrypt', () => noxUser.decrypt(handle1));
  console.log(`  decrypted: ${fmt(bal1 as bigint, 6)} cUSDC`);
  if ((bal1 as bigint) < WRAP_AMOUNT) throw new Error('Decrypted balance lower than wrapped');

  // ============================================================
  // C. CONFIDENTIAL TRANSFER
  // ============================================================
  console.log('\n═══════════════════ C. CONFIDENTIAL TRANSFER ═══════════════════');

  log('C1', `Encrypt ${fmt(SEND_AMOUNT, 6)} + call confidentialTransfer to recipient`);
  const enc = await noxUser.encryptInput(SEND_AMOUNT, 'uint256', CUSDC);
  console.log(`  encrypted handle: ${enc.handle}`);
  const txHash = await userWallet.writeContract({
    address: CUSDC, abi: erc7984Abi, functionName: 'confidentialTransfer',
    args: [recipient.address, enc.handle, enc.handleProof],
  });
  await waitTx(publicClient, txHash);
  console.log(`  tx: ${txHash}`);

  // ============================================================
  // D. RE-DECRYPT SENDER (verify delta)
  // ============================================================
  console.log('\n═══════════════════ D. VERIFY DELTA ═══════════════════');

  log('D1', 'Read + decrypt new sender balance');
  const handle2 = await publicClient.readContract({
    address: CUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [user.address],
  });
  const { value: bal2 } = await withRetry('decrypt-after', () => noxUser.decrypt(handle2));
  console.log(`  before : ${fmt(bal1 as bigint, 6)} cUSDC`);
  console.log(`  after  : ${fmt(bal2 as bigint, 6)} cUSDC`);
  console.log(`  delta  : -${fmt((bal1 as bigint) - (bal2 as bigint), 6)} cUSDC`);
  if ((bal1 as bigint) - (bal2 as bigint) !== SEND_AMOUNT) {
    throw new Error('Delta mismatch');
  }

  // ============================================================
  // E. SELECTIVE DISCLOSURE (VIEWERS)
  // ============================================================
  console.log('\n═══════════════════ E. SELECTIVE DISCLOSURE ═══════════════════');

  log('E1', 'Observer tries to decrypt handle WITHOUT being a viewer');
  let observerBlocked = false;
  try { await noxObserver.decrypt(handle2); }
  catch (err) {
    observerBlocked = true;
    console.log(`  ✅ blocked: ${(err as Error).message.slice(0, 90)}…`);
  }
  if (!observerBlocked) throw new Error('ACL failed: observer decrypted without grant');

  log('E2', `addViewer(handle, observer=${observer.address.slice(0, 10)}…)`);
  const grantHash = await userWallet.writeContract({
    address: NOX_COMPUTE, abi: noxComputeAbi, functionName: 'addViewer',
    args: [handle2, observer.address],
  });
  await waitTx(publicClient, grantHash);
  console.log(`  tx: ${grantHash}`);

  log('E3', 'Observer now decrypts the same handle');
  const { value: observerView } = await withRetry('observer-decrypt', () =>
    noxObserver.decrypt(handle2),
  );
  console.log(`  observer sees: ${fmt(observerView as bigint, 6)} cUSDC`);
  if (observerView !== bal2) throw new Error('Observer decryption mismatch');

  // ============================================================
  // F. UNWRAP (2-step)
  // ============================================================
  console.log('\n═══════════════════ F. UNWRAP ═══════════════════');

  log('F1', 'USDC balance pre-unwrap');
  const usdcBefore = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address],
  });
  console.log(`  USDC: ${fmt(usdcBefore, 6)}`);

  log('F2', `Encrypt + call unwrap(${fmt(UNWRAP_AMOUNT, 6)})`);
  const encUnwrap = await noxUser.encryptInput(UNWRAP_AMOUNT, 'uint256', CUSDC);
  const unwrapHash = await userWallet.writeContract({
    address: CUSDC, abi: wrapperAbi, functionName: 'unwrap',
    args: [user.address, user.address, encUnwrap.handle, encUnwrap.handleProof],
  });
  const unwrapReceipt = await waitTx(publicClient, unwrapHash);
  console.log(`  tx: ${unwrapHash}`);

  log('F3', 'Parse UnwrapRequested event for unwrapRequestId');
  let unwrapRequestId: `0x${string}` | null = null;
  for (const le of unwrapReceipt.logs) {
    if (le.address.toLowerCase() !== CUSDC.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: wrapperAbi, data: le.data, topics: le.topics });
      if (decoded.eventName === 'UnwrapRequested') {
        unwrapRequestId = (decoded.args as { unwrapRequestId: `0x${string}` }).unwrapRequestId;
        break;
      }
    } catch { /* other events */ }
  }
  if (!unwrapRequestId) throw new Error('UnwrapRequested event not found');
  console.log(`  unwrapRequestId: ${unwrapRequestId}`);

  log('F4', 'publicDecrypt the unwrap handle for the Gateway proof');
  const pub = await withRetry('publicDecrypt', () => noxUser.publicDecrypt(unwrapRequestId!));
  console.log(`  decrypted amount: ${fmt(pub.value as bigint, 6)} (proof ${((pub.decryptionProof.length - 2) / 2)} bytes)`);
  if (pub.value !== UNWRAP_AMOUNT) throw new Error('publicDecrypt value mismatch');

  log('F5', 'finalizeUnwrap(handle, decryptionProof)');
  const finHash = await userWallet.writeContract({
    address: CUSDC, abi: wrapperAbi, functionName: 'finalizeUnwrap',
    args: [unwrapRequestId, pub.decryptionProof],
  });
  await waitTx(publicClient, finHash);
  console.log(`  tx: ${finHash}`);

  log('F6', 'USDC delta check');
  const usdcAfter = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address],
  });
  const delta = usdcAfter - usdcBefore;
  console.log(`  USDC before: ${fmt(usdcBefore, 6)}`);
  console.log(`  USDC after : ${fmt(usdcAfter, 6)}`);
  console.log(`  delta      : +${fmt(delta, 6)}`);
  if (delta !== UNWRAP_AMOUNT) throw new Error(`Expected +${UNWRAP_AMOUNT}, got +${delta}`);

  // ============================================================
  // FINAL STATE
  // ============================================================
  console.log('\n═══════════════════ FINAL STATE ═══════════════════');
  const finalUsdc = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address],
  });
  const finalHandle = await publicClient.readContract({
    address: CUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [user.address],
  });
  const { value: finalC } = await withRetry('final-decrypt', () => noxUser.decrypt(finalHandle));
  console.log(`\n  User USDC : ${fmt(finalUsdc, 6)}`);
  console.log(`  User cUSDC: ${fmt(finalC as bigint, 6)}`);

  console.log('\n✅✅✅  FULL USER E2E PASSED  ✅✅✅');
  console.log('\nCovered: wrap · decrypt · confidential transfer · delta verify ·');
  console.log('         viewer grant · cross-account decrypt · 2-step unwrap');
}

main().catch((err) => {
  console.error('\n❌ E2E failed:', err);
  process.exit(1);
});
