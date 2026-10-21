// Records the scenarios against the real Claude API: `npm run record [-- --only <id>] [-- --lang pl]`.
// Needs ANTHROPIC_API_KEY in .env. Overwrites src/recordings/<lang>/<id>.json with source "live".
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadDatasetFromDisk } from '../server/dataset-node';
import { loadScenarios, recordingsDir } from '../server/recordings';
import { runAgentTurn } from '../server/agent';
import { createClient, liveModel } from '../server/live-client';
import { toSceneActions } from '../src/agent/actions';
import type { Recording } from '../src/agent/transcript';
import { isLang, LANGS } from '../src/domain/langs';
import type { Lang } from '../src/domain/types';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: { only: { type: 'string' }, lang: { type: 'string' } } });
if (values.lang !== undefined && !isLang(values.lang))
  throw new Error(`--lang must be one of ${LANGS.join(', ')}`);
const langs: readonly Lang[] = values.lang ? [values.lang] : LANGS;
const scenarios = loadScenarios().filter((s) => !values.only || s.id === values.only);
if (scenarios.length === 0) throw new Error(`No scenario ${values.only}`);

const client = createClient();
const ds = loadDatasetFromDisk();

for (const scenario of scenarios) {
  for (const lang of langs) {
    const turn = await runAgentTurn({
      client,
      dataset: ds,
      question: scenario.question[lang],
      lang,
      history: [],
      model: liveModel(),
    });
    const recording: Recording = {
      schemaVersion: 1,
      id: scenario.id,
      lang,
      order: scenario.order,
      title: scenario.title[lang],
      source: 'live',
      model: turn.model,
      question: scenario.question[lang],
      steps: turn.transcript.steps,
    };
    const actions = toSceneActions(ds, recording.steps);
    if (actions.length === 0)
      console.warn(`warn   ${lang}/${scenario.id}: no scene action; consider re-recording`);
    const dir = new URL(`${lang}/`, recordingsDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(`${scenario.id}.json`, dir), JSON.stringify(recording, null, 2) + '\n');
    console.info(
      `record ${lang}/${scenario.id}.json (${turn.model}, ${recording.steps.length} steps)`,
    );
  }
}
