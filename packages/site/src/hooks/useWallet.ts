import { useCallback, useEffect, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { TARGET_CHAIN } from '../config';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export type WalletState = {
  account: Address | null;
  chainId: number | null;
  walletClient: WalletClient | null;
  publicClient: PublicClient;
  connect: () => Promise<void>;
  switchToTargetChain: () => Promise<void>;
};

const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(),
});

export function useWallet(): WalletState {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  const refreshClient = useCallback(async () => {
    if (!window.ethereum) return;
    const client = createWalletClient({
      chain: TARGET_CHAIN,
      transport: custom(window.ethereum),
    });
    setWalletClient(client);
    const [addr] = await client.getAddresses();
    if (addr) setAccount(addr);
    const id = await window.ethereum.request({ method: 'eth_chainId' });
    setChainId(typeof id === 'string' ? parseInt(id, 16) : null);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAccount((accounts?.[0] as Address | undefined) ?? null);
    };
    const handleChain = (...args: unknown[]) => {
      const id = args[0] as string | undefined;
      setChainId(id ? parseInt(id, 16) : null);
    };
    window.ethereum.on?.('accountsChanged', handleAccounts);
    window.ethereum.on?.('chainChanged', handleChain);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccounts);
      window.ethereum?.removeListener?.('chainChanged', handleChain);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error('MetaMask not detected');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    await refreshClient();
  }, [refreshClient]);

  const switchToTargetChain = useCallback(async () => {
    if (!window.ethereum) throw new Error('MetaMask not detected');
    const hex = `0x${TARGET_CHAIN.id.toString(16)}`;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hex }],
      });
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hex,
            chainName: TARGET_CHAIN.name,
            nativeCurrency: TARGET_CHAIN.nativeCurrency,
            rpcUrls: TARGET_CHAIN.rpcUrls.default.http,
            blockExplorerUrls: TARGET_CHAIN.blockExplorers
              ? [TARGET_CHAIN.blockExplorers.default.url]
              : [],
          }],
        });
      } else {
        throw err;
      }
    }
    await refreshClient();
  }, [refreshClient]);

  return { account, chainId, walletClient, publicClient, connect, switchToTargetChain };
}
