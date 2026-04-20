export const erc20Abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
] as const;

export const erc7984Abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'confidentialBalanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'confidentialTransfer', stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'confidentialTransferFrom', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'setOperator', stateMutability: 'nonpayable',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'until', type: 'uint48' }],
    outputs: [] },
  { type: 'function', name: 'isOperator', stateMutability: 'view',
    inputs: [{ name: 'holder', type: 'address' }, { name: 'operator', type: 'address' }],
    outputs: [{ type: 'bool' }] },
  { type: 'event', name: 'ConfidentialTransfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amountHandle', type: 'bytes32', indexed: false },
    ] },
] as const;

export const noxComputeAbi = [
  { type: 'function', name: 'addViewer', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'bytes32' },
      { name: 'viewer', type: 'address' },
    ],
    outputs: [] },
  { type: 'function', name: 'isViewer', stateMutability: 'view',
    inputs: [
      { name: 'handle', type: 'bytes32' },
      { name: 'viewer', type: 'address' },
    ],
    outputs: [{ type: 'bool' }] },
] as const;

export const wrapperAbi = [
  ...erc7984Abi,
  { type: 'function', name: 'underlying', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'wrap', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'unwrap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'encryptedAmount', type: 'bytes32' },
      { name: 'inputProof', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'finalizeUnwrap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'unwrapRequestId', type: 'bytes32' },
      { name: 'decryptedAmountAndProof', type: 'bytes' },
    ],
    outputs: [] },
  { type: 'event', name: 'UnwrapRequested',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'unwrapRequestId', type: 'bytes32', indexed: false },
    ] },
  { type: 'event', name: 'UnwrapFinalized',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'unwrapRequestId', type: 'bytes32', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ] },
] as const;
