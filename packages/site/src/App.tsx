import { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { useNox } from './hooks/useNox';
import { useSnap } from './hooks/useSnap';
import { TokenList } from './components/TokenList';
import { AddToken } from './components/AddToken';
import { Send } from './components/Send';
import { Wrap } from './components/Wrap';
import { Unwrap } from './components/Unwrap';
import { TARGET_CHAIN } from './config';

type Tab = 'tokens' | 'send' | 'wrap' | 'unwrap';

export function App() {
  const wallet = useWallet();
  const { client: noxClient } = useNox(wallet.walletClient);
  const snap = useSnap();
  const [tab, setTab] = useState<Tab>('tokens');

  const onWrongChain = wallet.chainId !== null && wallet.chainId !== TARGET_CHAIN.id;

  if (!wallet.account) {
    return (
      <main className="container">
        <header>
          <h1>Nox · MetaMask</h1>
          <p className="muted">Confidential ERC-7984 tokens, natively inside MetaMask.</p>
        </header>
        <button onClick={() => void wallet.connect()}>Connect MetaMask</button>
      </main>
    );
  }

  return (
    <main className="container">
      <header>
        <h1>Nox · MetaMask</h1>
        <div className="row wrap">
          <span className="chip mono">{wallet.account}</span>
          <span className="chip">chain {wallet.chainId}</span>
          {!snap.installed && (
            <button className="ghost" onClick={() => void snap.install()}>
              Install Nox Snap
            </button>
          )}
          {snap.installed && <span className="chip ok">Snap installed</span>}
        </div>
      </header>

      {onWrongChain && (
        <div className="warn">
          Wrong network. <button onClick={() => void wallet.switchToTargetChain()}>
            Switch to {TARGET_CHAIN.name}
          </button>
        </div>
      )}

      <nav className="tabs">
        <button className={tab === 'tokens' ? 'active' : ''} onClick={() => setTab('tokens')}>Tokens</button>
        <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}>Send</button>
        <button className={tab === 'wrap' ? 'active' : ''} onClick={() => setTab('wrap')}>Wrap</button>
        <button className={tab === 'unwrap' ? 'active' : ''} onClick={() => setTab('unwrap')}>Unwrap</button>
      </nav>

      {tab === 'tokens' && (
        <div className="stack">
          <AddToken publicClient={wallet.publicClient} onAdd={snap.addToken} />
          <TokenList
            tokens={snap.tokens}
            account={wallet.account}
            publicClient={wallet.publicClient}
            noxClient={noxClient}
            onRemove={snap.removeToken}
          />
        </div>
      )}
      {tab === 'send' && wallet.walletClient && (
        <Send
          tokens={snap.tokens}
          account={wallet.account}
          walletClient={wallet.walletClient}
          noxClient={noxClient}
        />
      )}
      {tab === 'wrap' && wallet.walletClient && (
        <Wrap account={wallet.account} publicClient={wallet.publicClient} walletClient={wallet.walletClient} />
      )}
      {tab === 'unwrap' && wallet.walletClient && (
        <Unwrap account={wallet.account} walletClient={wallet.walletClient} noxClient={noxClient} />
      )}
    </main>
  );
}
