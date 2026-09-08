import { describe, expect, test } from 'bun:test';
import { infistarToResource } from '../src/features/providers/adapters';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import {
  INFISTAR_AFFILIATE_URL,
  INFISTAR_BASE_URL_OPTIONS,
  INFISTAR_DOMESTIC_BASE_URL,
  INFISTAR_DOMESTIC_ROOT_URL,
  INFISTAR_GLOBAL_BASE_URL,
  INFISTAR_GLOBAL_ROOT_URL,
  buildInfistarRaw,
  getInfistarProtocolUrls,
  resolveInfistarBaseUrl,
} from '../src/features/providers/infistar';
import {
  TEMPORARILY_HIDDEN_SPONSOR_BRANDS,
  getSponsorProviderDefinition,
} from '../src/features/providers/sponsorDefinitions';
import { buildProviderSnapshot } from '../src/features/providers/useProviderWorkbench';

const allProtocolConfig = {
  openaiCompatibility: [
    {
      name: 'infistar',
      baseUrl: INFISTAR_DOMESTIC_BASE_URL,
      apiKeyEntries: [{ apiKey: 'openai-key' }],
    },
  ],
  claudeApiKeys: [{ apiKey: 'claude-key', baseUrl: INFISTAR_DOMESTIC_ROOT_URL }],
  codexApiKeys: [{ apiKey: 'codex-key', baseUrl: INFISTAR_DOMESTIC_BASE_URL }],
  geminiApiKeys: [{ apiKey: 'gemini-key', baseUrl: INFISTAR_DOMESTIC_ROOT_URL }],
  interactionsApiKeys: [{ apiKey: 'interactions-key', baseUrl: INFISTAR_DOMESTIC_BASE_URL }],
};

describe('Infistar sponsor provider', () => {
  test('offers the requested mainland China and global URLs', () => {
    expect(INFISTAR_AFFILIATE_URL).toBe(
      'https://infistar.ai/register?aff=FQKC6J6R&ref_source=link'
    );
    expect(
      INFISTAR_BASE_URL_OPTIONS.map(({ id, baseUrl }) => ({
        id,
        baseUrl,
      }))
    ).toEqual([
      { id: 'mainlandChina', baseUrl: 'https://coneverse.com/v1' },
      { id: 'global', baseUrl: 'https://infistar.ai/v1' },
    ]);
    expect(resolveInfistarBaseUrl(undefined)).toBe(INFISTAR_DOMESTIC_BASE_URL);
    expect(resolveInfistarBaseUrl(INFISTAR_GLOBAL_ROOT_URL)).toBe(INFISTAR_GLOBAL_BASE_URL);
  });

  test('maps both choices to all four supported protocol endpoints', () => {
    expect(getInfistarProtocolUrls(undefined)).toEqual({
      openai: 'https://coneverse.com/v1',
      codex: 'https://coneverse.com/v1',
      anthropic: 'https://coneverse.com',
      gemini: 'https://coneverse.com',
    });
    expect(getInfistarProtocolUrls(INFISTAR_GLOBAL_BASE_URL)).toEqual({
      openai: 'https://infistar.ai/v1',
      codex: 'https://infistar.ai/v1',
      anthropic: 'https://infistar.ai',
      gemini: 'https://infistar.ai',
    });

    const definition = getSponsorProviderDefinition('infistar');
    expect(definition.protocols).toEqual(['openai', 'claude', 'gemini', 'codex']);
    expect(definition.protocols).not.toContain('interactions');
  });

  test('aggregates four protocol configs without claiming Interactions API', () => {
    const raw = buildInfistarRaw(allProtocolConfig);

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
    expect(raw.claude.map((item) => item.index)).toEqual([0]);
    expect(raw.codex.map((item) => item.index)).toEqual([0]);
    expect(raw.gemini.map((item) => item.index)).toEqual([0]);

    const resource = infistarToResource(raw);
    expect(resource?.brand).toBe('infistar');
    expect(resource?.name).toBe('无限星河');
    expect(resource?.flags.protocols).toEqual(['openai', 'anthropic', 'gemini', 'codexResponses']);
  });

  test('keeps custom endpoints outside the Infistar sponsor group', () => {
    const raw = buildInfistarRaw({
      openaiCompatibility: [
        {
          name: 'infistar',
          baseUrl: 'https://gateway.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-key' }],
        },
      ],
    });

    expect(raw.openai).toEqual([]);
  });

  test('keeps its implementation but hides the quick-fill provider entry', () => {
    expect(PROVIDER_BRAND_ORDER.at(-1)).toBe('infistar');
    expect(TEMPORARILY_HIDDEN_SPONSOR_BRANDS.has('infistar')).toBeTrue();
    expect(PROVIDER_LOGOS.infistar.src).toContain('infistar.png');
    expect(PROVIDER_LOGOS.infistar.transparent).toBeTrue();
  });

  test('displays Infistar protocol configs under native groups when Infistar sponsor group is hidden', () => {
    const mixedConfig = {
      geminiApiKeys: [
        { apiKey: 'official-gemini-key', baseUrl: 'https://generativelanguage.googleapis.com' },
        ...allProtocolConfig.geminiApiKeys,
        { apiKey: 'infistar-gemini-global', baseUrl: INFISTAR_GLOBAL_ROOT_URL },
      ],
      codexApiKeys: [
        { apiKey: 'official-codex-key', baseUrl: 'https://codex.example.com' },
        ...allProtocolConfig.codexApiKeys,
        { apiKey: 'infistar-codex-global', baseUrl: INFISTAR_GLOBAL_BASE_URL },
      ],
      claudeApiKeys: [
        { apiKey: 'official-claude-key', baseUrl: 'https://api.anthropic.com' },
        ...allProtocolConfig.claudeApiKeys,
        { apiKey: 'infistar-claude-global', baseUrl: INFISTAR_GLOBAL_ROOT_URL },
      ],
      openaiCompatibility: [
        {
          name: 'Official OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEntries: [{ apiKey: 'openai-key' }],
        },
        ...allProtocolConfig.openaiCompatibility,
        {
          name: 'infistar-global',
          baseUrl: INFISTAR_GLOBAL_BASE_URL,
          apiKeyEntries: [{ apiKey: 'infistar-global-key' }],
        },
      ],
    };

    const snapshot = buildProviderSnapshot(mixedConfig);
    expect(snapshot).not.toBeNull();

    // 1. Infistar aggregation group is absent
    const infistarGroup = snapshot?.groups.find((group) => group.id === 'infistar');
    expect(infistarGroup).toBeUndefined();

    // 2. Native protocol groups retain Infistar resources with original indices and raw objects
    const geminiGroup = snapshot?.groups.find((group) => group.id === 'gemini');
    expect(geminiGroup?.resources).toHaveLength(3);
    expect(geminiGroup?.resources[0].selector).toEqual({
      brand: 'gemini',
      index: 0,
      apiKey: 'official-gemini-key',
      baseUrl: 'https://generativelanguage.googleapis.com',
    });
    expect(geminiGroup?.resources[1].selector).toEqual({
      brand: 'gemini',
      index: 1,
      apiKey: 'gemini-key',
      baseUrl: INFISTAR_DOMESTIC_ROOT_URL,
    });
    expect(geminiGroup?.resources[1].raw).toBe(mixedConfig.geminiApiKeys[1]);
    expect(geminiGroup?.resources[2].selector).toEqual({
      brand: 'gemini',
      index: 2,
      apiKey: 'infistar-gemini-global',
      baseUrl: INFISTAR_GLOBAL_ROOT_URL,
    });
    expect(geminiGroup?.resources[2].raw).toBe(mixedConfig.geminiApiKeys[2]);

    const codexGroup = snapshot?.groups.find((group) => group.id === 'codex');
    expect(codexGroup?.resources).toHaveLength(3);
    expect(codexGroup?.resources[0].selector).toEqual({
      brand: 'codex',
      index: 0,
      apiKey: 'official-codex-key',
      baseUrl: 'https://codex.example.com',
    });
    expect(codexGroup?.resources[1].selector).toEqual({
      brand: 'codex',
      index: 1,
      apiKey: 'codex-key',
      baseUrl: INFISTAR_DOMESTIC_BASE_URL,
    });
    expect(codexGroup?.resources[1].raw).toBe(mixedConfig.codexApiKeys[1]);
    expect(codexGroup?.resources[2].selector).toEqual({
      brand: 'codex',
      index: 2,
      apiKey: 'infistar-codex-global',
      baseUrl: INFISTAR_GLOBAL_BASE_URL,
    });
    expect(codexGroup?.resources[2].raw).toBe(mixedConfig.codexApiKeys[2]);

    const claudeGroup = snapshot?.groups.find((group) => group.id === 'claude');
    expect(claudeGroup?.resources).toHaveLength(3);
    expect(claudeGroup?.resources[0].selector).toEqual({
      brand: 'claude',
      index: 0,
      apiKey: 'official-claude-key',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(claudeGroup?.resources[1].selector).toEqual({
      brand: 'claude',
      index: 1,
      apiKey: 'claude-key',
      baseUrl: INFISTAR_DOMESTIC_ROOT_URL,
    });
    expect(claudeGroup?.resources[1].raw).toBe(mixedConfig.claudeApiKeys[1]);
    expect(claudeGroup?.resources[2].selector).toEqual({
      brand: 'claude',
      index: 2,
      apiKey: 'infistar-claude-global',
      baseUrl: INFISTAR_GLOBAL_ROOT_URL,
    });
    expect(claudeGroup?.resources[2].raw).toBe(mixedConfig.claudeApiKeys[2]);

    const openaiGroup = snapshot?.groups.find((group) => group.id === 'openaiCompatibility');
    expect(openaiGroup?.resources).toHaveLength(3);
    expect(openaiGroup?.resources[0].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 0,
      name: 'Official OpenAI',
    });
    expect(openaiGroup?.resources[1].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 1,
      name: 'infistar',
    });
    expect(openaiGroup?.resources[1].raw).toBe(mixedConfig.openaiCompatibility[1]);
    expect(openaiGroup?.resources[2].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 2,
      name: 'infistar-global',
    });
    expect(openaiGroup?.resources[2].raw).toBe(mixedConfig.openaiCompatibility[2]);
  });
});
