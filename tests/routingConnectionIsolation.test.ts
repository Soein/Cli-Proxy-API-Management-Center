import { afterEach, expect, spyOn, test } from 'bun:test';
import type { AxiosAdapter } from 'axios';
import { apiClient } from '../src/services/api/client';
import { buildRoutingBoard, routingApi } from '../src/services/api/routing';
import type { RoutingPlan } from '../src/types/routing';

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

test('a routing credential write cannot move to a newly selected connection before dispatch', async () => {
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  const board = buildRoutingBoard({}, [{ name: 'fixture.json', type: 'codex' }]);
  const plan: RoutingPlan = {
    changes: [],
    priorities: { 'cred:fixture.json': 10 },
    weights: {},
    settings: {},
  };
  let dispatched = false;
  const adapter: AxiosAdapter = async (config) => {
    dispatched = true;
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  const realPatch = apiClient.patch.bind(apiClient);
  const patch = spyOn(apiClient, 'patch').mockImplementation((url, data, config) =>
    realPatch(url, data, { ...config, adapter })
  );
  try {
    const save = routingApi.applyPlan(board, plan);
    apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
    const result = await save;

    expect(dispatched).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.failed?.key).toBe('cred:fixture.json');
    expect(result.failed?.error).toHaveProperty('code', 'ERR_CANCELED');
  } finally {
    patch.mockRestore();
  }
});

test('a routing config patch cannot dispatch against a newly selected connection', async () => {
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  const raw = {
    'api-keys': {
      codex: [
        {
          name: 'codex-group',
          keys: [{ 'api-key': 'sk-codex-1' }],
        },
      ],
    },
  };
  const board = buildRoutingBoard(raw, []);
  const plan: RoutingPlan = {
    changes: [],
    priorities: { 'key:codex:0:0': 15 },
    weights: {},
    settings: {},
  };
  let patchDispatched = false;
  const adapter: AxiosAdapter = async (config) => {
    patchDispatched = true;
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  const realPatch = apiClient.patch.bind(apiClient);
  const patch = spyOn(apiClient, 'patch').mockImplementation((url, data, config) =>
    realPatch(url, data, { ...config, adapter })
  );
  const getRaw = spyOn(apiClient, 'getRaw').mockImplementation(async () => {
    // Switch connection during fresh config read
    apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { data: raw, headers: { etag: '"original-etag"' } } as any;
  });

  try {
    const result = await routingApi.applyPlan(board, plan);

    expect(patchDispatched).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.failed?.key).toBe('config');
    expect(result.notAttempted).toEqual(['key:codex:0:0']);
  } finally {
    patch.mockRestore();
    getRaw.mockRestore();
  }
});
