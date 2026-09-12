import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLoadgenConfig, type LoadgenConfig } from '../src/index.js';

/** The committed default profile — the tests pin its properties, not a toy copy of it. */
export function defaultConfig(): LoadgenConfig {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'loadgen.config.json');
  return parseLoadgenConfig(JSON.parse(readFileSync(path, 'utf8')));
}
