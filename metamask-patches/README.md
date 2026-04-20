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
Adds the `Private balance` tab between `Tokens` and `Perps` on the main account overview. Reads real balance handles from Arbitrum Sepolia (live `confidentialBalanceOf` call) and renders one card per tracked ERC-7984 token (currently hardcoded to cUSDC wrapping Circle's USDC at `0x75faf1…AA4d`). Decrypt / Send / Shield buttons deep-link to the Nox companion app (`http://localhost:5180`) with the token address and balance handle pre-filled; the companion app runs the gasless EIP-712 decryption and the confidential transfer / wrap flows against the real contracts.

Files touched:
- `shared/constants/app-state.ts` — new `PrivateBalance` enum entry
- `ui/components/multichain/account-overview/account-overview-tabs.tsx` — import + render the tab
- `ui/components/multichain/account-overview/account-overview-eth.tsx` — `showPrivateBalance={true}`
- `ui/components/app/assets/private-balance-tab/private-balance-tab.tsx` — tab component
- `ui/components/app/assets/private-balance-tab/nox-rpc.ts` — direct-RPC handle reader + deep-link helpers
- `ui/components/app/assets/private-balance-tab/index.ts` — barrel export

### Architectural notes

**Why deep-link to the companion app for Decrypt/Send/Shield instead of native in-MetaMask signing?**

Decryption is a gasless EIP-712 signature against the Handle Gateway; user-initiated typed-data signing from MetaMask's own UI is not currently exposed as a UI-store action (`ui/store/actions.ts` covers transactions but not arbitrary signatures). Reaching `SignatureController.newUnsignedTypedMessage` from the wallet UI requires a new background bridge. This fork demonstrates the **UX pattern** (native tab, per-token reveal, shield/send) while keeping the signing flow in the companion app where `window.ethereum` is available naturally. The MetaMask Snaps API would be the right long-term home for native wallet-initiated confidential-token flows (see our Snap at `packages/snap/`, `@iexec-nox/metamask-snap`).

### Next patches (possible)

- `02-native-signing.patch` — bridge `KeyringController.signTypedMessage` into `ui/store/actions.ts` to do EIP-712 sign-in-wallet
- `03-native-tx-dispatch.patch` — Send / Shield / Unwrap via `submitRequestToBackground('addTransaction', ...)` (replaces the deep-link fallback)
- `04-unwrap-flow.patch` — 2-step unwrap with `publicDecrypt` + `finalizeUnwrap`
