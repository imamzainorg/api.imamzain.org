import fs from 'node:fs';
import path from 'node:path';
import type { Diff } from './compare';

export interface Exchange {
  /** `GET /api/v1/health [ar admin]`: stable across runs, so explanations can name it. */
  label: string;
  statusA: number;
  statusB: number;
  diffs: Diff[];
}

export interface GroupResult {
  group: string;
  exchanges: Exchange[];
  /** Routes the corpus could not cover (a path parameter without a sampler). */
  skipped: string[];
  scenarios: number;
}

export interface Summary {
  requests: number;
  same: number;
  diffs: number;
  unexplained: number;
  report: string;
}

const EXPLANATIONS = '## Explanations';

const EXPLANATIONS_TEMPLATE = `${EXPLANATIONS}

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, \`*\` matching anything, then why. Example:
- \`GET /api/v1/posts* [*] $.data[*].views\`: views are counted by the RL_VIEW binding now (D7).
-->
`;

const key = (label: string, d: Diff) => `${label} ${d.field}`;

/** The text outside `<!-- … -->` comments (an unclosed one runs to the end). */
function outsideComments(s: string): string {
  return s
    .split('<!--')
    .map((part, i) => {
      if (i === 0) return part;
      const end = part.indexOf('-->');
      return end < 0 ? '' : part.slice(end + 3);
    })
    .join('');
}

/** Backticked globs from the explanation bullets. */
export function explanationPatterns(section: string): RegExp[] {
  const body = outsideComments(section);
  return [...body.matchAll(/^\s*[-*]\s.*$/gm)].flatMap((line) =>
    [...line[0].matchAll(/`([^`]+)`/g)].map(
      (m) => new RegExp(`^${m[1].split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`),
    ),
  );
}

/**
 * A GFM table cell. Only `|` needs escaping: the table parser turns `\|` back into `|` before the code
 * span is read, and a code span keeps every other backslash as it is.
 */
const cell = (s: string) => s.split('|').join('\\|').split('\n').join(' ');

/** Writes reports/<group>.md (keeping its Explanations section) and returns the counts for the console line. */
export function writeReport(result: GroupResult, dir: string, source: string): Summary {
  const file = path.join(dir, `${result.group}.md`);
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const at = previous.indexOf(EXPLANATIONS);
  const explanations = at >= 0 ? previous.slice(at) : EXPLANATIONS_TEMPLATE;
  const patterns = explanationPatterns(explanations);
  const explained = (k: string) => patterns.some((p) => p.test(k));

  const all = result.exchanges.flatMap((e) => e.diffs.map((d) => ({ k: key(e.label, d), d })));
  const unexplained = all.filter(({ k }) => !explained(k));
  const same = result.exchanges.filter((e) => e.diffs.length === 0).length;

  const lines = [
    `# Diff report: ${result.group}`,
    '',
    `Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on ${source}.`,
    `Regenerate with \`npm run diff -- ${result.group}\` in \`worker/\`.`,
    '',
    `- Requests: ${result.exchanges.length} (${result.scenarios} write scenario${result.scenarios === 1 ? '' : 's'})`,
    `- Same: ${same}`,
    `- Diffs: ${all.length}, unexplained: ${unexplained.length}`,
    `- Routes skipped: ${result.skipped.length}`,
    '',
    '## Requests',
    '',
    '| Request | A | B | Result |',
    '|---|---|---|---|',
    ...result.exchanges.map((e) => `| \`${cell(e.label)}\` | ${e.statusA} | ${e.statusB} | ${e.diffs.length === 0 ? 'same' : `${e.diffs.length} diff${e.diffs.length === 1 ? '' : 's'}`} |`),
    '',
  ];
  if (result.skipped.length) lines.push('## Skipped routes', '', ...result.skipped.map((s) => `- ${s}`), '');
  if (all.length) {
    lines.push('## Diffs', '', '| Key | A | B | Explained |', '|---|---|---|---|');
    for (const { k, d } of all) lines.push(`| \`${cell(k)}\` | \`${cell(d.a)}\` | \`${cell(d.b)}\` | ${explained(k) ? 'yes' : '**no**'} |`);
    lines.push('');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n${explanations.trimEnd()}\n`);
  return { requests: result.exchanges.length, same, diffs: all.length, unexplained: unexplained.length, report: file };
}
