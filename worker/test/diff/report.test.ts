import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { explanationPatterns, writeReport } from './report';

describe('explanationPatterns', () => {
  it('reads backticked globs from bullets, not from comments or prose', () => {
    const patterns = explanationPatterns(
      [
        '## Explanations',
        '<!-- - `GET /ignored [*] $.x`: example inside a comment -->',
        'Prose with `GET /not-a-bullet` is ignored too.',
        '- `GET /api/v1/posts* [*] $.data[*].views`: counted by RL_VIEW (D7).',
        '<!-- unclosed - `GET /also-ignored`',
      ].join('\n'),
    );

    expect(patterns).toHaveLength(1);
    expect(patterns[0].test('GET /api/v1/posts?page=2 [en anon] $.data[3].views')).toBe(true);
    expect(patterns[0].test('GET /api/v1/posts [en anon] $.data[3].title')).toBe(false);
  });
});

describe('writeReport', () => {
  it('keeps the Explanations section and counts only unexplained diffs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-report-'));
    const result = {
      group: 'g',
      scenarios: 0,
      skipped: [],
      exchanges: [
        { label: 'GET /a|b [- anon]', statusA: 200, statusB: 200, diffs: [{ field: '$.x', a: '1', b: '2' }] },
        { label: 'GET /c [- anon]', statusA: 200, statusB: 200, diffs: [] },
      ],
    };

    expect(writeReport(result, dir, 'test data')).toMatchObject({ requests: 2, same: 1, diffs: 1, unexplained: 1 });
    const file = path.join(dir, 'g.md');
    expect(fs.readFileSync(file, 'utf8')).toContain('`GET /a\\|b [- anon] $.x`');

    fs.appendFileSync(file, '- `GET /a|b [*] $.x`: known.\n');
    expect(writeReport(result, dir, 'test data').unexplained).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('- `GET /a|b [*] $.x`: known.');
  });
});
