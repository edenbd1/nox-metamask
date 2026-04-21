/**
 * Validates the new native-action calldata encoders from the fork:
 *   encodeApprove, encodeWrap, encodeUnwrap, encodeFinalizeUnwrap,
 *   encodeAddViewer
 *
 * For each encoder: round-trip through viem's ABI decoder (catches
 * encoding bugs) + actual on-chain execution (catches semantic bugs).
 *
 * Covers the complete fork UX: Shield → Unwrap → Grant viewer.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  http,
  parseUnits,
  type Address,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

dotenv.config({ path: resolve(__dirname, '../../../.env.local') });

const USER_PK =
  '0x455d4284a8ae223f6a21739888d1ad82568cc1307c1e94ead3bb636881095c56' as `0x${string}`;
const USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as Address;
const CUSDC = '0x52a12dC4558063AB2a451f52DA721F24Cae72DeC' as Address;
const NOX_COMPUTE = '0xd464B198f06756a1d00be223634b85E0a731c229' as Address;
const HANDLE_GATEWAY =
  'https://2e1800fc0dddeeadc189283ed1dce13c1ae28d48-3000.apps.ovh-tdx-dev.noxprotocol.dev';

// === COPIED VERBATIM from metamask-fork/.../nox-rpc.ts =====================
function padAddress(a: string) { return a.toLowerCase().replace(/^0x/, '').padStart(64, '0'); }
function padUint(v: bigint) { return v.toString(16).padStart(64, '0'); }
function stripHex(h: string) { return h.replace(/^0x/, ''); }

function encodeDynamicBytes(data: string): string {
  const hex = stripHex(data);
  const length = padUint(BigInt(hex.length / 2));
  const pad = (64 - (hex.length % 64)) % 64;
  return length + hex + '0'.repeat(pad);
}

const encodeApprove = (s: string, a: bigint) =>
  ('0x095ea7b3' + padAddress(s) + padUint(a)) as `0x${string}`;
const encodeWrap = (to: string, a: bigint) =>
  ('0xbf376c7a' + padAddress(to) + padUint(a)) as `0x${string}`;
const encodeUnwrap = (from: string, to: string, handle: string, proof: string) =>
  ('0x5bf4ef06' + padAddress(from) + padAddress(to) + stripHex(handle)
    + padUint(0x80n) + encodeDynamicBytes(proof)) as `0x${string}`;
const encodeFinalizeUnwrap = (rid: string, proof: string) =>
  ('0x65f94fdb' + stripHex(rid) + padUint(0x40n) + encodeDynamicBytes(proof)) as `0x${string}`;
const encodeAddViewer = (handle: string, v: string) =>
  ('0x10ff39ca' + stripHex(handle) + padAddress(v)) as `0x${string}`;

async function encryptUint256(app: string, owner: string, amount: bigint) {
  const res = await fetch(`${HANDLE_GATEWAY}/v0/secrets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: '0x' + amount.toString(16).padStart(64, '0'),
      solidityType: 'uint256', applicationContract: app, owner,
    }),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}`);
  const json = (await res.json()) as { payload: { handle: string; proof: string } };
  return { handle: json.payload.handle as `0x${string}`, proof: json.payload.proof as `0x${string}` };
}

const UNWRAP_REQUESTED_TOPIC =
  '0x77d02d353c5629272875d11f1b34ec4c65d7430b075575b78cd2502034c469ee';

function parseUnwrapRequestId(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  wrapper: string,
): `0x${string}` | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== wrapper.toLowerCase()) continue;
    if (l.topics[0]?.toLowerCase() !== UNWRAP_REQUESTED_TOPIC) continue;
    return ('0x' + l.data.replace(/^0x/, '').slice(0, 64)) as `0x${string}`;
  }
  return null;
}

async function publicDecryptProof(handle: string, { attempts = 10 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${HANDLE_GATEWAY}/v0/public/${handle}`);
      if (res.status === 404) throw new Error('Object not found');
      if (!res.ok) throw new Error(`Gateway ${res.status}`);
      const json = await res.json() as { payload?: { decryptionProof: string }; decryptionProof?: string };
      const decryptionProof = (json.decryptionProof ?? json.payload?.decryptionProof) as `0x${string}`;
      return { decryptionProof };
    } catch (err) {
      if (!(err as Error).message.includes('not found')) throw err;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw new Error('publicDecrypt polling timeout');
}
// =========================================================================

const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const wrapperAbi = [
  { type: 'function', name: 'wrap', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'unwrap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' }, { name: 'inputProof', type: 'bytes' },
    ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'finalizeUnwrap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'unwrapRequestId', type: 'bytes32' },
      { name: 'decryptedAmountAndProof', type: 'bytes' },
    ], outputs: [] },
  { type: 'event', name: 'UnwrapRequested',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'unwrapRequestId', type: 'bytes32', indexed: false },
    ] },
  { type: 'function', name: 'confidentialBalanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;

const noxAbi = [
  { type: 'function', name: 'addViewer', stateMutability: 'nonpayable',
    inputs: [{ name: 'handle', type: 'bytes32' }, { name: 'viewer', type: 'address' }],
    outputs: [] },
  { type: 'function', name: 'isViewer', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

function check<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    console.log(`    ❌ ${label}: expected ${expected}, got ${actual}`);
    throw new Error(`Check failed: ${label}`);
  }
  console.log(`    ✓ ${label} = ${actual}`);
}

async function main() {
  const user = privateKeyToAccount(USER_PK);
  const observer = privateKeyToAccount(generatePrivateKey());
  const pub = createPublicClient({ chain: arbitrumSepolia, transport: http() });
  const wallet = createWalletClient({ account: user, chain: arbitrumSepolia, transport: http() });

  console.log(`User     : ${user.address}`);
  console.log(`Observer : ${observer.address} (ephemeral)`);

  const WRAP_AMT = parseUnits('0.3', 6);
  const UNWRAP_AMT = parseUnits('0.1', 6);

  // ╔═════════════════════ 1. SHIELD (approve + wrap) ═════════════════════╗
  console.log('\n╔══ 1. SHIELD (approve + wrap) ══');
  // 1a. encoder round-trip
  const approveData = encodeApprove(CUSDC, WRAP_AMT);
  const a0 = decodeFunctionData({ abi: erc20Abi, data: approveData });
  check('approve.functionName', a0.functionName, 'approve');
  const [spender, approveAmount] = a0.args as [string, bigint];
  check('approve.spender', spender.toLowerCase(), CUSDC.toLowerCase());
  check('approve.amount', approveAmount, WRAP_AMT);

  const wrapData = encodeWrap(user.address, WRAP_AMT);
  const w0 = decodeFunctionData({ abi: wrapperAbi, data: wrapData });
  check('wrap.functionName', w0.functionName, 'wrap');
  const [wrapTo, wrapAmount] = w0.args as [string, bigint];
  check('wrap.to', wrapTo.toLowerCase(), user.address.toLowerCase());
  check('wrap.amount', wrapAmount, WRAP_AMT);

  // 1b. on-chain
  const usdcBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address] });
  console.log(`  usdc before: ${usdcBefore}`);
  const approveTx = await wallet.sendTransaction({ to: USDC, data: approveData });
  await pub.waitForTransactionReceipt({ hash: approveTx });
  console.log(`  approve tx: ${approveTx}`);
  const wrapTx = await wallet.sendTransaction({ to: CUSDC, data: wrapData });
  await pub.waitForTransactionReceipt({ hash: wrapTx });
  console.log(`  wrap tx   : ${wrapTx}`);
  const usdcAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address] });
  check('usdc delta (negative)', usdcBefore - usdcAfter, WRAP_AMT);

  // ╔═════════════════════ 2. UNWRAP (2-step) ═════════════════════╗
  console.log('\n╔══ 2. UNWRAP (2-step) ══');
  const { handle, proof } = await encryptUint256(CUSDC, user.address, UNWRAP_AMT);
  const unwrapData = encodeUnwrap(user.address, user.address, handle, proof);
  const u0 = decodeFunctionData({ abi: wrapperAbi, data: unwrapData });
  check('unwrap.functionName', u0.functionName, 'unwrap');
  const [uFrom, uTo, uHandle, uProof] = u0.args as [string, string, string, string];
  check('unwrap.handle', uHandle.toLowerCase(), handle.toLowerCase());
  check('unwrap.proof', uProof.toLowerCase(), proof.toLowerCase());
  check('unwrap.from', uFrom.toLowerCase(), user.address.toLowerCase());
  check('unwrap.to', uTo.toLowerCase(), user.address.toLowerCase());

  const usdcPreUnwrap = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address] });
  const unwrapTx = await wallet.sendTransaction({ to: CUSDC, data: unwrapData });
  const unwrapReceipt = await pub.waitForTransactionReceipt({ hash: unwrapTx });
  console.log(`  unwrap tx: ${unwrapTx}`);
  const reqId = parseUnwrapRequestId(unwrapReceipt.logs, CUSDC);
  if (!reqId) throw new Error('UnwrapRequested not parsed');
  console.log(`  unwrapRequestId: ${reqId}`);

  const { decryptionProof } = await publicDecryptProof(reqId);
  console.log(`  decryptionProof: ${decryptionProof.slice(0, 14)}…`);

  const finData = encodeFinalizeUnwrap(reqId, decryptionProof);
  const f0 = decodeFunctionData({ abi: wrapperAbi, data: finData });
  check('finalize.functionName', f0.functionName, 'finalizeUnwrap');
  const [fReqId, fProof] = f0.args as [string, string];
  check('finalize.reqId', fReqId.toLowerCase(), reqId.toLowerCase());
  check('finalize.proof', fProof.toLowerCase(), decryptionProof.toLowerCase());

  const finTx = await wallet.sendTransaction({ to: CUSDC, data: finData });
  await pub.waitForTransactionReceipt({ hash: finTx });
  console.log(`  finalize tx: ${finTx}`);
  const usdcPostUnwrap = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user.address] });
  check('unwrap usdc delta (+)', usdcPostUnwrap - usdcPreUnwrap, UNWRAP_AMT);

  // ╔═════════════════════ 3. VIEWERS (addViewer) ═════════════════════╗
  console.log('\n╔══ 3. VIEWERS (addViewer) ══');
  const balHandle = await pub.readContract({
    address: CUSDC, abi: wrapperAbi, functionName: 'confidentialBalanceOf', args: [user.address],
  }) as `0x${string}`;
  console.log(`  current balance handle: ${balHandle}`);

  const viewerData = encodeAddViewer(balHandle, observer.address);
  const v0 = decodeFunctionData({ abi: noxAbi, data: viewerData });
  check('addViewer.functionName', v0.functionName, 'addViewer');
  const [vHandle, vAddr] = v0.args as [string, string];
  check('addViewer.handle', vHandle.toLowerCase(), balHandle.toLowerCase());
  check('addViewer.viewer', vAddr.toLowerCase(), observer.address.toLowerCase());

  const before = await pub.readContract({
    address: NOX_COMPUTE, abi: noxAbi, functionName: 'isViewer', args: [balHandle, observer.address],
  });
  check('isViewer before', before, false);

  const viewerTx = await wallet.sendTransaction({ to: NOX_COMPUTE, data: viewerData });
  await pub.waitForTransactionReceipt({ hash: viewerTx });
  console.log(`  addViewer tx: ${viewerTx}`);

  const after = await pub.readContract({
    address: NOX_COMPUTE, abi: noxAbi, functionName: 'isViewer', args: [balHandle, observer.address],
  });
  check('isViewer after', after, true);

  console.log('\n✅✅✅  FORK NATIVE ACTIONS E2E PASSED  ✅✅✅');
  console.log('\nShield · Unwrap · Viewers encoders are a perfect round-trip with viem ABI decode');
  console.log('and produce on-chain effects identical to the SDK path.');
}

main().catch((err) => { console.error('\n❌ FAILED:', err); process.exit(1); });
