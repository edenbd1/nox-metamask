import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import type { HardhatUserConfig } from 'hardhat/config';

dotenv.config({ path: resolve(__dirname, '../../.env.local') });

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const ARB_SEPOLIA_RPC =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    arbitrumSepolia: {
      url: ARB_SEPOLIA_RPC,
      chainId: 421614,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
};

export default config;
