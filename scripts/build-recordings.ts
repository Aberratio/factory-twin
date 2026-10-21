// Regenerates src/recordings/<lang>/<id>.json from scenarios/*.json without calling any model.
// Tool results come from the real tools; a recording captured live (`npm run record`) is kept.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadDatasetFromDisk } from '../server/dataset-node';
import { buildScriptedRecording, loadScenarios, recordingsDir } from '../server/recordings';
import { LANGS } from '../src/domain/langs';

const ds = loadDatasetFromDisk();
let written = 0;
for (const scenario of loadScenarios()) {
  for (const lang of LANGS) {
    const dir = new URL(`${lang}/`, recordingsDir);
    mkdirSync(dir, { recursive: true });
    const file = new URL(`${scenario.id}.json`, dir);
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).source === 'live') {
      console.info(`keep   ${lang}/${scenario.id}.json (live recording)`);
      continue;
    }
    writeFileSync(file, JSON.stringify(buildScriptedRecording(scenario, lang, ds), null, 2) + '\n');
    written++;
    console.info(`write  ${lang}/${scenario.id}.json`);
  }
}
console.info(`${written} recording(s) written`);
