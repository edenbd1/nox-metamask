export type TrackedToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  chainId: number;
  addedAt: number;
};

export type SnapState = {
  tokens: TrackedToken[];
};

const EMPTY_STATE: SnapState = { tokens: [] };

export async function loadState(): Promise<SnapState> {
  const raw = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get', encrypted: true },
  });
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  const state = raw as Partial<SnapState>;
  return { tokens: Array.isArray(state.tokens) ? state.tokens : [] };
}

export async function saveState(state: SnapState): Promise<void> {
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: state as unknown as Record<string, unknown>,
      encrypted: true,
    },
  });
}
