/**
 * Verify the manual hex-encoding used in the MetaMask fork's Shield flow
 * actually produces transactions that the cUSDC wrapper accepts.
 *
 * We do NOT use viem's encodeFunctionData here — we deliberately re-implement
 * encodeApprove + encodeWrap with the SAME logic as
 * metamask-fork/ui/components/app/assets/private-balance-tab/nox-rpc.ts
 * so this script's success directly proves the fork's encoding is correct.
 *
 * Run: pnpm tsx packages/contracts/scripts/verify-fork-wrap.ts
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  toHex,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

import deployments from '../deployments/arbitrumSepolia.json';

dotenv.config({ path: resolve(__dirname, '../../../.env.local') });

// Same hardcoded test key as e2e-user-full.ts (testnet only)
const USER_PK =
  '0x455d4284a8ae223f6a21739888d1ad82568cc1307c1e94ead3bb636881095c56' as `0x${string}`;

const RPC =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc';

const USDC = deployments.circle.USDC as Address;
const CUSDC = deployments.circle.cUSDC as Address;

// Tiny amount so we don't drain the test account.
const WRAP_AMOUNT = 100_000n; // 0.1 USDC (6 decimals)

// =====================================================================
// EXACT COPY of metamask-fork/.../nox-rpc.ts encoding helpers.
// =====================================================================

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}
function padUint(v: bigint): string {
  return v.toString(16).padStart(64, '0');
}

function encodeApprove(spender: string, amount: bigint): `0x${string}` {
  // approve(address,uint256) selector
  return ('0x095ea7b3' + padAddress(spender) + padUint(amount)) as `0x${string}`;
}

function encodeWrap(to: string, amount: bigint): `0x${string}` {
  // wrap(address,uint256) selector — should be keccak256("wrap(address,uint256)").slice(0,4)
  return ('0xbf376c7a' + padAddress(to) + padUint(amount)) as `0x${string}`;
}

// =====================================================================

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const erc7984Abi = [
  {
    type: 'function',
    name: 'confidentialBalanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const;

const log = (step: string, msg: string) => console.log(`\n[${step}] ${msg}`);

async function waitTx(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
  label: string,
) {
  console.log(`  ${label} tx: ${hash}`);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} tx ${hash} reverted`);
  return r;
}

async function main() {
  const user = privateKeyToAccount(USER_PK);
  console.log('User:', user.address);
  console.log('USDC:', USDC);
  console.log('cUSDC wrapper:', CUSDC);

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC),
  });
  const walletClient = createWalletClient({
    account: user,
    chain: arbitrumSepolia,
    transport: http(RPC),
  });

  log('S1', 'Pre-flight: read public USDC balance');
  const usdcBefore = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user.address],
  });
  console.log(`  USDC balance: ${usdcBefore.toString()} (${Number(usdcBefore) / 1e6} USDC)`);
  if (usdcBefore < WRAP_AMOUNT) {
    throw new Error(`Need at least ${WRAP_AMOUNT} USDC; have ${usdcBefore}`);
  }

  log('S2', 'Pre-flight: read encrypted cUSDC handle');
  const handleBefore = (await publicClient.readContract({
    address: CUSDC,
    abi: erc7984Abi,
    functionName: 'confidentialBalanceOf',
    args: [user.address],
  })) as `0x${string}`;
  console.log(`  Handle before: ${handleBefore}`);

  log('S3', 'Encode approve via fork helper');
  const approveData = encodeApprove(CUSDC, WRAP_AMOUNT);
  console.log(`  approve calldata: ${approveData}`);
  console.log(`  length: ${approveData.length} (expect 138 = 2 + 4*2 + 32*2 + 32*2)`);

  log('S4', 'Send approve tx (USDC.approve(CUSDC, amount))');
  const approveHash = await walletClient.sendTransaction({
    to: USDC,
    data: approveData,
    value: 0n,
  });
  await waitTx(publicClient, approveHash, 'approve');

  log('S5', 'Encode wrap via fork helper');
  const wrapData = encodeWrap(user.address, WRAP_AMOUNT);
  console.log(`  wrap calldata: ${wrapData}`);

  log('S6', 'Send wrap tx (CUSDC.wrap(user, amount))');
  const wrapHash = await walletClient.sendTransaction({
    to: CUSDC,
    data: wrapData,
    value: 0n,
  });
  await waitTx(publicClient, wrapHash, 'wrap');

  log('S7', 'Post-flight: verify USDC balance dropped');
  const usdcAfter = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user.address],
  });
  console.log(`  USDC after: ${usdcAfter} (delta: -${usdcBefore - usdcAfter})`);
  if (usdcBefore - usdcAfter !== WRAP_AMOUNT) {
    throw new Error(`USDC delta mismatch: expected -${WRAP_AMOUNT}, got -${usdcBefore - usdcAfter}`);
  }

  log('S8', 'Post-flight: verify cUSDC handle changed');
  const handleAfter = (await publicClient.readContract({
    address: CUSDC,
    abi: erc7984Abi,
    functionName: 'confidentialBalanceOf',
    args: [user.address],
  })) as `0x${string}`;
  console.log(`  Handle after:  ${handleAfter}`);
  if (handleAfter === handleBefore) {
    throw new Error('Handle did not change — wrap likely silently failed');
  }

  console.log('\n✅ Fork-style encoding works end-to-end. Approve + Wrap succeeded.');
  console.log(`   USDC: -${WRAP_AMOUNT} (${Number(WRAP_AMOUNT) / 1e6})`);
  console.log(`   cUSDC handle changed.`);
}

main().catch((err) => {
  console.error('\n❌ FAIL:', err);
  process.exit(1);
});
