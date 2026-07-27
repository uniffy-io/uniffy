import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { MemoryScope } from '@uniffy/proto/agents/v1/memories_pb';

vi.mock('@/features/agents/api/providersApi', () => ({ providersApi: {} }));
vi.mock('@/features/chat/api/chatApi', () => ({ chatApi: {} }));
vi.mock('@/config', () => ({ friendlyErrorMessage: (message: string) => message }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import {
  buildModelOptions,
  filterChatModels,
  memoryScopeForChannel,
  modelDisplayName,
  paramsChangesForModelSwitch,
  paramsForModelSwitch,
  pickerButtonLabel,
  resolveEffectiveModelId,
} from '@/features/chat/components/compose/AgentModelPicker';
import type { SerializedModelInfo } from '@/features/agents/store/agentProvidersThunks';

function model(overrides: Partial<SerializedModelInfo> = {}): SerializedModelInfo {
  return {
    id: 'anthropic/claude',
    displayName: 'Claude',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: true,
    supportsImageGeneration: false,
    catalogKnown: true,
    parameterSchemaJson: '',
    ...overrides,
  };
}

describe('filterChatModels', () => {
  it('keeps only catalog-known non-image models', () => {
    const kept = model({ id: 'chat-model' });
    const models = [
      kept,
      model({ id: 'live-api-noise', catalogKnown: false }),
      model({ id: 'image-model', supportsImageGeneration: true }),
    ];
    expect(filterChatModels(models)).toEqual([kept]);
  });
});

describe('resolveEffectiveModelId', () => {
  it('falls back to the primary model without a config or override', () => {
    expect(resolveEffectiveModelId(null, 'primary')).toBe('primary');
    expect(resolveEffectiveModelId({ modelOverride: null }, 'primary')).toBe('primary');
  });

  it('prefers the override when set', () => {
    expect(resolveEffectiveModelId({ modelOverride: 'other' }, 'primary')).toBe('other');
  });
});

describe('modelDisplayName', () => {
  it('resolves the display name and falls back to the raw id', () => {
    const models = [model({ id: 'm-1', displayName: 'Model One' })];
    expect(modelDisplayName(models, 'm-1')).toBe('Model One');
    expect(modelDisplayName(models, 'unknown-id')).toBe('unknown-id');
  });
});

describe('pickerButtonLabel', () => {
  const models = [
    model({ id: 'primary-id', displayName: 'Primary' }),
    model({ id: 'override-id', displayName: 'Override' }),
  ];

  it('labels the agent default with the primary model name', () => {
    expect(pickerButtonLabel(null, 'primary-id', models)).toBe('Default (Primary)');
    expect(pickerButtonLabel({ modelOverride: null }, 'primary-id', models)).toBe(
      'Default (Primary)',
    );
  });

  it('labels an active override with its model name', () => {
    expect(pickerButtonLabel({ modelOverride: 'override-id' }, 'primary-id', models)).toBe(
      'Override',
    );
  });

  it('falls back to raw ids for models missing from the list', () => {
    expect(pickerButtonLabel(null, 'gone-primary', models)).toBe('Default (gone-primary)');
    expect(pickerButtonLabel({ modelOverride: 'gone-override' }, 'primary-id', models)).toBe(
      'gone-override',
    );
  });
});

describe('buildModelOptions', () => {
  const chatModels = [
    model({ id: 'm-1', displayName: 'Model One' }),
    model({ id: 'm-2', displayName: 'Model Two' }),
  ];

  it('maps models to options', () => {
    expect(buildModelOptions(chatModels, null)).toEqual([
      { id: 'm-1', label: 'Model One' },
      { id: 'm-2', label: 'Model Two' },
    ]);
  });

  it('keeps a stale override visible at the top', () => {
    expect(buildModelOptions(chatModels, 'stale-model')[0]).toEqual({
      id: 'stale-model',
      label: 'stale-model',
    });
  });

  it('does not duplicate an override that is in the list', () => {
    const options = buildModelOptions(chatModels, 'm-2');
    expect(options).toHaveLength(2);
    expect(options.filter((o) => o.id === 'm-2')).toHaveLength(1);
  });
});

describe('paramsForModelSwitch', () => {
  const values = {
    temperature: 0.7,
    reasoning_effort: 'high',
    provider_options: { top_k: 40 },
  };

  it('keeps params the next model still supports', () => {
    const nextSchema = JSON.stringify({
      temperature: { type: 'number', minimum: 0, maximum: 2 },
      reasoning_effort: { type: 'enum', enum: ['off', 'low', 'high'] },
      provider_options: { top_k: { type: 'integer', minimum: 1, maximum: 500 } },
    });
    expect(paramsForModelSwitch(nextSchema, values)).toEqual(values);
  });

  it('strips params the next model rejects', () => {
    const nextSchema = JSON.stringify({
      temperature: { type: 'number', minimum: 0, maximum: 2 },
    });
    expect(paramsForModelSwitch(nextSchema, values)).toEqual({ temperature: 0.7 });
  });

  it('strips values that fall outside the next schema bounds', () => {
    const nextSchema = JSON.stringify({
      temperature: { type: 'number', minimum: 0, maximum: 0.5 },
    });
    expect(paramsForModelSwitch(nextSchema, values)).toEqual({});
  });

  it('drops everything when the next model has no schema', () => {
    expect(paramsForModelSwitch('', values)).toEqual({});
    expect(paramsForModelSwitch('not-json', values)).toEqual({});
  });
});

describe('paramsChangesForModelSwitch', () => {
  const schema = JSON.stringify({
    temperature: { type: 'number', minimum: 0, maximum: 2 },
  });
  const models = [
    model({ id: 'primary-id', parameterSchemaJson: schema }),
    model({ id: 'other-id', parameterSchemaJson: schema }),
  ];
  const params = { temperature: 0.7, reasoning_effort: 'high' };

  it('omits the field when no params are stored', () => {
    expect(paramsChangesForModelSwitch(models, 'other-id', 'primary-id', {})).toBeUndefined();
  });

  it('strips per the next model schema when it is known', () => {
    expect(paramsChangesForModelSwitch(models, 'other-id', 'primary-id', params)).toEqual({
      temperature: 0.7,
    });
    expect(paramsChangesForModelSwitch(models, null, 'primary-id', params)).toEqual({
      temperature: 0.7,
    });
  });

  it('leaves params untouched for a name-only agent on the org default', () => {
    // Switching back to "Agent default" with no client-visible primary model:
    // the backend strips per the real effective model, so the client must not
    // wipe the stored params.
    expect(paramsChangesForModelSwitch(models, null, '', params)).toBeUndefined();
  });

  it('leaves params untouched when the target is missing from the list', () => {
    expect(paramsChangesForModelSwitch(models, 'gone-id', 'primary-id', params)).toBeUndefined();
  });
});

describe('memoryScopeForChannel', () => {
  it('routes a 1:1 agent DM to the personal scope', () => {
    expect(
      memoryScopeForChannel({ isAgentDm: true, channelType: 'DIRECT' }, 'ch-1'),
    ).toEqual({ scope: MemoryScope.USER });
  });

  it('routes a group agent DM to the channel scope', () => {
    expect(
      memoryScopeForChannel({ isAgentDm: true, channelType: 'GROUP_DM' }, 'ch-1'),
    ).toEqual({ scope: MemoryScope.CHANNEL, subjectId: 'ch-1' });
  });

  it('routes non-agent-DM channels to the channel scope', () => {
    expect(
      memoryScopeForChannel({ isAgentDm: false, channelType: 'DIRECT' }, 'ch-1'),
    ).toEqual({ scope: MemoryScope.CHANNEL, subjectId: 'ch-1' });
    expect(memoryScopeForChannel(undefined, 'ch-1')).toEqual({
      scope: MemoryScope.CHANNEL,
      subjectId: 'ch-1',
    });
  });
});

describe('model picker popover surface', () => {
  it('hosts no params UI; that belongs to AgentParamsPopover', () => {
    const source = readFileSync(
      new URL('../AgentModelPicker.tsx', import.meta.url),
      'utf8',
    );
    expect(source.includes('ModelParamsSection')).toBe(false);
  });
});

