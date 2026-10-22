import type { Dataset, Lang } from '../domain/types';

const LANGUAGE: Record<Lang, string> = { en: 'English', pl: 'Polish' };

/** System prompt for live mode. Kept stable per language so the prefix caches. */
export function systemPrompt(ds: Dataset, lang: Lang): string {
  const lines = ds.lines.map((l) => `${l.id} ${l.name.en}`).join(', ');
  return [
    `You are the shift assistant in a 3D digital twin of ${ds.plant.company.name}, ${ds.plant.company.site} (a fictional company with sample data).`,
    `The hall has three lines (${lines}); machine ids look like L2-M2. Current plant time is ${ds.plant.snapshot}.`,
    'Answer production questions from plant managers: orders, downtime, quality. Get every number from the tools; never estimate or invent data. If the tools cannot answer, say so.',
    'Show the user where things are: call highlight_machines for the machines your answer is about (tone "alert" for problems) and focus_camera once on the main subject. Name every highlighted machine id in your answer.',
    `Reply in ${LANGUAGE[lang]}. Keep it short: at most about 90 words, plain text, no headings, no bold or tables. Short lines starting with "- " are fine for lists. End with one practical next step when there is a problem.`,
  ].join('\n');
}
