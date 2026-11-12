import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AxiosError, type AxiosInstance } from 'axios';
import { apiClient } from '@/services/api/client';
import * as modelsModule from '@/services/api/models';
import type { ApiError } from '@/types';

const instance = (apiClient as unknown as { instance: AxiosInstance }).instance;
const originalAdapter = instance.defaults.adapter;
const spies: Array<{ mockRestore(): void }> = [];

beforeEach(() => {
  apiClient.setConfig({ apiBase: 'https://catalog.invalid', managementKey: 'fixture-only' });
});

afterEach(() => {
  instance.defaults.adapter = originalAdapter;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

const respond = (status: number, data: unknown) => {
  instance.defaults.adapter = async (config) => {
    expect(config.url).toBe('/models/refresh');
    expect(config.method).toBe('post');
    const response = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) {
      throw new AxiosError('Catalog request failed', 'ERR_BAD_RESPONSE', config, null, response);
    }
    return response;
  };
};

describe('model catalog refresh API boundary', () => {
  test('exposes partial changes from a real normalized 502 without altering its error', async () => {
    const payload = {
      error: 'catalog_failed',
      message: 'Codex catalog unavailable',
      changed_providers: [' claude ', null, '', 2, {}, false, 'codex', '   '],
    };
    respond(502, payload);
    const pending = modelsModule.modelsApi.refreshCatalog();
    await expect(pending).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Codex catalog unavailable',
      status: 502,
      code: 'ERR_BAD_RESPONSE',
      apiCode: 'catalog_failed',
    });
    const failure = (await pending.catch((error: unknown) => error)) as ApiError;
    expect(modelsModule.getModelCatalogRefreshFailure(failure)).toEqual({
      changedProviders: ['claude', 'codex'],
    });
    expect(failure.data).toBe(payload);
    expect(failure.details).toBe(payload);
    expect(failure).not.toHaveProperty('changedProviders');
  });

  test.each(
    [
      undefined,
      null,
      'invalid payload',
      [],
      {},
      { changed_providers: null },
      { changed_providers: 'claude' },
      { changed_providers: { claude: true } },
      { changed_providers: [null, false, 2, {}, '', '  '] },
    ].map((payload) => ({ payload }))
  )('keeps an ordinary 502 rejected for payload %j', async ({ payload }) => {
    respond(502, payload);
    const pending = modelsModule.modelsApi.refreshCatalog();
    await expect(pending).rejects.toHaveProperty('status', 502);
    const failure: unknown = await pending.catch((error: unknown) => error);
    expect(modelsModule.getModelCatalogRefreshFailure(failure)).toEqual({ changedProviders: [] });
  });

  test('preserves the original rejection identity and reads details without mutation', async () => {
    const details = Object.freeze({ changed_providers: [' claude ', null, ''] });
    const failure = Object.freeze(Object.assign(new Error('Original failure'), { details }));
    spies.push(spyOn(apiClient, 'post').mockRejectedValue(failure));
    await expect(modelsModule.modelsApi.refreshCatalog()).rejects.toBe(failure);
    expect(modelsModule.getModelCatalogRefreshFailure(failure)).toEqual({
      changedProviders: ['claude'],
    });
    expect(failure.details).toBe(details);
    expect(failure).not.toHaveProperty('changedProviders');
  });

  test.each(
    [undefined, null, false, 2, 'network failure', [], new Error('Offline')].map((failure) => ({
      failure,
    }))
  )('does not invent changes for an unstructured failure %j', ({ failure }) => {
    expect(modelsModule.getModelCatalogRefreshFailure(failure)).toEqual({
      changedProviders: [],
    });
  });

  test('filters malformed successful provider arrays at the same API boundary', async () => {
    respond(200, { changed_providers: [' claude ', '', null, false, 2, {}, 'codex'] });
    await expect(modelsModule.modelsApi.refreshCatalog()).resolves.toEqual({
      changedProviders: ['claude', 'codex'],
    });
  });

  test('preserves a successful no-change response', async () => {
    respond(200, { ok: true, changed_providers: null });
    await expect(modelsModule.modelsApi.refreshCatalog()).resolves.toEqual({
      changedProviders: [],
    });
  });
});
