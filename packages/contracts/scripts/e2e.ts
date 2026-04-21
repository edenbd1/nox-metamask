import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  createPublicClient,
  createWalletClient,
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

const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] },
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
] as const;

const log = (step: string, msg: string) =>
  console.log(`\n[${step}] ${msg}`);

async function waitTx(publicClient: ReturnType<typeof createPublicClient>, hash: Hash) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`Tx ${hash} failed`);
  return r;
}

async function main() {
  const sender = privateKeyToAccount(PK);
  const recipientPk = generatePrivateKey();
  const recipient = privateKeyToAccount(recipientPk);

  console.log(`Sender:    ${sender.address}`);
  console.log(`Recipient: ${recipient.address} (ephemeral)`);
  console.log(`mUSDC:     ${mUSDC}`);
  console.log(`cUSDC:     ${cUSDC}`);

  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
  const senderWallet = createWalletClient({ account: sender, chain: arbitrumSepolia, transport: http(RPC) });

  const nox = await createViemHandleClient(senderWallet);

  const AMOUNT = parseUnits('100', 6);
  const SEND_AMOUNT = parseUnits('25', 6);

  // ---------- Step 1: check mUSDC balance ----------
  log('1', 'Check mUSDC balance');
  const mBal = await publicClient.readContract({
    address: mUSDC, abi: erc20Abi, functionName: 'balanceOf', args: [sender.address],
  });
  console.log(`mUSDC balance: ${mBal} (need at least ${AMOUNT})`);
  if (mBal < AMOUNT) throw new Error('Insufficient mUSDC');

  // ---------- Step 2: approve wrapper ----------
  log('2', `Approve cUSDC wrapper for ${AMOUNT} mUSDC`);
  const current = await publicClient.readContract({
    address: mUSDC, abi: erc20Abi, functionName: 'allowance',
    args: [sender.address, cUSDC],
  });
  if (current < AMOUNT) {
    const h = await senderWallet.writeContract({
      address: mUSDC, abi: erc20Abi, functionName: 'approve',
      args: [cUSDC, AMOUNT],
    });
    await waitTx(publicClient, h);
    console.log(`  approve tx: ${h}`);
  } else {
    console.log('  already approved');
  }

  // ---------- Step 3: wrap ----------
  log('3', `Wrap ${AMOUNT} mUSDC into cUSDC`);
  const wrapHash = await senderWallet.writeContract({
    address: cUSDC, abi: wrapperAbi, functionName: 'wrap',
    args: [sender.address, AMOUNT],
  });
  await waitTx(publicClient, wrapHash);
  console.log(`  wrap tx: ${wrapHash}`);

  // ---------- Step 4: read balance handle & decrypt ----------
  log('4', 'Read sender encrypted balance handle and decrypt');
  const senderHandle = await publicClient.readContract({
    address: cUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [sender.address],
  });
  console.log(`  handle: ${senderHandle}`);
  const { value: senderPlain, solidityType } = await nox.decrypt(senderHandle);
  console.log(`  decrypted: ${senderPlain} (${solidityType})`);
  // Sender has accumulated balance from prior E2E runs — require at least
  // what we just wrapped, not an exact match.
  if (senderPlain < AMOUNT) {
    throw new Error(`Expected at least ${AMOUNT}, got ${senderPlain}`);
  }

  // ---------- Step 5: confidential transfer ----------
  log('5', `Confidential transfer ${SEND_AMOUNT} cUSDC to recipient`);
  const enc = await nox.encryptInput(SEND_AMOUNT, 'uint256', cUSDC);
  console.log(`  encrypted handle: ${enc.handle}`);
  const transferHash = await senderWallet.writeContract({
    address: cUSDC, abi: erc7984Abi, functionName: 'confidentialTransfer',
    args: [recipient.address, enc.handle, enc.handleProof],
  });
  await waitTx(publicClient, transferHash);
  console.log(`  transfer tx: ${transferHash}`);

  // ---------- Step 6: verify sender's new balance ----------
  log('6', 'Re-decrypt sender balance (expect original - sent)');
  const senderHandle2 = await publicClient.readContract({
    address: cUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [sender.address],
  });
  console.log(`  new handle: ${senderHandle2}`);
  const { value: senderPlain2 } = await nox.decrypt(senderHandle2);
  console.log(`  decrypted: ${senderPlain2}`);
  const delta = (senderPlain as bigint) - (senderPlain2 as bigint);
  if (delta !== SEND_AMOUNT) {
    throw new Error(`Expected delta of ${SEND_AMOUNT}, got ${delta}`);
  }

  // ---------- Step 7: verify recipient balance handle ----------
  log('7', 'Check recipient has a non-zero encrypted balance handle');
  const recipientHandle = await publicClient.readContract({
    address: cUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf',
    args: [recipient.address],
  });
  console.log(`  recipient handle: ${recipientHandle}`);
  const isZero = /^0x0+$/.test(recipientHandle);
  if (isZero) {
    throw new Error('Recipient handle is zero — transfer did not credit them');
  }

  console.log('\n✅ E2E passed: wrap → confidential balance → confidential transfer → balance delta.');
}

main().catch((err) => {
  console.error('\n❌ E2E failed:', err);
  process.exit(1);
});
