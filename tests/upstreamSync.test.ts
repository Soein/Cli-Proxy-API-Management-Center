import { describe, expect, test } from 'bun:test';
import {
  buildProviderGroups,
  buildProviderSnapshot,
} from '../src/features/providers/useProviderWorkbench';
import { normalizeConfigResponse } from '../src/services/api/transformers';
import type { Config } from '../src/types';

describe('upstream sync integration tests', () => {
  describe('retired providers in generic protocol groups', () => {
    const retiredEndpoints = [
      { name: 'code0', baseUrl: 'https://code0.ai', apiPath: '/v1' },
      { name: 'lmuAI', baseUrl: 'https://api.lmuai.com', apiPath: '/v1' },
      { name: 'infistar-domestic', baseUrl: 'https://coneverse.com', apiPath: '/v1' },
      { name: 'infistar-global', baseUrl: 'https://infistar.ai', apiPath: '/v1' },
      { name: 'claudeApi-gw', baseUrl: 'https://gw.claudeapi.com', apiPath: '' },
      { name: 'claudeApi-legacy', baseUrl: 'https://gw.apito.ai', apiPath: '' },
    ] as const;

    test('retired brands are not separate groups in buildProviderGroups or buildProviderSnapshot', () => {
      const groups = buildProviderGroups({});
      const ids = groups.map((g) => g.id);
      expect(ids).not.toContain('code0');
      expect(ids).not.toContain('lmuAI');
      expect(ids).not.toContain('infistar');
      expect(ids).not.toContain('claudeApi');

      // Verify active brands
      expect(ids).toContain('meta');
      expect(ids).toContain('apikeyFun');
      expect(ids).toContain('fennoAI');
      expect(ids).toContain('qiniuCloud');
      expect(ids).toContain('kimi');

      const snapshot = buildProviderSnapshot({});
      expect(snapshot).not.toBeNull();
      expect(snapshot?.groups.map((g) => g.id)).toEqual(ids);
    });

    for (const { name, baseUrl, apiPath } of retiredEndpoints) {
      test(`preserves ${name} (${baseUrl}) in generic protocol groups`, () => {
        const keyConfig = {
          apiKey: `key-${name}`,
          baseUrl,
          excludedModels: ['*'],
        };
        const openaiConfig = {
          name,
          baseUrl: `${baseUrl}${apiPath}`,
          apiKeyEntries: [{ apiKey: `key-${name}` }],
          sourceIndex: 3,
          disabled: true,
        };
        const config: Config = {
          geminiApiKeys: [keyConfig],
          codexApiKeys: [keyConfig],
          claudeApiKeys: [keyConfig],
          openaiCompatibility: [openaiConfig],
        };

        const groups = buildProviderGroups(config);

        // Gemini
        const geminiGroup = groups.find((g) => g.id === 'gemini');
        expect(geminiGroup?.resources).toHaveLength(1);
        expect(geminiGroup?.resources[0].brand).toBe('gemini');
        expect(geminiGroup?.resources[0].disabled).toBe(true);
        expect(geminiGroup?.resources[0].raw).toBe(keyConfig);
        expect(geminiGroup?.resources[0].selector).toEqual({
          brand: 'gemini',
          apiKey: keyConfig.apiKey,
          baseUrl,
          index: 0,
        });

        // Codex
        const codexGroup = groups.find((g) => g.id === 'codex');
        expect(codexGroup?.resources).toHaveLength(1);
        expect(codexGroup?.resources[0].brand).toBe('codex');
        expect(codexGroup?.resources[0].disabled).toBe(true);
        expect(codexGroup?.resources[0].raw).toBe(keyConfig);
        expect(codexGroup?.resources[0].selector).toEqual({
          brand: 'codex',
          apiKey: keyConfig.apiKey,
          baseUrl,
          index: 0,
        });

        // Claude
        const claudeGroup = groups.find((g) => g.id === 'claude');
        expect(claudeGroup?.resources).toHaveLength(1);
        expect(claudeGroup?.resources[0].brand).toBe('claude');
        expect(claudeGroup?.resources[0].disabled).toBe(true);
        expect(claudeGroup?.resources[0].raw).toBe(keyConfig);
        expect(claudeGroup?.resources[0].selector).toEqual({
          brand: 'claude',
          apiKey: keyConfig.apiKey,
          baseUrl,
          index: 0,
        });

        // OpenAI compatibility
        const openaiGroup = groups.find((g) => g.id === 'openaiCompatibility');
        expect(openaiGroup?.resources).toHaveLength(1);
        expect(openaiGroup?.resources[0].brand).toBe('openaiCompatibility');
        expect(openaiGroup?.resources[0].disabled).toBe(true);
        expect(openaiGroup?.resources[0].raw).toBe(openaiConfig);
        expect(openaiGroup?.resources[0].selector).toEqual({
          brand: 'openaiCompatibility',
          name,
          index: 3,
        });
      });
    }
  });

  describe('v8 config normalization and usageStatisticsEnabled', () => {
    test('normalizes usageStatisticsEnabled from observability.usage.usage-statistics-enabled', () => {
      const v8Raw = {
        observability: {
          usage: {
            'usage-statistics-enabled': true,
          },
          logs: {
            debug: false,
            'request-log': true,
            'logging-to-file': true,
            'logs-max-total-size-mb': 50,
          },
        },
        requests: {
          'proxy-url': 'http://proxy.local:8080',
        },
        routing: {
          strategy: 'round-robin',
          'force-model-prefix': false,
          retry: {
            'request-retry': 3,
          },
        },
      };

      const normalized = normalizeConfigResponse(v8Raw);
      expect(normalized.usageStatisticsEnabled).toBe(true);
      expect(normalized.debug).toBe(false);
      expect(normalized.requestLog).toBe(true);
      expect(normalized.loggingToFile).toBe(true);
      expect(normalized.logsMaxTotalSizeMb).toBe(50);
      expect(normalized.proxyUrl).toBe('http://proxy.local:8080');
      expect(normalized.routingStrategy).toBe('round-robin');
      expect(normalized.requestRetry).toBe(3);
    });

    test('does not fall back to root usage-statistics-enabled when v8 path is missing', () => {
      const flatRaw = {
        'usage-statistics-enabled': true,
      };

      const normalized = normalizeConfigResponse(flatRaw);
      expect(normalized.usageStatisticsEnabled).toBeUndefined();
    });

    test('handles false usageStatisticsEnabled', () => {
      const v8Raw = {
        observability: {
          usage: {
            'usage-statistics-enabled': false,
          },
        },
      };

      const normalized = normalizeConfigResponse(v8Raw);
      expect(normalized.usageStatisticsEnabled).toBe(false);
    });
  });

  describe('buildProviderSnapshot', () => {
    test('returns null when config is null', () => {
      expect(buildProviderSnapshot(null)).toBeNull();
    });

    test('returns snapshot with fetchedAt and groups', () => {
      const timestamp = '2026-10-01T12:00:00.000Z';
      const snapshot = buildProviderSnapshot({}, timestamp);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.fetchedAt).toBe(timestamp);
      expect(Array.isArray(snapshot?.groups)).toBe(true);
      expect(snapshot?.groups.length).toBeGreaterThan(0);
    });
  });
});
