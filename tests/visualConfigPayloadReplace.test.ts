import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { useVisualConfig, getPayloadReplaceValidationError } from '../src/hooks/useVisualConfig';
import { ConfigDraftConflictError } from '../src/services/api/configPatch';
import type { VisualConfigValues } from '../src/types/visualConfig';

function unwrapPre(markup: string): string {
  return markup
    .slice('<pre>'.length, -'</pre>'.length)
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function applyPayloadEdit(
  yaml: string,
  edit: (values: VisualConfigValues) => Partial<VisualConfigValues>
): string {
  function Harness() {
    const visualConfig = useVisualConfig();
    const [phase, setPhase] = useState(0);

    if (phase === 0) {
      visualConfig.loadVisualValuesFromYaml(yaml);
      setPhase(1);
    } else if (phase === 1) {
      visualConfig.setVisualValues(edit(visualConfig.visualValues));
      setPhase(2);
    } else {
      return createElement('pre', null, visualConfig.applyVisualChangesToYaml(yaml));
    }
    return null;
  }

  return unwrapPre(renderToStaticMarkup(createElement(Harness)));
}

function parseVisualValuesFromYaml(yaml: string): VisualConfigValues {
  let result!: VisualConfigValues;
  function Harness() {
    const config = useVisualConfig();
    const [loaded, setLoaded] = useState(false);
    if (!loaded) {
      config.loadVisualValuesFromYaml(yaml);
      setLoaded(true);
    } else result = config.visualValues;
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

const yaml = `requests:
  payload:
    replace:
      # rule-comment
      - models:
          - name: '*'
            future-model: keep
        future-rule: keep
        target:
          role: user
          positions: [1, 2]
          future-target: keep
        replacements:
          # first-entry
          - ' a ': ' b '
          # second-entry
          - __proto__: ''
`;

describe('payload replace pipeline', () => {
  test('preserves literal operands, order, comments and unknown fields', () => {
    const output = applyPayloadEdit(yaml, (values) => {
      const rule = values.payloadReplaceRules[0];
      return {
        payloadReplaceRules: [
          {
            ...rule,
            target: { ...rule.target, all: true, positions: '' },
            replacements: [rule.replacements[1], { ...rule.replacements[0], to: '  edited  ' }],
          },
        ],
      };
    });
    const rule = parseYaml(output).requests.payload.replace[0];
    expect(rule.replacements).toEqual([JSON.parse('{"__proto__":""}'), { ' a ': '  edited  ' }]);
    expect(rule.target).toEqual({ role: 'user', all: true, 'future-target': 'keep' });
    expect(rule['future-rule']).toBe('keep');
    expect(rule.models[0]['future-model']).toBe('keep');
    expect(output).toContain('# first-entry');
    expect(output).toContain('# second-entry');
    expect(output.indexOf('# second-entry')).toBeLessThan(output.indexOf('# first-entry'));
    expect(
      getPayloadReplaceValidationError(parseVisualValuesFromYaml(output).payloadReplaceRules[0])
    ).toBeUndefined();
  });

  test('removes section when cleared and leaves unrelated changes untouched', () => {
    expect(
      parseYaml(applyPayloadEdit(yaml, () => ({ payloadReplaceRules: [] }))).requests?.payload
        ?.replace
    ).toBeUndefined();
    const output = applyPayloadEdit(yaml, () => ({ debug: true }));
    expect(parseYaml(output).requests.payload.replace).toEqual(
      parseYaml(yaml).requests.payload.replace
    );
  });

  test.each([
    yaml.replace('positions: [1, 2]', 'positions: ["1", 2]'),
    yaml.replace('positions: [1, 2]', 'positions: [1.5]'),
    yaml.replace('positions: [1, 2]', 'positions: [1.0]'),
    yaml.replace('positions: [1, 2]', 'positions: [1e0]'),
    yaml.replace('positions: [1, 2]', 'positions: [!!float 1]'),
    ...['1', 'true', 'false', 'null', '[a, b]', '!!int 1'].map((key) =>
      yaml.replace("- ' a ': ' b '", `- ${key}: ' b '`)
    ),
    ...[
      'operand: &operand 1',
      'operand: &operand !!int 1',
      'operand: &operand 1.0',
      'operand: &operand true',
      'operand: &operand null',
      `operand: &operand [a, b]`,
      `operand: &operand !custom hello`,
    ].flatMap((anchor) => [
      `${anchor}\n${yaml.replace("- ' a ': ' b '", "- *operand : ' b '")}`,
      `${anchor}\n${yaml.replace("- ' a ': ' b '", "- ' a ': *operand")}`,
    ]),
    `k: &k 123\n${yaml.replace("- ' a ': ' b '", "- *k : 'foo'\n            replacement: 'bar'")}`,
    `v: &v 123\n${yaml.replace("- ' a ': ' b '", "- pattern: *v\n            replacement: 'bar'")}`,
    `v: &v false\n${yaml.replace("- ' a ': ' b '", "- pattern: 'foo'\n            replacement: *v")}`,
    `k1: &k1 pattern\n${yaml.replace("- ' a ': ' b '", "- *k1 : 'foo'\n            pattern: 'bar'")}`,
    `k1: &k1 pattern\nk2: &k2 extra\n${yaml.replace("- ' a ': ' b '", "- *k1 : 'foo'\n            *k2 : 'bar'")}`,
    `position: &position 1.0\n${yaml.replace('positions: [1, 2]', 'positions: [*position]')}`,
    yaml.replace("- ' a ': ' b '", "- ' a ': 12"),
    yaml.replace("- ' a ': ' b '", "- ' a ': ' b '\n            extra: entry"),
    yaml.replace("name: '*'", 'name: 123'),
    'requests: {payload: {replace: wrong}}',
  ])('keeps malformed input invalid until explicitly repaired', (source) => {
    const rule = parseVisualValuesFromYaml(source).payloadReplaceRules[0];
    expect(rule.invalid).toBe(true);
    expect(getPayloadReplaceValidationError(rule)).toBeDefined();
    expect(() => applyPayloadEdit(source, () => ({ debug: true }))).toThrow();
  });

  test('quoted sources, duplicate sources and positions survive serialize/reparse in order', () => {
    const source = yaml
      .replace('positions: [1, 2]', 'positions: [2, 1, 2]')
      .replace("- ' a ': ' b '", "- '1': 'true'\n          - '1': ''\n          - 'true': 'false'");
    const output = applyPayloadEdit(source, (values) => ({
      payloadReplaceRules: values.payloadReplaceRules.map((rule) => ({
        ...rule,
        replacements: [...rule.replacements].reverse(),
      })),
    }));
    const reparsed = parseVisualValuesFromYaml(output).payloadReplaceRules[0];
    expect(getPayloadReplaceValidationError(reparsed)).toBeUndefined();
    expect(reparsed.target.positions).toBe('2, 1, 2');
    expect(reparsed.replacements.map(({ from, to }) => [from, to])).toEqual([
      ['__proto__', ''],
      ['true', 'false'],
      ['1', ''],
      ['1', 'true'],
    ]);
    expect(parseYaml(applyPayloadEdit(output, () => ({ debug: true }))).requests).toEqual(
      parseYaml(output).requests
    );
  });

  test('accepts explicit string operands and integer position aliases', () => {
    const source = `position: &position 1\n${yaml
      .replace('positions: [1, 2]', 'positions: [*position, !!int 2]')
      .replace("- ' a ': ' b '", '- !!str true: !!str 1')}`;
    const rule = parseVisualValuesFromYaml(source).payloadReplaceRules[0];
    expect(getPayloadReplaceValidationError(rule)).toBeUndefined();
    expect(rule.replacements[0].from).toBe('true');
  });

  test('rebase retains replacement order and concurrent unrelated changes on retry', () => {
    const draft = applyPayloadEdit(yaml, (values) => ({
      payloadReplaceRules: values.payloadReplaceRules.map((rule) => ({
        ...rule,
        replacements: [...rule.replacements].reverse(),
      })),
    }));
    const latest = `server: {port: 9000}\n${yaml}`;
    let output = '';
    function Harness() {
      const config = useVisualConfig();
      const [phase, setPhase] = useState(0);
      if (phase === 0) {
        config.loadVisualValuesFromYaml(yaml);
        setPhase(1);
      } else if (phase === 1) {
        expect(config.rebaseVisualValuesFromYaml(latest, `server: {port: 9000}\n${draft}`)).toEqual(
          { ok: true }
        );
        setPhase(2);
      } else {
        output = config.applyVisualChangesToYaml(latest);
        expect(config.applyVisualChangesToYaml(latest)).toBe(output);
      }
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    expect(parseYaml(output).server.port).toBe(9000);
    expect(parseYaml(output).requests).toEqual(parseYaml(draft).requests);
    expect(output.indexOf('# second-entry')).toBeLessThan(output.indexOf('# first-entry'));
  });

  test.each(['system', 'developer'])('loads and saves %s role targets', (role) => {
    const source = yaml.replace('role: user', `role: ${role}`);
    const output = applyPayloadEdit(source, (values) => {
      const rule = values.payloadReplaceRules[0];
      expect(getPayloadReplaceValidationError(rule)).toBeUndefined();
      return { payloadReplaceRules: [{ ...rule, target: { role, all: true, positions: '' } }] };
    });
    expect(parseYaml(output).requests.payload.replace[0].target).toEqual({
      role,
      all: true,
      'future-target': 'keep',
    });
  });

  test('switches target modes without leaking inactive fields and preserves exact paths', () => {
    const paths = ['tools.#(type=="function")#.description', 'metadata. description ', '1'];
    const output = applyPayloadEdit(yaml, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [{ ...rule, target: { role: '', positions: '', all: false, paths } }],
    }));
    expect(parseYaml(output).requests.payload.replace[0].target).toEqual({
      paths,
      'future-target': 'keep',
    });
    const back = applyPayloadEdit(output, ({ payloadReplaceRules: [rule] }) => {
      expect(rule.target.paths).toEqual(paths);
      expect(getPayloadReplaceValidationError(rule)).toBeUndefined();
      return {
        payloadReplaceRules: [{ ...rule, target: { role: 'system', positions: '2', all: false } }],
      };
    });
    expect(parseYaml(back).requests.payload.replace[0].target).toEqual({
      role: 'system',
      positions: [2],
      all: false,
      'future-target': 'keep',
    });
  });

  test('preserves path comments, aliases, and Go RE2 entries while editing', () => {
    const source = `path: &path metadata.description
${yaml
  .replace(
    'role: user\n          positions: [1, 2]',
    `paths:
            # path-comment
            - *path`
  )
  .replace(
    "- ' a ': ' b '",
    `- pattern: '(?i)(foo)'
            replacement: '$1'`
  )}`;
    const output = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => {
      expect(rule.replacements[0]).toMatchObject({ regex: true, from: '(?i)(foo)', to: '$1' });
      return {
        payloadReplaceRules: [
          {
            ...rule,
            target: { ...rule.target, paths: [...rule.target.paths!, 'metadata.title'] },
            replacements: [rule.replacements[1], { ...rule.replacements[0], to: '' }],
          },
        ],
      };
    });
    const rule = parseYaml(output).requests.payload.replace[0];
    expect(rule.target.paths).toEqual(['metadata.description', 'metadata.title']);
    expect(rule.replacements).toEqual([
      JSON.parse('{"__proto__":""}'),
      { pattern: '(?i)(foo)', replacement: '' },
    ]);
    expect(output).toContain('# path-comment');
    expect(output).toContain('- *path');
  });

  test.each(['[]', '[" "]', '[1]', 'metadata.description', '[true]'])(
    'rejects invalid paths: %s',
    (paths) => {
      const source = yaml.replace('role: user\n          positions: [1, 2]', `paths: ${paths}`);
      const rule = parseVisualValuesFromYaml(source).payloadReplaceRules[0];
      expect(getPayloadReplaceValidationError(rule)).toBe('payload_replace_invalid_paths');
      expect(() => applyPayloadEdit(source, () => ({ debug: true }))).toThrow();
    }
  );

  test.each(['role: system', 'all: true', 'positions: [1]'])(
    'rejects mixed path and role targets: %s',
    (selector) => {
      const source = yaml.replace(
        'role: user\n          positions: [1, 2]',
        `paths: [metadata.description]
          ${selector}`
      );
      const rule = parseVisualValuesFromYaml(source).payloadReplaceRules[0];
      expect(getPayloadReplaceValidationError(rule)).toBe('payload_replace_invalid_paths');
      expect(rule.invalid).toBe(true);
    }
  );

  test('validates drafts and model conditions', () => {
    const rule = parseVisualValuesFromYaml(yaml).payloadReplaceRules[0];
    expect(getPayloadReplaceValidationError(rule)).toBeUndefined();
    expect(
      getPayloadReplaceValidationError({ ...rule, target: { ...rule.target, positions: '1,,2' } })
    ).toBe('payload_replace_invalid_positions');
    expect(
      getPayloadReplaceValidationError({ ...rule, target: { ...rule.target, role: 'assistant' } })
    ).toBe('payload_replace_invalid_target');
    expect(getPayloadReplaceValidationError({ ...rule, replacements: [] })).toBe(
      'payload_replace_invalid_replacements'
    );
    expect(
      getPayloadReplaceValidationError({
        ...rule,
        models: [
          { ...rule.models[0], match: [{ id: 'c', path: 'x', valueType: 'json', value: '{' }] },
        ],
      })
    ).toBe('payload_replace_invalid_models');
  });

  test('accepts YAML string scalar aliases for literal and regex replacements and preserves references on unrelated edits', () => {
    const source = `k_from: &k_from " a "
v_to: &v_to !!str 1
k_pat: &k_pat pattern
k_rep: &k_rep replacement
v_pat: &v_pat '(?i)foo'
v_rep: &v_rep !!str true
${yaml.replace(
  "- ' a ': ' b '",
  `- *k_from : *v_to
          - *k_pat : *v_pat
            *k_rep : *v_rep
          - *k_pat : 'literal-pattern'`
)}`;
    const parsed = parseVisualValuesFromYaml(source).payloadReplaceRules[0];
    expect(parsed.invalid).toBeUndefined();
    expect(getPayloadReplaceValidationError(parsed)).toBeUndefined();
    expect(parsed.replacements.map(({ from, to, regex }) => ({ from, to, regex }))).toEqual([
      { from: ' a ', to: '1', regex: undefined },
      { from: '(?i)foo', to: 'true', regex: true },
      { from: 'pattern', to: 'literal-pattern', regex: undefined },
      { from: '__proto__', to: '', regex: undefined },
    ]);

    const output = applyPayloadEdit(source, () => ({ debug: true }));
    expect(parseYaml(output).observability.logs.debug).toBe(true);
    expect(output).toContain('*k_from');
    expect(output).toContain('*v_to');
    expect(output).toContain('*k_pat');
    expect(output).toContain('*k_rep');
    expect(output).toContain('*v_pat');
    expect(output).toContain('*v_rep');
    expect(parseYaml(output).requests.payload.replace).toEqual(
      parseYaml(source).requests.payload.replace
    );
  });

  test('preserves unchanged replacement references and node style when editing nearby rules or operands', () => {
    const source = `k_from: &k_from "from-text"
v_to: &v_to "to-text"
k_pat: &k_pat pattern
k_rep: &k_rep replacement
v_pat: &v_pat '(?i)foo'
v_rep: &v_rep '$1'
requests:
  payload:
    replace:
      - models:
          - name: 'first-*'
        target:
          role: user
          positions: [1]
        replacements:
          - *k_from : ' b '
          - ' c ': *v_to
          - *k_pat : *v_pat
            *k_rep : *v_rep
      - models:
          - name: 'second-*'
        target:
          role: system
          all: true
        replacements:
          - ' x ': ' y '
`;
    // 1. Edit only the second rule -> first rule keeps all aliases untouched
    const editedRule2 = applyPayloadEdit(source, ({ payloadReplaceRules }) => ({
      payloadReplaceRules: [
        payloadReplaceRules[0],
        {
          ...payloadReplaceRules[1],
          replacements: [{ ...payloadReplaceRules[1].replacements[0], to: ' z ' }],
        },
      ],
    }));
    expect(editedRule2).toContain('*k_from');
    expect(editedRule2).toContain('*v_to');
    expect(editedRule2).toContain('*k_pat');
    expect(editedRule2).toContain('*k_rep');
    expect(editedRule2).toContain('*v_pat');
    expect(editedRule2).toContain('*v_rep');
    expect(parseYaml(editedRule2).requests.payload.replace[1].replacements).toEqual([
      { ' x ': ' z ' },
    ]);

    // 2. Edit one operand of an aliased entry -> the unedited operand / regex key aliases stay intact
    const editedOperands = applyPayloadEdit(source, ({ payloadReplaceRules }) => {
      const rule0 = payloadReplaceRules[0];
      return {
        payloadReplaceRules: [
          {
            ...rule0,
            replacements: [
              { ...rule0.replacements[0], to: ' edited-b ' },
              { ...rule0.replacements[1], from: ' edited-c ' },
              { ...rule0.replacements[2], to: '$2' },
            ],
          },
          payloadReplaceRules[1],
        ],
      };
    });
    expect(editedOperands).toContain('*k_from');
    expect(editedOperands).toContain('*v_to');
    expect(editedOperands).toContain('*k_pat');
    expect(editedOperands).toContain('*k_rep');
    expect(editedOperands).toContain('*v_pat');
    expect(editedOperands).not.toContain('*v_rep');
    expect(parseYaml(editedOperands).requests.payload.replace[0].replacements).toEqual([
      { 'from-text': ' edited-b ' },
      { ' edited-c ': 'to-text' },
      { pattern: '(?i)foo', replacement: '$2' },
    ]);

    // 3. Editing the aliased operand itself replaces the alias without mutating the anchor
    const editedAliasedOperand = applyPayloadEdit(source, ({ payloadReplaceRules }) => {
      const rule0 = payloadReplaceRules[0];
      return {
        payloadReplaceRules: [
          {
            ...rule0,
            replacements: [
              { ...rule0.replacements[0], from: 'replaced-from' },
              rule0.replacements[1],
              rule0.replacements[2],
            ],
          },
          payloadReplaceRules[1],
        ],
      };
    });
    expect(parseYaml(editedAliasedOperand).k_from).toBe('from-text');
    expect(parseYaml(editedAliasedOperand).requests.payload.replace[0].replacements[0]).toEqual({
      'replaced-from': ' b ',
    });
    expect(editedAliasedOperand).toContain('*v_to');
  });

  test('materializes inline anchors inside payload.replace when defining entry is edited or reordered', () => {
    const source = `requests:
  payload:
    replace:
      - models:
          - name: '*'
        target:
          role: user
          all: true
        replacements:
          - &op 'foo': 'bar'
          - *op : 'baz'
`;
    const reordered = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        { ...rule, replacements: [rule.replacements[1], rule.replacements[0]] },
      ],
    }));
    expect(parseYaml(reordered).requests.payload.replace[0].replacements).toEqual([
      { foo: 'baz' },
      { foo: 'bar' },
    ]);

    const editedAnchor = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [{ ...rule.replacements[0], from: 'qux' }, rule.replacements[1]],
        },
      ],
    }));
    expect(parseYaml(editedAnchor).requests.payload.replace[0].replacements).toEqual([
      { qux: 'bar' },
      { foo: 'baz' },
    ]);
  });

  test('rebase retains alias references and detects concurrent changes on aliased rules', () => {
    const source = `operand: &operand text
${yaml.replace("- ' a ': ' b '", "- *operand : ' b '")}`;
    const draft = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [rule.replacements[0], { ...rule.replacements[1], to: 'edited' }],
        },
      ],
    }));
    const latest = `server: {port: 9000}\n${source}`;
    let output = '';
    function Harness() {
      const config = useVisualConfig();
      const [phase, setPhase] = useState(0);
      if (phase === 0) {
        config.loadVisualValuesFromYaml(source);
        setPhase(1);
      } else if (phase === 1) {
        expect(config.rebaseVisualValuesFromYaml(latest, `server: {port: 9000}\n${draft}`)).toEqual(
          { ok: true }
        );
        setPhase(2);
      } else {
        output = config.applyVisualChangesToYaml(latest);
        expect(() =>
          config.applyVisualChangesToYaml(
            latest.replace("- *operand : ' b '", "- *operand : 'concurrent'")
          )
        ).toThrow(ConfigDraftConflictError);
      }
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    expect(output).toContain('*operand');
    expect(parseYaml(output).server.port).toBe(9000);
    expect(parseYaml(output).requests).toEqual(parseYaml(draft).requests);
  });

  test('preserves block and quoted scalar styles when editing nearby operands or rules', () => {
    const source = `requests:
  payload:
    replace:
      - models:
          - name: '*'
        target:
          role: user
          all: true
        replacements:
          - "double": |-
              line1
              line2
          - 'single': "other"
`;
    const output = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [
            { ...rule.replacements[0], from: 'double-edited' },
            { ...rule.replacements[1], to: 'other-edited' },
          ],
        },
      ],
    }));
    expect(output).toContain('"double-edited": |-');
    expect(output).toContain('\'single\': "other-edited"');
  });

  test('materializes shadowed same-name anchors by node identity instead of anchor name alone', () => {
    const source = `requests:
  payload:
    replace:
      - models:
          - name: '*'
        target:
          role: user
          all: true
        replacements:
          - a: &word red
          - b: &word blue
          - c: *word
`;
    const deletedShadow = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        { ...rule, replacements: [rule.replacements[0], rule.replacements[2]] },
      ],
    }));
    expect(parseYaml(deletedShadow).requests.payload.replace[0].replacements).toEqual([
      { a: 'red' },
      { c: 'blue' },
    ]);
    expect(deletedShadow).toContain('&word');
    expect(parseVisualValuesFromYaml(deletedShadow).payloadReplaceRules[0].replacements).toEqual([
      expect.objectContaining({ from: 'a', to: 'red' }),
      expect.objectContaining({ from: 'c', to: 'blue' }),
    ]);

    const editedShadowValue = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [
            rule.replacements[0],
            { ...rule.replacements[1], to: 'green' },
            rule.replacements[2],
          ],
        },
      ],
    }));
    expect(parseYaml(editedShadowValue).requests.payload.replace[0].replacements).toEqual([
      { a: 'red' },
      { b: 'green' },
      { c: 'blue' },
    ]);

    const editedShadowKey = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [
            rule.replacements[0],
            { ...rule.replacements[1], from: 'b2' },
            rule.replacements[2],
          ],
        },
      ],
    }));
    expect(editedShadowKey).toContain('*word');
    expect(parseYaml(editedShadowKey).requests.payload.replace[0].replacements).toEqual([
      { a: 'red' },
      { b2: 'blue' },
      { c: 'blue' },
    ]);

    const reorderedBeforeShadow = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [rule.replacements[0], rule.replacements[2], rule.replacements[1]],
        },
      ],
    }));
    expect(parseYaml(reorderedBeforeShadow).requests.payload.replace[0].replacements).toEqual([
      { a: 'red' },
      { c: 'blue' },
      { b: 'blue' },
    ]);

    const reorderedCrossedShadow = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [rule.replacements[1], rule.replacements[0], rule.replacements[2]],
        },
      ],
    }));
    expect(parseYaml(reorderedCrossedShadow).requests.payload.replace[0].replacements).toEqual([
      { b: 'blue' },
      { a: 'red' },
      { c: 'blue' },
    ]);

    const reorderedKeepingBinding = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [rule.replacements[1], rule.replacements[2], rule.replacements[0]],
        },
      ],
    }));
    expect(reorderedKeepingBinding).toContain('*word');
    expect(parseYaml(reorderedKeepingBinding).requests.payload.replace[0].replacements).toEqual([
      { b: 'blue' },
      { c: 'blue' },
      { a: 'red' },
    ]);

    const withEarlierAlias = source.replace(
      '          - a: &word red\n',
      '          - a: &word red\n          - keep: *word\n'
    );
    const deletedWithEarlierAlias = applyPayloadEdit(
      withEarlierAlias,
      ({ payloadReplaceRules: [rule] }) => ({
        payloadReplaceRules: [
          {
            ...rule,
            replacements: [rule.replacements[0], rule.replacements[1], rule.replacements[3]],
          },
        ],
      })
    );
    expect(deletedWithEarlierAlias).toContain('keep: *word');
    expect(parseYaml(deletedWithEarlierAlias).requests.payload.replace[0].replacements).toEqual([
      { a: 'red' },
      { keep: 'red' },
      { c: 'blue' },
    ]);
  });

  test('detaches edited anchored replacement mappings without mutating aliased entries', () => {
    const source = `requests:
  payload:
    replace:
      - models:
          - name: '*'
        target:
          role: user
          all: true
        replacements:
          - &pair {token: initial}
          - *pair
`;
    const editedValue = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [{ ...rule.replacements[0], to: 'edited' }, rule.replacements[1]],
        },
      ],
    }));
    expect(parseYaml(editedValue).requests.payload.replace[0].replacements).toEqual([
      { token: 'edited' },
      { token: 'initial' },
    ]);
    expect(parseVisualValuesFromYaml(editedValue).payloadReplaceRules[0].replacements).toEqual([
      expect.objectContaining({ from: 'token', to: 'edited' }),
      expect.objectContaining({ from: 'token', to: 'initial' }),
    ]);

    const editedKey = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [{ ...rule.replacements[0], from: 'renamed' }, rule.replacements[1]],
        },
      ],
    }));
    expect(parseYaml(editedKey).requests.payload.replace[0].replacements).toEqual([
      { renamed: 'initial' },
      { token: 'initial' },
    ]);

    const toggledRegex = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [{ ...rule.replacements[0], regex: true }, rule.replacements[1]],
        },
      ],
    }));
    expect(parseYaml(toggledRegex).requests.payload.replace[0].replacements).toEqual([
      { pattern: 'token', replacement: 'initial' },
      { token: 'initial' },
    ]);

    const editedAlias = applyPayloadEdit(source, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [rule.replacements[0], { ...rule.replacements[1], to: 'edited' }],
        },
      ],
    }));
    expect(editedAlias).toContain('&pair');
    expect(parseYaml(editedAlias).requests.payload.replace[0].replacements).toEqual([
      { token: 'initial' },
      { token: 'edited' },
    ]);

    const regexSource = source.replace(
      '          - &pair {token: initial}\n          - *pair',
      '          - &rx {pattern: foo, replacement: initial}\n          - *rx'
    );
    const editedRegexAnchor = applyPayloadEdit(regexSource, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [{ ...rule.replacements[0], to: 'edited' }, rule.replacements[1]],
        },
      ],
    }));
    expect(parseYaml(editedRegexAnchor).requests.payload.replace[0].replacements).toEqual([
      { pattern: 'foo', replacement: 'edited' },
      { pattern: 'foo', replacement: 'initial' },
    ]);

    const withExtraEntry = `${source}          - other: plain\n`;
    const editedNearby = applyPayloadEdit(withExtraEntry, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [
        {
          ...rule,
          replacements: [
            rule.replacements[0],
            rule.replacements[1],
            { ...rule.replacements[2], to: 'updated' },
          ],
        },
      ],
    }));
    expect(editedNearby).toContain('&pair');
    expect(editedNearby).toContain('*pair');
    expect(parseYaml(editedNearby).requests.payload.replace[0].replacements).toEqual([
      { token: 'initial' },
      { token: 'initial' },
      { other: 'updated' },
    ]);
  });

  test('detaches other changed anchored nodes in payload.replace without mutating aliases', () => {
    const sharedTargets = `requests:
  payload:
    replace:
      - &rule1
        models: &mods
          - &mod1
            name: '*'
        target: &tgt
          role: user
          all: &all true
        replacements: &reps
          - token: initial
      - models: *mods
        target: *tgt
        replacements: *reps
      - *rule1
`;
    const editedRule1Replacement = applyPayloadEdit(sharedTargets, ({ payloadReplaceRules }) => ({
      payloadReplaceRules: [
        {
          ...payloadReplaceRules[0],
          replacements: [{ ...payloadReplaceRules[0].replacements[0], to: 'edited' }],
        },
        payloadReplaceRules[1],
        payloadReplaceRules[2],
      ],
    }));
    const parsedAfterRepEdit = parseYaml(editedRule1Replacement).requests.payload.replace;
    expect(parsedAfterRepEdit[0].replacements).toEqual([{ token: 'edited' }]);
    expect(parsedAfterRepEdit[1].replacements).toEqual([{ token: 'initial' }]);
    expect(parsedAfterRepEdit[2].replacements).toEqual([{ token: 'initial' }]);
    expect(parsedAfterRepEdit[1].target).toEqual({ role: 'user', all: true });
    expect(editedRule1Replacement).toContain('&tgt');
    expect(editedRule1Replacement).toContain('target: *tgt');

    const editedTargetAndModel = applyPayloadEdit(sharedTargets, ({ payloadReplaceRules }) => ({
      payloadReplaceRules: [
        {
          ...payloadReplaceRules[0],
          models: [{ ...payloadReplaceRules[0].models[0], name: 'gpt-*' }],
          target: { role: 'system', all: false, positions: '2' },
        },
        payloadReplaceRules[1],
        payloadReplaceRules[2],
      ],
    }));
    const parsedAfterTargetEdit = parseYaml(editedTargetAndModel).requests.payload.replace;
    expect(parsedAfterTargetEdit[0].models).toEqual([{ name: 'gpt-*' }]);
    expect(parsedAfterTargetEdit[0].target).toEqual({
      role: 'system',
      all: false,
      positions: [2],
    });
    expect(parsedAfterTargetEdit[1].models).toEqual([{ name: '*' }]);
    expect(parsedAfterTargetEdit[1].target).toEqual({ role: 'user', all: true });
    expect(parsedAfterTargetEdit[2].models).toEqual([{ name: '*' }]);
    expect(parsedAfterTargetEdit[2].target).toEqual({ role: 'user', all: true });

    const pathsSource = `requests:
  payload:
    replace:
      - models:
          - name: '*'
        target:
          paths: &p
            - a.b
        replacements:
          - a: &x initial
          - &pair {token: *x}
          - *pair
      - models:
          - name: 'gpt-*'
        target:
          paths: *p
        replacements:
          - k: v
`;
    const editedPathsAndNestedAlias = applyPayloadEdit(pathsSource, ({ payloadReplaceRules }) => ({
      payloadReplaceRules: [
        {
          ...payloadReplaceRules[0],
          target: { role: '', all: false, positions: '', paths: ['a.b', 'c.d'] },
          replacements: [
            { ...payloadReplaceRules[0].replacements[1], from: 'edited' },
            payloadReplaceRules[0].replacements[2],
          ],
        },
        payloadReplaceRules[1],
      ],
    }));
    const parsedPaths = parseYaml(editedPathsAndNestedAlias).requests.payload.replace;
    expect(parsedPaths[0].target.paths).toEqual(['a.b', 'c.d']);
    expect(parsedPaths[1].target.paths).toEqual(['a.b']);
    expect(parsedPaths[0].replacements).toEqual([{ edited: 'initial' }, { token: 'initial' }]);
  });

  test('preserves anchored filter model names and root alias propagation outside payload.replace', () => {
    const source = `requests:
  payload:
    filter:
      - models:
          - name: &model old
        params:
          - thinking
mirror: *model
`;
    const output = applyPayloadEdit(source, ({ payloadFilterRules }) => ({
      payloadFilterRules: [
        {
          ...payloadFilterRules[0],
          models: [{ ...payloadFilterRules[0].models[0], name: 'new' }],
        },
      ],
    }));
    expect(output).toContain('name: &model');
    expect(output).toContain('mirror: *model');
    expect(parseYaml(output).requests.payload.filter[0].models[0].name).toBe('new');
    expect(parseYaml(output).mirror).toBe('new');
    expect(parseVisualValuesFromYaml(output).payloadFilterRules[0].models[0].name).toBe('new');
  });
});
