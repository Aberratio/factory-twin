# Architecture notes

The technical choices behind Factory Twin, and why they were made. The README has the overview;
this page covers the reasoning.

## One transcript, two sources

An answer is a **transcript**: the question, then steps (`tool_call` with input and result, or
`text`). A recorded run is a stored transcript; a live answer is a fresh one from the server. Both
play through the same `buildTimeline()`, so a recorded run and a live answer look identical in the
hall. The agent moves the scene only through its two scene tools (`highlight_machines`,
`focus_camera`); those calls become `SceneAction`s, with every machine id re-checked against the
plant before the scene applies it.

## Data and determinism

- The plant clock is fixed (`snapshot` in `plant.json`, 2026-10-21 10:00). Plant time is whole
  minutes without time zones, so every browser and machine computes the same numbers.
- Tests assert against the real sample dataset in `src/data`, not a frozen copy. The recordings
  and the README figures describe exactly this data, so a data change fails the suite. Rule
  boundaries are tested on small purpose-built plants (`tests/rules.test.ts`).
- The interface and recordings are bilingual (EN/PL, `?lang=`).

## Recordings

- The shipped recordings are **scripted**: every tool result is the real output of the tools on
  the sample data, and only the answer text is written by hand. `npm run record` replaces them with
  live captures; `source` and `model` in each file say which is which.
- Answer-text numbers are checked by review, not by an automated matcher. Formatted and derived
  values (1,200; 22.10; "roughly 20 hours") make a numeric matcher brittle. The tool results
  themselves are re-checked by tests on every run.
- The cross-language "same tool calls" rule and the "at least one scene action" rule apply to
  scripted recordings only. A live capture keeps the consistency, schema and determinism checks,
  because a real Claude run may take a different path per language. `npm run record` warns when a
  run has no scene action.
- Scenario files are build-time inputs authored in this repo and are not schema-checked; the
  recordings they produce are schema-checked and consistency-tested.

## Live mode

- Live mode runs as middleware inside the Vite dev server (`vite --mode live`) rather than a second
  process: one command, still a Node server on `localhost` holding the key. The browser only sees
  `POST /api/chat`.
- The API key is read on the server only. It is never bundled, never sent to the browser, and error
  responses never echo internal error text (the details go to the server log).
- `/api/chat` accepts requests without an `Origin` header (curl, local scripts) and refuses any
  non-local `Origin`. Browsers always send `Origin` on a cross-site POST, so pages on other sites
  cannot spend the key.
- `FACTORY_TWIN_SKIP_DOTENV=1` stops `vite.config.ts` from reading `.env`; the wiring tests set it,
  so a developer's real key can never cause a billed call during `npm test`.
- Tool inputs are checked by hand-written validators instead of `strict: true` or a schema library.
  That keeps `src/agent` free of the SDK, so the static bundle stays small. Invalid input goes back
  to Claude as `is_error`, so it can correct itself. The limits are written twice (JSON schema for
  Claude, validators for execution); the tool tests pin every limit, so drift fails the suite.
- A live turn without any text is an error (502 with a readable message), not an empty answer. The
  browser never stores an empty or over-long answer in the history it sends back, and the server
  rejects one, because an empty assistant turn would make the API reject every later request.
- The server-side refusal fallback (`fallbacks: "default"`) is on. The answering model is returned
  and stored in live recordings (`model`).

## Front end

- Without WebGL the hall is shown as an HTML board with the same statuses, highlights, selection and
  machine card, so an embedded page and the assistant keep working. `?webgl=0` forces it.
- Reduced motion is read from the brand token `--motion-scale` (0 under `prefers-reduced-motion`),
  falling back to the media query.
- The scene exposes `data-loop="running|paused"` and the page `data-chat="busy|idle"`: observable
  state for the browser tests and for an embedding page. No behaviour depends on them.
- Clicking a machine opens a card (status, since, reason, 8 h rejects; "ask about this machine" in
  live mode). It is built from the same query functions as the agent's tools.

## Brand and colour

- `src/styles/tokens.css`, `fonts.css`, the woff2 files with their OFL licences and the logo come
  unchanged from the kokot.it brand. Fonts are self-hosted, so the page makes no third-party
  requests. App-only tokens sit in a block at the end of `tokens.css`, mapped onto brand tokens.
- Machine status uses the brand's success, danger and warning colours. What the agent points at
  uses Ion (highlights, replies, scene-action chips, machine links); a highlight with tone `alert`
  uses the danger colour because it marks a problem. Signal amber is kept for calls to action and
  focus, so a highlight never looks like a quality alarm.

## Tooling

- `playwright` (screenshots and browser tests) is pinned exactly, and `happy-dom` runs the
  chat-panel DOM tests. Both are dev-only and never reach the static bundle.
- `dev:live` uses Vite's default config loader; the other scripts use `--configLoader runner`. The
  runner closes after loading the config, which would break the live plugin's later module loads.
- `.gitattributes` forces LF, because Prettier checks LF and Windows checkouts with `autocrlf` would
  otherwise fail `npm run lint`.
- `@typescript-eslint/no-non-null-assertion` is off under `tests/` only.
