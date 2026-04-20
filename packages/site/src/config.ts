import { arbitrumSepolia } from 'viem/chains';

export const TARGET_CHAIN = arbitrumSepolia;

export const SNAP_ORIGIN =
  (import.meta.env.VITE_SNAP_ORIGIN as string | undefined) ??
  'local:http://localhost:8080';

export const SNAP_VERSION =
  (import.meta.env.VITE_SNAP_VERSION as string | undefined) ?? '0.0.1';

export const PRESET_TOKENS = [
  {
    address: '0x8EFfb4926cEE6E7DdB49bB64a8144C151774afd3' as `0x${string}`,
    symbol: 'cUSDC',
    name: 'Confidential USDC (Nox)',
    chainId: 421614,
    underlying: '0xEA6dE69c873129eCfD7cD04C70482a558B922f7E' as `0x${string}`,
  },
] as const;
