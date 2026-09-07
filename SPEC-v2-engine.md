# SPEC v2: Playwright test engine (replaces phases 3 and 4 of SPEC v1)
<!-- superseded-banner -->

> **SUPERSEDED by `SPEC-v3-mvp.md` on 2026-08-29. Do not build from this document.**
>
> It is kept for its reasoning and for its record of what was built first. Three things it
> specifies were deliberately removed afterwards, so if you read them here as current you will
> rebuild features that were taken out on purpose: `legacy_xpath` (no selector survives anywhere,
> D11), the `login` keyword and `sessions:` (one test is one session, D12 and D13), and
> `needs_verification` (a guessed label is a comment, not a schema field).
>
> `memory/PROJECT.md` D11 to D15 explains why each was reversed.


Status: revised after the phase 2 gate. Phases 0 to 2 of SPEC v1 are complete and remain valid
(`EXPLORATION/00-inventory.md`, `01-data-model.md`, `02-translatability-report.md`).
This document replaces sections 7, 8 and 9 of SPEC v1. Sections 1, 2, 3 and 10 of SPEC v1 still apply
except where explicitly amended here.

**SPEC v1 is archived at `docs/SPEC-v1-original.md`.** It originally lived outside the repository and
that copy no longer exists, so the in repo archive is now the only surviving version.
For the current decision state, including what was rejected and why, read `memory/PROJECT.md`.
Language of all code, comments, schemas and reports: English.

---

## 1. What changed, and why

SPEC v1 was written before the export was seen and before the scope was settled with the operator.
Four things are now decided, and they make the build materially smaller.

| Decision | Consequence |
|---|---|
| **Engine only, not platform.** No authoring UI, no object repository management, no scheduling, no run history, no Jira integration. | Removes roughly 85% of what "replacing IQP" could have meant. |
| **Failure is a valid outcome.** A test that stops because a label changed is not a defect of the engine. It must stop, say which step and which label, and hand over to a human. | Removes all robustness, retry and self-healing work. This is the single largest simplification. |
| **The floor is IQP itself.** Legacy IQP XPaths are kept as the last link of the resolution chain, not discarded. | The engine cannot perform worse than IQP, because in the worst case it replays IQP's own selectors on a faster runtime. |
| **A full IQP export is expected.** The sample was one module; the real corpus will be larger. | The converter becomes worth building, but only after the schema has stabilised against a live environment. |

Two SPEC v1 concerns are now closed by evidence rather than by assumption:

- **Authentication.** The export shows username and password typed before any click, followed immediately
  by in-application navigation, with a 5 second wait. Single-page login form, no MFA step in the automated
  path. Playwright reproduces this in three lines. Residual risk: a conditional "new device" MFA challenge
  triggered by Playwright's clean browser profile. Mitigation if it occurs: one manual login captured into
  a gitignored `storageState.json`, reused until expiry.
- **Missing assertions.** IQP has zero assertions across 439 steps, so the engine inherits no regression by
  also having none. Assertions and the generic error check below are therefore net additions, not catch-up.

## 2. What the engine does, in one paragraph

It reads a human-readable test file describing the steps a functional consultant would perform in the
Oracle HCM interface, resolves each on-screen element by its visible label at runtime, performs the action,
captures a screenshot of every step, and produces a standardised pass or fail report. When an element
cannot be resolved, it stops, names the step and the label it looked for, and reports. No repair is
attempted. That is the whole product.

## 3. Test file format

YAML. One file per scenario. Recommended over keeping Gherkin because the structured constructs the corpus
needs (multi-persona sessions, disambiguation hints, data profiles) become awkward in flat sentences, and
because parsing YAML is one library call. The decision is cheap to revisit: only the parser front-end
would change, not the engine.

The IQP object repository disappears entirely. That indirection is the maintenance burden being removed.

```yaml
scenario: create_a_course
source: PROJ-10237                  # traceability back to the IQP scenario / ticket
app: oracle-hcm
area: learning
ui: redwood
description: >
  Learning specialist creates a course and saves it.
data_profile: learning_default

steps:
  - action: login
    as: "{{UserIdLearningSpec}}"

  - action: navigate
    path: ["Navigator", "My Client Groups", "Learning", "Courses"]

  - action: click
    label: "Create"

  - action: fill
    label: "Title"                     # INFERRED from IQP object 'title' + id fragment 'ttlInp'
    value: "{{title}}"
    legacy_xpath: ".//span[contains(@id,'ttlInp')]/input[1]"
    needs_verification: true

  - action: select                     # LOV: type, wait for the list, pick exact text, confirm
    label: "Category"
    value: "{{category}}"
    match: exact

  - action: capture
    label: "Course Number"
    as: course_number

  - action: click
    label: "Save and Close"

  - action: verify
    text_contains: "Course"            # optional, cheap, recommended once per scenario
```

Multi-persona scenarios (IQP encodes these as `close browser` followed by a fresh login) use a session
block instead. Playwright runs one browser context per persona, which is cleaner and faster than IQP's
close-and-relogin.

```yaml
sessions:
  - as: "{{UserIdEmployee}}"
    steps: [...]
  - as: "{{UserIdApprover1}}"
    steps: [...]
```

### Keyword vocabulary (9, derived from the measured corpus, not guessed)

| Keyword | Replaces in IQP | Notes |
|---|---|---|
| `login` | `navigate` + 2 `fill` + `click SignIn` + `wait` | One step instead of five. |
| `navigate` | a chain of `click` + `wait` pairs | Takes a path array. Collapses 8 IQP steps into 1. |
| `fill` | `enter into input field`, `clear the content of input field` | Playwright's `fill()` clears by default, so the IQP clear step folds in. |
| `select` | `enter into input field` + `wait` + `press enter/tab` (+ sometimes a click on the suggestion) | The LOV idiom, matched as a unit. The most delicate keyword. |
| `click` | `click on X link`, `click on X button` | The link/button distinction is cosmetic in IQP (same object, same XPath, both labels observed) so one keyword suffices. |
| `capture` | `capture element X as variable` | Stores a runtime value for later steps. |
| `verify` | nothing (no source) | New. Optional per scenario. |
| `wait_for` | `add wait seconds` | Semantic only, for a named state change. Not a sleep. Expected to be rare. |
| `switch_window` / `close_window` | `switch to new window`, `close new window`, `switch to main window` | BPM approval notifications open a popup. |

Deliberately not implemented: `take screenshot` (automatic, every step), `scroll` (Playwright scrolls into
view automatically), `add wait seconds` as a sleep (auto-waiting replaces it), `custom code` (the one
observed function, `GenerateRandomString`, becomes a built-in data generator).

## 4. Element resolution chain (the core of the whole project)

For each step, in order, stopping at the first match:

```
1. getByLabel(label)                      exact visible form label
2. getByRole(role, { name: label })       accessible name, role inferred from the action
3. text-adjacent heuristic                label text, then the nearest input/control
4. hints                                  section: "Assignment Info", index: 2
5. legacy_xpath                           the IQP selector, from the export
```

Rules:

- Steps 1 to 4 are the durable binding. Step 5 is the safety net.
- **Every fall through to step 5 is recorded in the run journal as technical debt**, with the scenario,
  the step, and the label that failed. That list is the backlog for the recorder workflow (section 7).
  This is the mechanism that turns the legacy XPaths from a liability into a migration instrument.
- If all five fail, the step fails with a message naming the label, the action, the page URL, and the
  resolution attempts made. This message is the deliverable of a failure, so it gets real care.
- No stored selector is ever the source of truth. `legacy_xpath` is an optional, degradable hint that
  becomes deletable once a step has resolved semantically on two consecutive quarterly patches.

## 5. Generic Oracle error detection

Not self-healing. Detection and stop, nothing else. Roughly 20 lines, written once, applied everywhere.

After each step, the engine checks whether Oracle is displaying an error: error banner, red field-level
validation message, or an error dialog. If so, the step fails, the error text is captured verbatim into
the report along with the screenshot, and the scenario stops.

The list of error indicators is configuration, seeded with the common Fusion patterns and refined on first
contact with the DEV environment. It must not be hardcoded in the keyword modules.

Rationale: without it, "passed" means only "the bot reached the end". Oracle can refuse an operation
without blocking the click sequence, producing a green run in which nothing was created. IQP has this
blind spot today. Closing it is the highest value-per-line change in the project.

## 6. Reporting

Two layers, because the client-facing format is not yet known.

**Layer 1, the run journal (structured, stable).** The engine emits one JSON record per step:

```
scenario, source_ticket, step_index, keyword, label, value_used, status,
resolution_method (label | role | adjacent | hint | legacy_xpath), screenshot_path,
duration_ms, error_message, oracle_error_text
```

This is the durable artifact. Any report format can be generated from it later in about an hour.

**Layer 2, the human report.** Playwright's native HTML report (screenshot per step, video on failure,
full replayable trace) plus a one-page standardised summary generated from the journal: per scenario,
pass or fail, step count, the failing step and its cause, and links to the screenshots.

When the IQP client report format is supplied, a new generator is written against the journal. The engine
is not touched. `// TODO custom reporter` marker stays in the config until then.

Out of scope, confirmed with the operator: scheduling (a background task on an open workstation is
sufficient), run history and any persistent run database.

## 7. The two ways a test file gets created

1. **Conversion from the IQP export.** Mechanical for the roughly 52% of steps whose IQP XPath contains
   the visible label. LLM-assisted for the roughly 42% bound to generated id fragments, with every inferred
   label marked `needs_verification: true` and carrying its `legacy_xpath`.
2. **Recording in the browser.** `playwright codegen` opens Oracle, a human performs the test once, and it
   writes the actions out preferring `getByLabel` and `getByRole`. This is the answer for the opaque steps,
   for anything the converter marks as unverified, and for every new test. No authoring UI needs to be
   built: this one already exists and is free.

Both feed the same YAML format. The debt list from section 4 tells you exactly which steps to re-record.

## 8. Build order

Each step ends with something demonstrable. Estimates assume the operator working with Claude Code.

| # | Step | Output | Estimate | Status |
|---|---|---|---|---|
| **4a** | **Auth spike.** Log into DEV with Playwright, land on the home page, screenshot. | Proof that automation can authenticate at all. | 2 to 4 h | **blocked**, needs the DEV URL and an account |
| 4b | Pilot conversion: 2 scenarios by hand into YAML. | `blueprints/*.yaml` plus `EXPLORATION/04-pilot-notes.md`. | 2 to 3 h | done |
| 4c | Interpreter skeleton: YAML loader, dispatcher, resolution chain with legacy fallback, keywords. | A blueprint runs end to end. | 1 to 2 days | done, green against the offline fake Oracle |
| 4d | `select` (list of values). | The list of values case runs green. | 0.5 to 1 day | done, green offline; option markup unverified on a real pod |
| 4e | Run journal, Oracle error detection, summary report. | Standardised pass or fail report with per step screenshots. | 0.5 day | done |
| 4f | Remaining keywords (`capture`, `verify`, `wait_for`, `switch_window`). | Multi persona and popup scenarios run. | as needed | done, popup and multi persona paths not yet exercised |
| 5 | Thin converter. | IQP export in, YAML out, with inference markers. | 5 to 7 h | done, 7 of 7 scenarios converted |
| 6 | Recorder workflow runbook. | The team can add tests without help. | 1 h | done, `docs/RECORDING.md` |
| **4g** | **Offline self test** (not in the original plan). | `npm run selftest`: a fake Oracle exercising the whole engine, 23 checks. | 3 h | done, green |

**4a is the only remaining step, and it is the go/no-go.** Everything that can be built without an
Oracle environment is built and verified against a local fake. What is left is contact with reality.

Ordering note, revised in hindsight: 4g (the offline self test) turned out to be worth more than its
place in the plan suggested. It found a real defect in the read only field handling before any
environment existed, and it means the first live run will fail only for Oracle specific reasons.

## 9. Acceptance criteria

- One converted scenario runs green end to end against DEV, with a screenshot for every step in the report.
- One deliberately broken label produces a failure that names the step, the label, and the resolution
  attempts, and that a non-developer can act on without reading the code.
- One scenario where Oracle rejects the operation produces a failure carrying Oracle's own error text,
  rather than a green run.
- The run journal contains a `resolution_method` for every step, so the legacy-XPath debt is visible.

## 10. Security, amended

SPEC v1 section 10 applies unchanged, plus:

- The engine refuses to run if the target URL matches a configurable production denylist. Hard guard in
  code, checked before the first navigation.
- `legacy_xpath` values are derived from client export material. Blueprints stay local and gitignored
  until a separate anonymisation pass, which remains out of scope.
- The DEV credentials currently sitting in cleartext in `iqp-data-extract/Learning_Sample (1).csv` move to
  environment variables before the first run. The export file itself stays read-only and gitignored.
