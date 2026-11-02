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
