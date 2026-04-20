import { arbitrumSepolia } from 'viem/chains';

export const TARGET_CHAIN = arbitrumSepolia;

const DEFAULT_SNAP_ORIGIN = import.meta.env.DEV
  ? 'local:http://localhost:8080'
  : 'npm:@iexec-nox/metamask-snap';

export const SNAP_ORIGIN =
  (import.meta.env.VITE_SNAP_ORIGIN as string | undefined) ?? DEFAULT_SNAP_ORIGIN;

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

export const NOX_COMPUTE: `0x${string}` =
  '0xd464B198f06756a1d00be223634b85E0a731c229';
