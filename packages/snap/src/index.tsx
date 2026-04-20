import type {
  OnRpcRequestHandler,
  OnHomePageHandler,
} from '@metamask/snaps-sdk';
import {
  Box,
  Heading,
  Text,
  Bold,
  Divider,
  Row,
  Address,
  Link,
  Button,
} from '@metamask/snaps-sdk/jsx';

import { loadState, saveState, type TrackedToken } from './state';

const isHexAddress = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value);

export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  switch (request.method) {
    case 'nox_listTokens': {
      const state = await loadState();
      return state.tokens;
    }

    case 'nox_addToken': {
      const params = request.params as
        | { address?: unknown; symbol?: unknown; name?: unknown; chainId?: unknown }
        | undefined;
      if (!params || !isHexAddress(params.address)) {
        throw new Error('nox_addToken: invalid or missing "address"');
      }
      const state = await loadState();
      const address = params.address.toLowerCase() as `0x${string}`;
      if (state.tokens.some((t) => t.address === address)) {
        return state.tokens;
      }
      const token: TrackedToken = {
        address,
        symbol: typeof params.symbol === 'string' ? params.symbol : 'cTKN',
        name: typeof params.name === 'string' ? params.name : 'Confidential Token',
        chainId: typeof params.chainId === 'number' ? params.chainId : 421614,
        addedAt: Date.now(),
      };
      state.tokens.push(token);
      await saveState(state);
      return state.tokens;
    }

    case 'nox_removeToken': {
      const params = request.params as { address?: unknown } | undefined;
      if (!params || !isHexAddress(params.address)) {
        throw new Error('nox_removeToken: invalid or missing "address"');
      }
      const state = await loadState();
      const target = params.address.toLowerCase();
      state.tokens = state.tokens.filter((t) => t.address !== target);
      await saveState(state);
      return state.tokens;
    }

    default:
      throw new Error(`Method not found: ${request.method}`);
  }
};

export const onHomePage: OnHomePageHandler = async () => {
  const state = await loadState();

  if (state.tokens.length === 0) {
    return {
      content: (
        <Box>
          <Heading>Nox Confidential Tokens</Heading>
          <Text>
            No confidential tokens tracked yet. Visit the Nox companion app to
            wrap ERC-20s, send confidential transfers, and manage your cTokens.
          </Text>
          <Divider />
          <Link href="https://cdefi.iex.ec">Open Nox app</Link>
        </Box>
      ),
    };
  }

  return {
    content: (
      <Box>
        <Heading>Your confidential tokens</Heading>
        <Text>
          Balances are <Bold>encrypted on-chain</Bold>. Decrypt them from the
          companion app (requires a wallet signature).
        </Text>
        <Divider />
        {state.tokens.map((token) => (
          <Box key={token.address}>
            <Row label={token.symbol}>
              <Address address={token.address} />
            </Row>
            <Text>{token.name}</Text>
          </Box>
        ))}
        <Divider />
        <Link href="https://cdefi.iex.ec">Open Nox app</Link>
      </Box>
    ),
  };
};
