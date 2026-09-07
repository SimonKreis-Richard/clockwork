# AGENTS.md — Clockwork

Read this first. It is the entry point for any coding agent working on this repository.

Companion documents, in the order you will need them:

| File | What it holds |
|---|---|
| `memory/PROJECT.md` | **Decision state.** What is settled and must not be reopened, what was rejected and why, open questions with confidence. Read it before proposing anything. |
| `SPEC-v3-mvp.md` | **The current specification and build order.** Read this one. |
| `SPEC-v2-engine.md` | Superseded by v3. Kept for its reasoning and its record of what was already built. |
| `docs/SPEC-v1-original.md` | The original spec, archived. Historical: read for reasoning, not for what to do. |
| `EXPLORATION/*.md` | The analysis of the IQP export that produced the design. Quoted evidence, measured ratios. |
| `README.md` | The operator facing manual: how to write and run a blueprint. |
| `docs/RECORDING.md` | How a step is repaired in the browser, and how a new one is written. |
| `.claude/skills/` | Three validated procedures: first live run, converting an IQP export, verifying offline. |

## What this is

A replacement for the execution engine of **IQP**, the incumbent Selenium based test automation
platform for Oracle Fusion Cloud HCM. IQP's structural weakness is that Oracle's quarterly patches
break its stored XPath selectors, and maintaining them consumes most of the automation effort.

This engine reads a test expressed as the **visible labels a person sees on screen**, resolves each
element at run time, performs the action, screenshots every step, and produces a pass or fail report.
When Oracle has renamed something it pauses on that screen, hands over to a human, and writes their
correction back into the test file.

**Governing principle: store the intent, regenerate the binding.** There is no selector anywhere,
and no field to put one in.

**The governing image, and the name.** A wind up toy: stored energy, a straight line, no autonomy,
a clean stop at the first obstacle. What v3 adds is that when someone picks the toy up and puts it
back on course, the engine remembers the correction. The metaphor is not decoration, it is the scope
boundary: anything that would make the toy steer around an obstacle by itself is out. `README.md`
maps each property onto the decision it stands for; use it when you are tempted to add cleverness.

## State, as of 2026-09-02

`SPEC-v3-mvp.md` is the plan, and **steps 1 to 6 of its build order are implemented**. The engine is
verified offline: 50 tests green (a fake Oracle for the engine and for assisted mode, a synthetic
IQP export for the converter), typecheck clean. **It has never touched a real Oracle page.**

What v3 changed, and where it now lives in the code:

| Decision | Where it is |
|---|---|
| Resolution is 100% semantic (D11) | `src/locate.ts`. No `legacy_xpath` in the schema, no fallback, no debt reporting. `src/blueprint.ts` refuses a blueprint carrying a selector. |
| One test is one session (D12) | `src/interpreter.ts` walks one list of steps. No `sessions:`, no `login`, no personas. The converter splits a multi persona scenario into `_1`, `_2`. |
| Auth is infrastructure (D13) | `npm run auth` (`tools/capture-session.ts`) writes a gitignored `storageState.json`; the interpreter opens the session and names an expired one. |
| Assisted mode (D14) | `src/assist.ts`. Pause on the failing screen, in page banner, click capture, surgical rewrite of the blueprint file, resume. |
| Supervision is Playwright UI (D15) | `npm run ui`. No dashboard was built and none should be. |
| Frames searched automatically | `searchRoots` in `src/locate.ts`. No keyword, never mentioned in a blueprint. |

Step 7, the first run against a real DEV pod, is the only one left, and it needs the operator: they
sign in once with `npm run auth`, then the tuning begins. The MFA risk that used to gate everything
is closed by D13.

## The workspace: where client material lives

**No client derived asset is in this repository.** IQP exports, converted blueprints and data
profiles sit in a **workspace directory outside it**, pointed at by `BLUEPRINT_WORKSPACE`:

```
<theme-folder>/
  clockwork/                    this repository: the engine. Anonymous, reusable, shareable.
  clockwork-workspace/          client material. Never shared.
    iqp-exports/                raw IQP exports, read only
    blueprints/                 the YAML scenarios
    data/                       data profiles
    reports/                    journals, summaries, screenshots, conversion reports
```

`workspaceDir()` in `src/config.ts` resolves it; unset, everything falls back to the repository
itself. That is the only indirection, and it is what makes this repository a reusable tool rather
than one engagement's artefacts.

**Nothing client specific may enter this repository.** No client or project name, ticket prefix,
Oracle pod tenant code, username, personal name, password or home directory path. Verified by the
sweep in `.claude/skills/verify-offline/` section 3. If you produce something derived from a real
export, write it under `reports/` or into the workspace, never into `EXPLORATION/`, which is
documentation. That is why `tools/convert-iqp.ts` writes its report to `<workspace>/reports/`.

Everything the project needs in order to be verified is synthetic and lives in `selftest/`:

| Fixture | Replaces |
|---|---|
| `selftest/fake-oracle/` | A real Oracle pod. Reproduces the traps that matter. |
| `selftest/sample-iqp-export/` | A real IQP export. Identical three file structure, invented content. |
| `selftest/blueprints/` and `selftest/data/` | Real blueprints and data profiles. Also the worked example. |

**Git, as of 2026-09-07, and the history starts there.** The project spent its first weeks with no
repository at all and its earlier history deliberately discarded, so the initial commit is the whole
engine arriving at once rather than a record of how it was built. That record lives in
`memory/PROJECT.md` instead, which is why that file is long: it is the archive the history is not.

Development is still solo. Branches, pull requests and release processes are not wanted; commit to
the current branch. Do not design any workflow that depends on a rich history, because there is
none to depend on.

## Setup

No MCP server, no external service, no API key. Node and a browser, nothing else.

```bash
npm install
npm run install:browsers     # Chromium only
npm run check                # must be green before you touch anything: typecheck + 50 offline tests
```

Node 20 or later. Verified on 24.16.0.

To run against a real environment, and only then:

```bash
cp .env.example .env
npm run auth
```

Set `BLUEPRINT_WORKSPACE` (the directory holding `blueprints/` and `data/`) and `ORACLE_BASE_URL`
(a DEV or TEST pod, never production). There is no password to set: `npm run auth` opens a browser,
a human signs in, and the session is saved to a gitignored file that every run reuses.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | **The gate.** Typecheck plus the 50 offline tests. No credentials needed, about 90 s. |
| `npm run typecheck` | `tsc --noEmit`, strict. There is no linter; this is the quality gate. |
| `npm run selftest` | The offline suite alone, against the fake Oracle in `selftest/`. |
| `npm run auth` | Sign in by hand once, save the session. Everything else assumes it has been run. |
| `npm test` | Every blueprint in `<workspace>/blueprints/` against the real environment. Headed by default. |
| `npm run test:one -- "<name>"` | One scenario. |
| `npm run ui` | Playwright UI mode. This is the supervision screen, and the reason no dashboard exists (D15). |
| `npm run report` | Generate the standardised summary from the last run journal. |
| `npm run convert` | Turn an IQP export in `<workspace>/iqp-exports/` into blueprints. |
| `npm run record` | `playwright codegen`. Superseded for repairs by assisted mode (D14); kept for authoring from nothing. |

Runs are **headed** by default and assisted mode is **on** by default, because a blocked test
waiting for a person is the product, not a bug. An unattended run needs `HEADLESS=true` and
`ASSIST=false` together, and then a wrong label simply fails the test.

With no `BLUEPRINT_WORKSPACE` configured, `npm test` reports **1 skipped**, not a failure. That is
correct: blueprints live outside the repository because they hold client derived material.

## Architecture

```
src/
  locate.ts        THE CORE. The resolution chain, over the page and every frame. Read this first.
  assist.ts        The pause: banner, click capture, blueprint repair. Read this second.
  interpreter.ts   Walks steps, dispatches, screenshots, journals, pauses or stops on failure.
  blueprint.ts     YAML loading and validation. The only Gherkin/YAML contact point.
  config.ts        Every tuning point, plus the production guard.
  errors.ts        Oracle error detection. Detection only, never repair.
  data.ts          {{references}}, data profiles, generators.
  journal.ts       The run journal, one JSON record per step.
  keywords/        One module per action. select.ts is the delicate one.
tools/
  capture-session.ts  npm run auth. The only place authentication happens.
  convert-iqp.ts   IQP export to blueprints.
  report.ts        Journal to summary. All reporting is generated from the journal.
selftest/          Everything needed to verify the project with no Oracle and no client data:
  fake-oracle/       A miniature Oracle reproducing the traps that matter.
  sample-iqp-export/ A synthetic IQP export, identical in structure to a real one.
  blueprints/, data/ The worked example, which is also a test fixture.
tests/             Discovers <workspace>/blueprints/*.yaml, one Playwright test per file.
```

### The resolution chain, which is the whole point

```
visible label -> ARIA role and name -> placeholder -> adjacent text -> hints
```

Then the pause: the browser stays open on the failing screen, a banner in that page says what was
being looked for and lists every actionable label, a click listener captures what the tester does,
and Resume writes that label back into the blueprint file. Nothing is ever stored as a selector;
`hints` (a panel name and an ordinal) is the only disambiguation.

Frames are searched automatically, main document first then each embedded one, so a blueprint never
mentions an iframe. An iframe is a page inside a page: a label in the inner document is invisible to
a search of the outer one, whatever the search method. This is unrelated to selectors.

### The ten keywords

`navigate`, `click`, `fill`, `select`, `press_key`, `capture`, `verify`, `wait_for`,
`switch_window` / `close_window`, `refresh`. Derived from the measured IQP vocabulary, not invented.
Adding an eleventh requires a real blueprint that needs it.

`click` takes `double: true`; `select` takes `mode: dropdown` for a plain choice list, which looks
like a type ahead on screen and behaves nothing like it.

## Conventions

- **English** for all code, comments, schemas and reports. The operator writes French; conversation
  can be French, artefacts are English.
- **No em dashes** anywhere in generated text. Commas, colons, parentheses, periods. This is a
  standing instruction from the original spec.
- Comments explain **why**, especially where a choice looks odd. Several non obvious decisions in
  this codebase are load bearing and are documented at their site.
- Failure messages are product surface, not stack traces. A functional consultant who does not read
  code must be able to act on them. See `explainFailure` in `src/locate.ts` for the standard.

## Known traps

Ordered by how likely you are to hit them.

1. **Never put a selector in a blueprint.** Not in `label`, not anywhere. Since D11 there is no
   field for one, and `validateStep` rejects `legacy_xpath`, `xpath` and `selector` by name. The
   only permitted disambiguation is `hints` (a panel name and an ordinal).
2. **`.gitignore` rules are anchored on purpose.** `/data/*` not `/data/`, because git does not
   descend into an excluded directory and a `!` exception inside one is silently ineffective. And a
   leading slash everywhere, because `blueprints/` unanchored also matches `selftest/blueprints/`.
   If you touch it, verify with `git check-ignore`, do not read the patterns. Procedure in
   `.claude/skills/verify-offline/`.
3. **The production guard reads the environment token from the first hostname label**, not a
   substring search. Oracle DEV pods are legitimately named `fa-xxxx-dev1-saasfaprod1...`; a naive
   search for "prod" blocks DEV. Four cases are covered by tests.
4. **`selftest/blueprints/selftest_create_course.yaml` is both the worked example and the test
   fixture.** Deliberate: an example that is executed cannot drift. Do not inline it.
5. **`tools/convert-iqp.ts` must not overwrite a blueprint without `--force`.** Reviewed blueprints
   carry hand corrected labels the converter cannot reproduce.
6. **A read only field's label and its value are two different elements.** Reading the label text
   captures the label, not the value. That is why `capture` and `verify` use the internal `value`
   element kind. This was a real bug, caught by the self test before any environment existed.
7. **Playwright compiles test files to CommonJS here.** `import.meta` fails; use `__dirname` with a
   `declare const`. There is no `"type": "module"` in `package.json` and adding one will break test
   collection.
8. **Before exporting anything new from IQP, the scenarios must be active.** A commented out
   scenario exports its steps but none of its locators, so the export looks complete and is unusable.
9. **`retries: 0` is deliberate**, and so is `timeout: 0`. A retry would paper over exactly the
   signal this engine exists to produce. The timeout is disabled because a test paused for a human
   will always exceed any limit worth setting (C3): put one back and assisted mode dies after ten
   minutes, looking like a random flake rather than a missing setting. `WORKERS` defaults to 1
   because Oracle test data collides under parallelism, not because the engine cannot take it.
10. **`repairBlueprintFile` edits YAML as text, on purpose.** A converted blueprint is mostly
   comments (`# INFERRED`, `# NOT CONVERTED`), and every YAML library throws those away on the way
   out. Parse and re serialise here and the first repair silently deletes the review notes.
11. **`selftest/fake-session.json` is committed and must stay that way.** It is a synthetic
   storageState holding one local storage key, with nothing secret in it. Without it the self test
   cannot exercise the session path at all, which is now the only way any run gets a session.

## Working with the operator

A single application maintenance consultant, recently onboarded to the IQP project, not a professional developer.
Runs commands, reads and edits YAML and Markdown. Keep proposals simple and explicit, recommend
rather than enumerate, and say plainly when something is unverified. The scope decisions in
`memory/PROJECT.md` exist to keep this achievable by one person: do not quietly widen them.
