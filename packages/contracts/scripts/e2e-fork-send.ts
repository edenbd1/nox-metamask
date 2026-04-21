/**
 * Replicates the native Send flow from the MetaMask fork cTokens tab.
 * Validates that:
 *   1. encryptUint256 HTTP call to the Nox gateway succeeds
 *   2. The manually-encoded confidentialTransfer calldata is valid ABI
 *   3. The tx lands on-chain and the recipient's balance handle changes
 *
 * If this passes, the fork's Send button will work identically once the
 * user approves in the MM confirmation popup.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  createPublicClient,
  createWalletClient,
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
const CUSDC = '0x52a12dC4558063AB2a451f52DA721F24Cae72DeC' as Address;
const HANDLE_GATEWAY =
  'https://2e1800fc0dddeeadc189283ed1dce13c1ae28d48-3000.apps.ovh-tdx-dev.noxprotocol.dev';

// === COPIED VERBATIM from metamask-fork/.../nox-rpc.ts ==================
async function encryptUint256(
  applicationContract: string,
  owner: string,
  amount: bigint,
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const valueHex = '0x' + amount.toString(16).padStart(64, '0');
  const res = await fetch(`${HANDLE_GATEWAY}/v0/secrets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      value: valueHex,
      solidityType: 'uint256',
      applicationContract,
      owner,
    }),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const text = await res.text();
  console.log('    [raw response]', text.slice(0, 300));
  const json = JSON.parse(text);
  console.log('    [top-level keys]', Object.keys(json));
  return {
    handle: (json.handle ?? json.payload?.handle) as `0x${string}`,
    proof: (json.proof ?? json.payload?.proof) as `0x${string}`,
  };
}

function padAddress(addr: string): string { return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0'); }
function padUint(v: bigint): string { return v.toString(16).padStart(64, '0'); }
function stripHex(h: string): string { return h.replace(/^0x/, ''); }

function encodeConfidentialTransfer(
  to: string,
  handle: string,
  inputProof: string,
): `0x${string}` {
  const proofHex = stripHex(inputProof);
  const proofBytes = proofHex.length / 2;
  const lengthHex = padUint(BigInt(proofBytes));
  const padCount = (64 - (proofHex.length % 64)) % 64;
  const paddedProof = proofHex + '0'.repeat(padCount);
  return (
    '0x2fb74e62' +
    padAddress(to) +
    stripHex(handle) +
    padUint(0x60n) +
    lengthHex +
    paddedProof
  ) as `0x${string}`;
}
// ========================================================================

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

async function main() {
  const sender = privateKeyToAccount(USER_PK);
  const recipient = privateKeyToAccount(generatePrivateKey());
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http() });
  const walletClient = createWalletClient({ account: sender, chain: arbitrumSepolia, transport: http() });

  console.log(`Sender    : ${sender.address}`);
  console.log(`Recipient : ${recipient.address} (ephemeral)`);
  console.log(`cUSDC     : ${CUSDC}`);

  const AMOUNT = parseUnits('0.1', 6);  // 0.1 cUSDC

  // ---------- STEP 1: encryptUint256 via gateway ----------
  console.log('\n[1] encryptUint256 via gateway');
  const { handle, proof } = await encryptUint256(CUSDC, sender.address, AMOUNT);
  console.log(`    handle: ${handle}`);
  console.log(`    proof : ${proof.slice(0, 20)}… (${(proof.length - 2) / 2} bytes)`);

  // ---------- STEP 2: encode calldata ----------
  console.log('\n[2] encode confidentialTransfer calldata (manual)');
  const calldata = encodeConfidentialTransfer(recipient.address, handle, proof);
  console.log(`    calldata length: ${(calldata.length - 2) / 2} bytes`);
  console.log(`    selector       : ${calldata.slice(0, 10)}`);

  // ---------- STEP 3: round-trip check — decode via viem ----------
  console.log('\n[3] round-trip ABI decode with viem');
  const decoded = decodeFunctionData({ abi: erc7984Abi, data: calldata });
  console.log(`    function: ${decoded.functionName}`);
  console.log(`    args    :`, decoded.args);
  if (decoded.functionName !== 'confidentialTransfer') {
    throw new Error('Decoded to wrong function');
  }
  const [decTo, decHandle, decProof] = decoded.args as [string, string, string];
  if (decTo.toLowerCase() !== recipient.address.toLowerCase()) throw new Error('to mismatch');
  if (decHandle.toLowerCase() !== handle.toLowerCase()) throw new Error('handle mismatch');
  if (decProof.toLowerCase() !== proof.toLowerCase()) throw new Error('proof mismatch');
  console.log('    ✅ encoder is a perfect round-trip');

  // ---------- STEP 4: recipient's pre-tx balance handle ----------
  const preHandle = await publicClient.readContract({
    address: CUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf', args: [recipient.address],
  });
  console.log(`\n[4] recipient pre-tx handle: ${preHandle}`);

  // ---------- STEP 5: send raw tx (simulating addTransaction approval) ----------
  console.log('\n[5] send raw tx (simulates user approving in MM popup)');
  const hash = await walletClient.sendTransaction({
    to: CUSDC,
    data: calldata,
    value: 0n,
  });
  console.log(`    tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Tx reverted');
  console.log(`    ✅ tx status: success (block ${receipt.blockNumber})`);

  // ---------- STEP 6: verify recipient got a balance ----------
  const postHandle = await publicClient.readContract({
    address: CUSDC, abi: erc7984Abi, functionName: 'confidentialBalanceOf', args: [recipient.address],
  });
  console.log(`\n[6] recipient post-tx handle: ${postHandle}`);
  if (postHandle === preHandle) {
    throw new Error('Recipient handle did not change — transfer failed silently');
  }
  if (/^0x0+$/.test(postHandle)) {
    throw new Error('Recipient handle is still zero');
  }
  console.log('    ✅ recipient handle changed — transfer landed');

  console.log('\n✅✅✅ NATIVE SEND FLOW VALIDATED END-TO-END ✅✅✅');
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err);
  process.exit(1);
});
