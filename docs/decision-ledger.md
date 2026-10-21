# factory-twin — decision ledger

- 2026-10-21 · standards · tests assert against the real demo dataset in src/data, not a frozen copy; rule boundaries use small inline plants in tests/rules.test.ts — the recordings and README figures describe exactly this data, so a data change must fail the suite · self
- 2026-10-21 · spec · recordings are scripted, not captured live: tool results come from the real tools, the answer text is written by hand (no API key in this environment); `npm run record` replaces them with live captures and `source`/`model` in each file say which is which · self
- 2026-10-21 · spec · live mode runs as middleware inside the Vite dev server (`vite --mode live`) instead of a second process — one command, still a Node server on localhost holding the key; the browser only sees /api/chat · self
- 2026-10-21 · standards · tool inputs are checked by hand-written validators instead of `strict: true` or zod — keeps src/agent free of the SDK and zod so the static bundle stays small; invalid input goes back to Claude as is_error · self
- 2026-10-21 · spec · demo is bilingual (EN/PL recordings, `?lang=`); the plant clock is fixed at 2026-10-21T10:00 so every number is reproducible · self
- 2026-10-21 · standards · `@typescript-eslint/no-non-null-assertion` is off under tests/ only · self
- 2026-10-21 · standards · flow-tdd followed by hand: no tiller profile exists for personal-brand yet, so verify-claim could not run; gates were run directly · self
