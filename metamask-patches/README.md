# MetaMask fork patches

Patches that add a native **Private balance** tab to the MetaMask extension for Nox confidential tokens (ERC-7984). Same UX as chriswilder.eth's unofficial build, adapted for iExec's Nox protocol on Arbitrum Sepolia.

## How to apply

```bash
git clone https://github.com/MetaMask/metamask-extension.git metamask-fork
cd metamask-fork
git checkout v13.29.0           # pin to the version we patched against
git apply ../metamask-patches/01-private-balance-tab-skeleton.patch
corepack enable
yarn install
yarn start                       # dev build — outputs to dist/
```

Then in Chrome: `chrome://extensions` → "Load unpacked" → select `metamask-fork/dist/chrome`.

## Patches

### `01-private-balance-tab-skeleton.patch`
Adds the `Private balance` tab between `Tokens` and `Perps` on the main account overview. Renders a hardcoded cUSDC card (Circle-backed wrapper on Arbitrum Sepolia) with mock "Decrypt / Send / Shield" buttons — visual skeleton only, not wired to the Nox SDK yet.

Files touched:
- `shared/constants/app-state.ts` — new `PrivateBalance` enum entry
- `ui/components/multichain/account-overview/account-overview-tabs.tsx` — import + render the tab
- `ui/components/multichain/account-overview/account-overview-eth.tsx` — `showPrivateBalance={true}`
- `ui/components/app/assets/private-balance-tab/` — new tab component

### Next patches (planned)

- `02-nox-sdk-integration.patch` — wire `@iexec-nox/handle` for real balance reads + gasless decryption via EIP-712
- `03-send-shield-flows.patch` — functional `Send` (confidentialTransfer) and `Shield` (wrap ERC-20 → ERC-7984)
- `04-unwrap-flow.patch` — 2-step unwrap with `publicDecrypt` + `finalizeUnwrap`
