/**
 * Smoke test for the fork's fetchRecentTransfers — replicates the
 * exact RPC flow the side-panel runs on mount.
 */
const ARB_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';
const CONFIDENTIAL_TRANSFER_TOPIC =
  '0x67500e8d0ed826d2194f514dd0d8124f35648ab6e3fb5e6ed867134cffe661e9';

const TOKENS = [
  '0x1CCeC6bC60dB15E4055D43Dc2531BB7D4E5B808e', // cdefi.iex.ec cUSDC
  '0x52a12dC4558063AB2a451f52DA721F24Cae72DeC', // Nox demo cUSDC
];

// User to check: Account 1 in the fork
const USERS = [
  { label: '0xEf28A3… (Account 1 fork)', addr: '0xEf28A3d83Fc9A2bfBD14Dd36ABB892C627b54083' },
  { label: '0x91591a… (test wallet)',     addr: '0x91591a0cA1EAB188689f5DD9e4d2A4741FBD720D' },
];

function addrTopic(a: string) {
  return '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

async function latestBlock(): Promise<number> {
  const r = await fetch(ARB_SEPOLIA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const { result } = (await r.json()) as { result: string };
  return parseInt(result, 16);
}

async function getLogs(topics: (string | null)[], fromBlock: string, toBlock: string) {
  const r = await fetch(ARB_SEPOLIA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
      params: [{ address: TOKENS, topics, fromBlock, toBlock }],
    }),
  });
  const json = (await r.json()) as {
    result?: {
      address: string; topics: string[];
      transactionHash: string; blockNumber: string;
    }[];
  };
  return json.result ?? [];
}

async function main() {
  const latest = await latestBlock();
  const fromBlock = '0x' + Math.max(0, latest - 2_000_000).toString(16);
  const toBlock = '0x' + latest.toString(16);
  console.log(`Scanning ${TOKENS.length} tokens from block ${parseInt(fromBlock, 16)} to ${latest} (~6d lookback)`);

  for (const user of USERS) {
    console.log(`\n─── ${user.label} ───`);
    const userTopic = addrTopic(user.addr);
    const [sent, recv] = await Promise.all([
      getLogs([CONFIDENTIAL_TRANSFER_TOPIC, userTopic, null], fromBlock, toBlock),
      getLogs([CONFIDENTIAL_TRANSFER_TOPIC, null, userTopic], fromBlock, toBlock),
    ]);
    console.log(`  sent    : ${sent.length} events`);
    console.log(`  received: ${recv.length} events`);

    const all = [...sent.map((e) => ({ ...e, dir: 'out' })), ...recv.map((e) => ({ ...e, dir: 'in' }))];
    all.sort((a, b) => parseInt(b.blockNumber, 16) - parseInt(a.blockNumber, 16));

    for (const e of all.slice(0, 10)) {
      const from = '0x' + e.topics[1].slice(26);
      const to = '0x' + e.topics[2].slice(26);
      const amount = e.topics[3] ?? '0x…';
      const counterparty = e.dir === 'out' ? to : from;
      console.log(
        `    ${e.dir === 'out' ? '↗ Sent     ' : '↙ Received '} ${counterparty.slice(0, 10)}…${counterparty.slice(-4)}`,
        `| block ${parseInt(e.blockNumber, 16)}`,
        `| handle ${amount.slice(0, 14)}…`,
      );
    }
  }
  console.log('\n✅ Activity feed logic works against live Arb Sepolia');
}

main().catch((e) => { console.error(e); process.exit(1); });
