/**
 * Replicates EXACTLY the nox-client.ts decrypt flow from the MetaMask fork,
 * but signs with a local private key instead of the noxSignTypedDataV4 UI
 * bridge. If this passes, the crypto/HTTP pipeline in the fork is correct
 * and any remaining bug is React/side-panel specific.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: resolve(__dirname, '../../../.env.local') });

// === COPIED VERBATIM from metamask-fork/ui/.../nox-client.ts ============
const HANDLE_GATEWAY =
  'https://2e1800fc0dddeeadc189283ed1dce13c1ae28d48-3000.apps.ovh-tdx-dev.noxprotocol.dev';
const NOX_COMPUTE = '0xd464B198f06756a1d00be223634b85E0a731c229';
const CHAIN_ID = 421614;

const DERIVATION_INFO = new Uint8Array([
  0x45, 0x43, 0x49, 0x45, 0x53, 0x3a, 0x41, 0x45, 0x53, 0x5f, 0x47, 0x43, 0x4d,
  0x3a, 0x76, 0x31,
]); // "ECIES:AES_GCM:v1"

function bytesToHex(bytes: Uint8Array): string {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function buildTypedData(userAddress: string, encryptionPubKey: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      DataAccessAuthorization: [
        { name: 'userAddress', type: 'address' },
        { name: 'encryptionPubKey', type: 'string' },
        { name: 'notBefore', type: 'uint256' },
        { name: 'expiresAt', type: 'uint256' },
      ],
    },
    domain: {
      name: 'Handle Gateway',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: NOX_COMPUTE,
    },
    primaryType: 'DataAccessAuthorization',
    message: {
      userAddress,
      encryptionPubKey,
      notBefore: now,
      expiresAt: now + 3600,
    },
  };
}

function buildAuthorizationHeader(
  userAddress: string,
  encryptionPubKey: string,
  signature: string,
  messageNotBefore: number,
  messageExpiresAt: number,
): string {
  const payload = {
    userAddress,
    encryptionPubKey,
    notBefore: messageNotBefore,
    expiresAt: messageExpiresAt,
  };
  return `EIP712 ${Buffer.from(
    JSON.stringify({ payload, signature }),
  ).toString('base64')}`;
}

async function generateEphemeralKeyPair() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([0x01, 0x00, 0x01]), hash: 'SHA-256' },
    true,
    ['decrypt'],
  )) as CryptoKeyPair;
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return { publicKeyHex: bytesToHex(new Uint8Array(spki)), privateKey: keyPair.privateKey };
}

async function fetchCipher(handle: string, authHeader: string) {
  const res = await fetch(`${HANDLE_GATEWAY}/v0/secrets/${handle}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gateway ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    payload: {
      handle: string;
      ciphertext: string;
      iv: string;
      encryptedSharedSecret: string;
    };
    signature: string;
  };
  console.log('    [payload keys]', Object.keys(json.payload));
  console.log('    [iv]           ', json.payload.iv);
  return {
    ciphertext: hexToBytes(json.payload.ciphertext),
    iv: hexToBytes(json.payload.iv),
    encryptedSharedSecret: hexToBytes(json.payload.encryptedSharedSecret),
  };
}

async function eciesDecrypt(
  encryptedSharedSecret: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  rsaPrivate: CryptoKey,
): Promise<Uint8Array> {
  const sharedSecretBuf = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaPrivate, encryptedSharedSecret);
  const keyMaterial = await crypto.subtle.importKey('raw', new Uint8Array(sharedSecretBuf), 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: DERIVATION_INFO },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    ciphertext,
  );
  return new Uint8Array(plainBuf);
}

function decodePlaintext(handleHex: string, plain: Uint8Array): bigint {
  // Handle layout per Nox SDK:
  //   byte 0     version
  //   bytes 1-4  chainId (big-endian uint32)
  //   byte 5     type code (SOLIDITY_TYPES index — uint256 = 35)
  //   byte 6     attribute
  const bytes = hexToBytes(handleHex);
  const typeCode = bytes[5];
  // Supported: uintN (4..35) and intN (36..67)
  if (typeCode < 4 || typeCode > 67) throw new Error(`Unsupported type code ${typeCode}`);
  let value = 0n;
  for (const b of plain) value = (value << 8n) + BigInt(b);
  return value;
}
// === END COPIED SECTION ==============================================

async function main() {
  const USER_PK =
    '0x455d4284a8ae223f6a21739888d1ad82568cc1307c1e94ead3bb636881095c56' as `0x${string}`;
  // Handle = confidentialBalanceOf(0x91591a...) on our Nox-demo cUSDC wrapper
  const HANDLE =
    '0x0000066eee230108b64e864e7db4c8e1a09f6b2af3c1b19d7f12109550d2f50b';

  const user = privateKeyToAccount(USER_PK);
  console.log(`User       : ${user.address}`);
  console.log(`Handle     : ${HANDLE}`);
  console.log(`Gateway    : ${HANDLE_GATEWAY}`);

  console.log('\n[1] Generate ephemeral RSA key');
  const { publicKeyHex, privateKey } = await generateEphemeralKeyPair();
  console.log(`    pubkey bytes: ${(publicKeyHex.length - 2) / 2}`);

  console.log('\n[2] Build EIP-712 typed data');
  const typedData = buildTypedData(user.address, publicKeyHex);
  const { notBefore, expiresAt } = typedData.message;
  console.log(`    notBefore=${notBefore}, expiresAt=${expiresAt} (span=${expiresAt - notBefore}s)`);

  console.log('\n[3] Sign typed data with local key (sim MetaMask popup)');
  const signature = await user.signTypedData({
    domain: typedData.domain,
    types: {
      DataAccessAuthorization: typedData.types.DataAccessAuthorization,
    },
    primaryType: 'DataAccessAuthorization',
    message: typedData.message,
  });
  console.log(`    signature: ${signature.slice(0, 20)}… (${(signature.length - 2) / 2} bytes)`);

  console.log('\n[4] Build Authorization header');
  const authHeader = buildAuthorizationHeader(
    user.address,
    publicKeyHex,
    signature,
    notBefore,
    expiresAt,
  );
  console.log(`    header: ${authHeader.slice(0, 40)}… (${authHeader.length} chars)`);

  console.log('\n[5] GET gateway secrets');
  const cipher = await fetchCipher(HANDLE, authHeader);
  console.log(`    ciphertext: ${cipher.ciphertext.length} bytes`);
  console.log(`    iv        : ${cipher.iv.length} bytes`);
  console.log(`    encSecret : ${cipher.encryptedSharedSecret.length} bytes`);

  console.log('\n[6] ECIES decrypt');
  const plain = await eciesDecrypt(
    cipher.encryptedSharedSecret,
    cipher.iv,
    cipher.ciphertext,
    privateKey,
  );
  console.log(`    plain bytes: ${plain.length}`);

  console.log('\n[7] Decode by handle type');
  const value = decodePlaintext(HANDLE, plain);
  console.log(`    decoded: ${value}`);

  const decimals = 6;
  const fmt = (v: bigint, d: number) => {
    const unit = 10n ** BigInt(d);
    const whole = v / unit;
    const frac = v % unit;
    if (frac === 0n) return `${whole}`;
    return `${whole}.${frac.toString().padStart(d, '0').replace(/0+$/, '')}`;
  };
  console.log(`    formatted: ${fmt(value, decimals)} cUSDC`);

  console.log('\n✅ Fork decrypt flow validated end-to-end');
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err);
  if (err.cause) console.error('cause:', err.cause);
  process.exit(1);
});
