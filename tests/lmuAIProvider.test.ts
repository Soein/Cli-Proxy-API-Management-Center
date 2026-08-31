import { describe, expect, test } from 'bun:test';
import { lmuAIToResource } from '../src/features/providers/adapters';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import {
  LMU_AI_AFFILIATE_URL,
  LMU_AI_BASE_URL,
  LMU_AI_OPENAI_BASE_URL,
  buildLmuAIRaw,
  getLmuAIProtocolUrls,
} from '../src/features/providers/lmuAI';
import { getSponsorProviderDefinition } from '../src/features/providers/sponsorDefinitions';
import { buildProviderSnapshot } from '../src/features/providers/useProviderWorkbench';

const allProtocolConfig = {
  openaiCompatibility: [
    {
      name: 'lmuAI',
      baseUrl: LMU_AI_OPENAI_BASE_URL,
      apiKeyEntries: [{ apiKey: 'openai-key' }],
    },
  ],
  claudeApiKeys: [{ apiKey: 'claude-key', baseUrl: LMU_AI_BASE_URL }],
  codexApiKeys: [{ apiKey: 'codex-key', baseUrl: LMU_AI_OPENAI_BASE_URL }],
  geminiApiKeys: [{ apiKey: 'gemini-key', baseUrl: LMU_AI_BASE_URL }],
  interactionsApiKeys: [{ apiKey: 'interactions-key', baseUrl: LMU_AI_BASE_URL }],
};

describe('LMU AI provider', () => {
  test('uses the official URL for all four supported protocols', () => {
    expect(LMU_AI_AFFILIATE_URL).toBe('https://api.lmuai.com/register?ref=yJ6Kwg9g');
    expect(getLmuAIProtocolUrls(undefined)).toEqual({
      openai: 'https://api.lmuai.com/v1',
      codex: 'https://api.lmuai.com/v1',
      anthropic: 'https://api.lmuai.com',
      gemini: 'https://api.lmuai.com',
    });

    const definition = getSponsorProviderDefinition('lmuAI');
    expect(definition.protocols).toEqual(['openai', 'claude', 'gemini', 'codex']);
    expect(definition.protocols).not.toContain('interactions');
  });

  test('aggregates the four protocol configs without claiming Interactions API', () => {
    const raw = buildLmuAIRaw(allProtocolConfig);

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
    expect(raw.claude.map((item) => item.index)).toEqual([0]);
    expect(raw.codex.map((item) => item.index)).toEqual([0]);
    expect(raw.gemini.map((item) => item.index)).toEqual([0]);

    const resource = lmuAIToResource(raw);
    expect(resource?.brand).toBe('lmuAI');
    expect(resource?.name).toBe('LMU AI（灵眸AI）');
    expect(resource?.flags.protocols).toEqual(['openai', 'anthropic', 'gemini', 'codexResponses']);
  });

  test('keeps custom endpoints outside the LMU AI sponsor group', () => {
    const raw = buildLmuAIRaw({
      openaiCompatibility: [
        {
          name: 'lmuAI',
          baseUrl: 'https://gateway.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-key' }],
        },
      ],
    });

    expect(raw.openai).toEqual([]);
  });

  test('remains in the provider catalog with the sponsor logo', () => {
    expect(PROVIDER_BRAND_ORDER).toContain('lmuAI');
    expect(PROVIDER_BRAND_ORDER.indexOf('lmuAI')).toBeLessThan(
      PROVIDER_BRAND_ORDER.indexOf('infistar')
    );
    expect(PROVIDER_LOGOS.lmuAI.src).toContain('lmu-ai.png');
  });

  test('displays LMU protocol configs under native groups when LMU sponsor group is hidden', () => {
    const mixedConfig = {
      ...allProtocolConfig,
      geminiApiKeys: [
        ...allProtocolConfig.geminiApiKeys,
        { apiKey: 'custom-gemini-key', baseUrl: 'https://gemini.example.com' },
      ],
      openaiCompatibility: [
        ...allProtocolConfig.openaiCompatibility,
        {
          name: 'Custom Provider',
          baseUrl: 'https://custom.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-key' }],
        },
      ],
    };

    const snapshot = buildProviderSnapshot(mixedConfig);
    expect(snapshot).not.toBeNull();

    // 1. LMU aggregation group is hidden
    const lmuGroup = snapshot?.groups.find((group) => group.id === 'lmuAI');
    expect(lmuGroup).toBeUndefined();

    // 2. Native protocol groups take over displaying the respective LMU resources
    const geminiGroup = snapshot?.groups.find((group) => group.id === 'gemini');
    expect(geminiGroup?.resources).toHaveLength(2);
    expect(geminiGroup?.resources[0].selector).toEqual({
      brand: 'gemini',
      index: 0,
      apiKey: 'gemini-key',
      baseUrl: LMU_AI_BASE_URL,
    });
    expect(geminiGroup?.resources[1].selector).toEqual({
      brand: 'gemini',
      index: 1,
      apiKey: 'custom-gemini-key',
      baseUrl: 'https://gemini.example.com',
    });

    const codexGroup = snapshot?.groups.find((group) => group.id === 'codex');
    expect(codexGroup?.resources).toHaveLength(1);
    expect(codexGroup?.resources[0].selector).toEqual({
      brand: 'codex',
      index: 0,
      apiKey: 'codex-key',
      baseUrl: LMU_AI_OPENAI_BASE_URL,
    });

    const claudeGroup = snapshot?.groups.find((group) => group.id === 'claude');
    expect(claudeGroup?.resources).toHaveLength(1);
    expect(claudeGroup?.resources[0].selector).toEqual({
      brand: 'claude',
      index: 0,
      apiKey: 'claude-key',
      baseUrl: LMU_AI_BASE_URL,
    });

    const openaiGroup = snapshot?.groups.find((group) => group.id === 'openaiCompatibility');
    expect(openaiGroup?.resources).toHaveLength(2);
    expect(openaiGroup?.resources[0].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 0,
      name: 'lmuAI',
    });
    expect(openaiGroup?.resources[1].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 1,
      name: 'Custom Provider',
    });
  });
});
