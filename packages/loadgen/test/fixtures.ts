import { readFileSync } from 'node:fs';
// The shape tests use the stress profile (today's first-live-run traffic); the committed default
// is the calm profile, asserted separately in config.test.ts to stay near two transfers an hour.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLoadgenConfig, type LoadgenConfig } from '../src/index.js';

/** The committed default profile — the tests pin its properties, not a toy copy of it. */
export function defaultConfig(): LoadgenConfig {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'loadgen.stress.config.json');
  return parseLoadgenConfig(JSON.parse(readFileSync(path, 'utf8')));
}
