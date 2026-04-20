# MetaMask fork patches

Patches that add a native **Private balance** tab to the MetaMask extension for Nox confidential tokens (ERC-7984). Same UX as chriswilder.eth's unofficial build, adapted for iExec's Nox protocol on Arbitrum Sepolia.

## How to apply

```bash
git clone https://github.com/MetaMask/metamask-extension.git metamask-fork
cd metamask-fork
git checkout v13.29.0           # pin to the version we patched against
git apply ../metamask-patches/01-private-balance-tab.patch
corepack enable
yarn install
yarn start                       # dev build — outputs to dist/
```

Then in Chrome: `chrome://extensions` → "Load unpacked" → select `metamask-fork/dist/chrome`.

## Patches

### `01-private-balance-tab.patch`

Adds the **Private balance** tab between Tokens and Perps on the main account overview. It's a fully native cToken experience:

- **Live handle reads** from Arbitrum Sepolia via direct `confidentialBalanceOf` eth_call
- **Native decryption** — click "Decrypt" on a card (or "Decrypt all") and MetaMask pops an EIP-712 signature prompt; once signed, the plaintext amount is fetched from the Nox Handle Gateway, decrypted client-side via Web Crypto (RSA-OAEP + HKDF-SHA-256 + AES-256-GCM), and displayed inline — **no external dApp, no extra tab**
- **Send / Shield** deep-link to the companion Nox app (`http://localhost:5180`) with token + handle pre-filled, because those flows additionally need `encryptInput` round-trips and tx approval dialogs we haven't natively wired yet

Files touched:
- `shared/constants/app-state.ts` — new `PrivateBalance` enum entry
- `ui/components/multichain/account-overview/account-overview-tabs.tsx` — import + render the tab
- `ui/components/multichain/account-overview/account-overview-eth.tsx` — `showPrivateBalance={true}`
- `app/scripts/metamask-controller.js` — new `noxSignTypedDataV4` API method bridging `SignatureController.newUnsignedTypedMessage` for UI-originated typed-data signing
- `ui/store/actions.ts` — matching `noxSignTypedDataV4` UI action
- `ui/components/app/assets/private-balance-tab/private-balance-tab.tsx` — tab component
- `ui/components/app/assets/private-balance-tab/nox-rpc.ts` — direct-RPC handle reader + deep-link helpers
- `ui/components/app/assets/private-balance-tab/nox-client.ts` — self-contained Handle Gateway client (EIP-712 payload builder + RSA keygen + fetch + ECIES decrypt) using Web Crypto API
- `ui/components/app/assets/private-balance-tab/index.ts` — barrel export

### Architectural note

The `noxSignTypedDataV4` bridge we added is the minimum surface a Snap API would need to expose to let a Snap do the same thing without forking MetaMask. Today, typed-data signing from the wallet's own UI is not exposed as a `submitRequestToBackground` endpoint — dApps route through the provider engine but in-wallet tabs have no equivalent. Our patch calls `SignatureController.newUnsignedTypedMessage` directly with `origin: 'metamask'`, producing a native confirmation dialog. Productizing this means either:

1. MetaMask exposes `noxSignTypedDataV4`-equivalent as a generic action for Snap-served home pages to use
2. MetaMask ships an "Asset Snap" API so our Snap can contribute rows to the Tokens list, the same way non-EVM asset snaps do for Bitcoin/Solana

### Next patches (possible)

- `02-native-tx-dispatch.patch` — Send / Shield / Unwrap via `submitRequestToBackground('addTransaction', ...)` (replaces the Send/Shield deep-link fallback)
- `03-unwrap-flow.patch` — 2-step unwrap with `publicDecrypt` + `finalizeUnwrap` in-wallet
