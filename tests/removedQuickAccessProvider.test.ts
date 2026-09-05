import { describe, expect, test } from 'bun:test';
import {
  CODE0_ANTHROPIC_BASE_URL,
  CODE0_CODEX_BASE_URL,
  CODE0_GEMINI_BASE_URL,
  CODE0_OPENAI_BASE_URL,
} from '../src/features/providers/code0';
import {
  CLAUDE_API_BASE_URL,
  CLAUDE_API_LEGACY_BASE_URL,
} from '../src/features/providers/claudeApi';
import { REMOVED_QUICK_ACCESS_BRANDS } from '../src/features/providers/descriptors';
import { buildProviderSnapshot } from '../src/features/providers/useProviderWorkbench';
import type { Config } from '../src/types';

describe('Removed quick access providers (Code0 and ClaudeAPI)', () => {
  test('excludes Code0 and ClaudeAPI from snapshot provider groups', () => {
    expect(REMOVED_QUICK_ACCESS_BRANDS.has('code0')).toBe(true);
    expect(REMOVED_QUICK_ACCESS_BRANDS.has('claudeApi')).toBe(true);

    const config: Config = {
      geminiApiKeys: [{ apiKey: 'code0-gemini-key', baseUrl: CODE0_GEMINI_BASE_URL }],
      codexApiKeys: [{ apiKey: 'code0-codex-key', baseUrl: CODE0_CODEX_BASE_URL }],
      claudeApiKeys: [
        { apiKey: 'code0-claude-key', baseUrl: CODE0_ANTHROPIC_BASE_URL },
        { apiKey: 'claude-api-key', baseUrl: CLAUDE_API_BASE_URL },
        { apiKey: 'claude-legacy-key', baseUrl: CLAUDE_API_LEGACY_BASE_URL },
      ],
      openaiCompatibility: [
        {
          name: 'code0',
          baseUrl: CODE0_OPENAI_BASE_URL,
          apiKeyEntries: [{ apiKey: 'code0-openai-key' }],
        },
      ],
    };

    const snapshot = buildProviderSnapshot(config);
    expect(snapshot).not.toBeNull();

    const groupIds = snapshot?.groups.map((group) => group.id);
    expect(groupIds).not.toContain('code0');
    expect(groupIds).not.toContain('claudeApi');
  });

  test('preserves Code0 and ClaudeAPI resources under native protocol groups with accurate selectors and indices in mixed configurations', () => {
    const mixedConfig: Config = {
      geminiApiKeys: [
        { apiKey: 'official-gemini-key', baseUrl: 'https://generativelanguage.googleapis.com' },
        { apiKey: 'code0-gemini-key', baseUrl: CODE0_GEMINI_BASE_URL },
        { apiKey: 'custom-gemini-key', baseUrl: 'https://gemini.example.com' },
      ],
      codexApiKeys: [
        { apiKey: 'official-codex-key', baseUrl: 'https://codex.example.com' },
        { apiKey: 'code0-codex-key', baseUrl: CODE0_CODEX_BASE_URL },
        { apiKey: 'custom-codex-key', baseUrl: 'https://another-codex.example.com' },
      ],
      claudeApiKeys: [
        { apiKey: 'native-claude-key', baseUrl: 'https://api.anthropic.com' },
        { apiKey: 'code0-claude-key', baseUrl: CODE0_ANTHROPIC_BASE_URL },
        { apiKey: 'claude-api-key', baseUrl: CLAUDE_API_BASE_URL },
        { apiKey: 'claude-legacy-key', baseUrl: CLAUDE_API_LEGACY_BASE_URL },
        { apiKey: 'custom-claude-key', baseUrl: 'https://custom-claude.example.com' },
      ],
      openaiCompatibility: [
        {
          name: 'OpenAI Standard',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEntries: [{ apiKey: 'openai-std-key' }],
        },
        {
          name: 'code0',
          baseUrl: CODE0_OPENAI_BASE_URL,
          apiKeyEntries: [{ apiKey: 'code0-openai-key' }],
        },
        {
          name: 'Custom Provider',
          baseUrl: 'https://custom-ai.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-openai-key' }],
        },
      ],
    };

    const snapshot = buildProviderSnapshot(mixedConfig);
    expect(snapshot).not.toBeNull();

    // Verify gemini group retains Code0 at original index 1
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
      apiKey: 'code0-gemini-key',
      baseUrl: CODE0_GEMINI_BASE_URL,
    });
    expect(geminiGroup?.resources[1].raw).toBe(mixedConfig.geminiApiKeys![1]);
    expect(geminiGroup?.resources[2].selector).toEqual({
      brand: 'gemini',
      index: 2,
      apiKey: 'custom-gemini-key',
      baseUrl: 'https://gemini.example.com',
    });

    // Verify codex group retains Code0 at original index 1
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
      apiKey: 'code0-codex-key',
      baseUrl: CODE0_CODEX_BASE_URL,
    });
    expect(codexGroup?.resources[1].raw).toBe(mixedConfig.codexApiKeys![1]);
    expect(codexGroup?.resources[2].selector).toEqual({
      brand: 'codex',
      index: 2,
      apiKey: 'custom-codex-key',
      baseUrl: 'https://another-codex.example.com',
    });

    // Verify claude group retains Code0 (index 1) and ClaudeAPI (indices 2, 3)
    const claudeGroup = snapshot?.groups.find((group) => group.id === 'claude');
    expect(claudeGroup?.resources).toHaveLength(5);
    expect(claudeGroup?.resources[0].selector).toEqual({
      brand: 'claude',
      index: 0,
      apiKey: 'native-claude-key',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(claudeGroup?.resources[1].selector).toEqual({
      brand: 'claude',
      index: 1,
      apiKey: 'code0-claude-key',
      baseUrl: CODE0_ANTHROPIC_BASE_URL,
    });
    expect(claudeGroup?.resources[1].raw).toBe(mixedConfig.claudeApiKeys![1]);
    expect(claudeGroup?.resources[2].selector).toEqual({
      brand: 'claude',
      index: 2,
      apiKey: 'claude-api-key',
      baseUrl: CLAUDE_API_BASE_URL,
    });
    expect(claudeGroup?.resources[2].raw).toBe(mixedConfig.claudeApiKeys![2]);
    expect(claudeGroup?.resources[3].selector).toEqual({
      brand: 'claude',
      index: 3,
      apiKey: 'claude-legacy-key',
      baseUrl: CLAUDE_API_LEGACY_BASE_URL,
    });
    expect(claudeGroup?.resources[3].raw).toBe(mixedConfig.claudeApiKeys![3]);
    expect(claudeGroup?.resources[4].selector).toEqual({
      brand: 'claude',
      index: 4,
      apiKey: 'custom-claude-key',
      baseUrl: 'https://custom-claude.example.com',
    });

    // Verify openaiCompatibility group retains Code0 at original index 1
    const openaiGroup = snapshot?.groups.find((group) => group.id === 'openaiCompatibility');
    expect(openaiGroup?.resources).toHaveLength(3);
    expect(openaiGroup?.resources[0].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 0,
      name: 'OpenAI Standard',
    });
    expect(openaiGroup?.resources[1].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 1,
      name: 'code0',
    });
    expect(openaiGroup?.resources[1].raw).toBe(mixedConfig.openaiCompatibility![1]);
    expect(openaiGroup?.resources[2].selector).toEqual({
      brand: 'openaiCompatibility',
      index: 2,
      name: 'Custom Provider',
    });
  });
});
