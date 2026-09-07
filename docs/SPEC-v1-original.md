# SPEC v1 (original, archived verbatim)

> **Provenance note, added during the handover.**
> This is the original specification the project started from. It lived outside the repository, at
> `<the operator's downloads folder>/SPEC-iqp-playwright-blueprint.md`, and **that file no
> longer exists**. It is archived here because `SPEC-v2-engine.md` refers to it six times, and
> those references would otherwise be unresolvable.
>
> **This document is historical. It is not the current plan.** Sections 7, 8 and 9 were replaced by
> `SPEC-v2-engine.md` after the phase 2 gate. Sections 1, 2, 3 and 10 still apply except where
> SPEC v2 amends them. Phases 0 to 2 were executed and their deliverables are in `EXPLORATION/`.
>
> Read it for the reasoning behind the project, not for what to do next.

---

# SPEC: IQP Export Exploration + Playwright Blueprint Framework (exploratory, gated)

Status: v1 spec. Deliberately exploratory: phases 0 to 2 produce knowledge and a verdict, not a framework. Nothing gets built past a gate without explicit user approval.
Language of all code, comments, schemas and reports: English.
Consumer: Claude Code. IQP export files are already present in the working directory.

---

## 0. Launch prompt

```
Read SPEC-iqp-playwright-blueprint.md in this directory, entirely, before touching anything.

This project is EXPLORATORY. Your first job is to understand data, not to write a framework.
Execute phases strictly in order (spec section 9). Each phase ends with a written deliverable
and a STOP: show me the deliverable, wait for my explicit go before the next phase.
Phase 3 and phase 4 are gated: do not start them, do not even scaffold them, before I approve
the phase 2 verdict.

Rules:
- The IQP export files in this directory are client material: strictly READ-ONLY. Never modify
  them, never commit them. Create .gitignore excluding the exports directory and any *.har,
  *.trace, storageState*.json, .env in your very first commit.
- Do not connect to any Oracle environment before phase 4, and in phase 4 only against the
  DEV/TEST URL I provide, never PROD.
- No credentials in code or config, ever: environment variables and gitignored storageState only.
- When the export format surprises you, report what you actually see rather than forcing it
  into the expected model. Unknowns go into the deliverable as unknowns.
- Ask me before any scope deviation. Decide small implementation details yourself.
- No em dashes anywhere in generated text, schemas, or reports. Use commas, colons,
  parentheses, periods.
```

---

## 1. Context

- Operator: single application maintenance consultant on Oracle Fusion Cloud HCM (Redwood transition in progress). Vibecoder profile: runs scripts, edits YAML/markdown, is not a professional developer. Keep everything simple and explicit.
- IQP is the incumbent enterprise test automation platform, Selenium under the hood. Its structural weakness, acknowledged in its own training material: Oracle quarterly patches break selectors, driving heavy maintenance (industry figures put Selenium-on-Oracle maintenance at 60 to 70% of total automation effort).
- Oracle Fusion UI reality: Redwood pages generate dynamic IDs and use shadow DOM; classic ADF pages use generated IDs like `:pt1:r1:0:soc1::content` and iframes. Raw recorded selectors rot every quarter.
- Governing principle of the whole project: **store the intent, regenerate the binding.** The durable asset is a declarative blueprint (page, visible label, action, data). Selectors are runtime artifacts resolved from semantic anchors (label, role, accessible name), never stored as the source of truth.
- Target architecture (decided in prior analysis): Playwright + a keyword-driven YAML blueprint layer. Two possible sources feed the blueprints: (a) LLM-assisted conversion of existing IQP assets, (b) manual capture via Playwright codegen used as a throwaway draft. This spec's exploration phase determines how viable source (a) is. **The framework (phase 4) is the destination either way**: a negative translatability verdict kills the converter, not the framework.
- IQP export files are provided in the working directory. Their exact format is unknown at spec time (could be Java/Selenium code, keyword spreadsheets, XML/JSON project exports, or a mix). That uncertainty is precisely why phases 0 to 2 exist.

## 2. Goal

1. Reverse-engineer the IQP export data model and document it.
2. Deliver an evidence-based verdict on translatability: what fraction of IQP test intent can be mechanically or LLM-assistedly converted into the target YAML blueprint format, and what gets lost.
3. If and only if approved: pilot-convert a few representative scripts, then build the minimal Playwright interpreter that replays blueprints against Oracle HCM.

### Non-goals

- No modification or "improvement" of IQP itself; no writes to any upstream system.
- No self-healing loop for IQP assets in this spec (separate initiative; phase 1 should however note what execution/failure exports contain, since that determines whether self-healing is even possible later).
- No PROD execution, ever.
- No anonymization/portfolio tooling here; exports and converted assets stay local and gitignored.
- No exhaustive wiki-perfect parsing of every IQP construct: the question is translatability of the common cases, not a full IQP emulator.

## 3. Target blueprint format (the fixed point everything converges to)

The YAML schema below is the v0 contract. Phase 2 measures IQP against it; phase 3 refines it against reality (schema changes are allowed and expected, but must be documented in the deliverable).

```yaml
scenario: hire_candidate_move_to_hr        # snake_case id
app: oracle-hcm
area: recruiting                            # functional module
ui: redwood                                 # redwood | adf | mixed
description: >
  Move a job offer to HR and convert candidate to pending worker.
data_profile: default                       # points to an external data file, optional
steps:
  - action: navigate
    target: "Job Offers"
  - action: fill_field
    label: "Probation Period"               # the VISIBLE label: the semantic anchor
    value: "{{probation_period}}"           # literal or data-profile reference
  - action: select_lov
    label: "Business Unit"
    value: "Acme Corp"
    match: exact                            # exact | contains
  - action: click_action
    label: "Move to HR"
  - action: verify_message
    contains: "moved to HR"
  - action: verify_field
    label: "Offer Status"
    equals: "Accepted"
```

Schema rules:
- Allowed actions (v0 vocabulary, 9 keywords): `login`, `navigate`, `fill_field`, `select_lov`, `click_action`, `submit`, `verify_field`, `verify_message`, `wait_for`.
- **No selectors in blueprints.** The only permitted disambiguation is an optional human-readable `hints:` block per step (e.g. `section: "Assignment Info"`, `index: 2`), used when the same label appears twice on a page.
- `label` values are the exact on-screen strings, verbatim, because the interpreter resolves them at runtime via `getByLabel`/`getByRole`.
- Data may be inline (`value`) or referenced (`{{var}}` + data profile file). Converter should externalize obviously environment-specific data (names, dates, org units).

## 4. Phase 0: Inventory (no interpretation)

Deliverable: `EXPLORATION/00-inventory.md`.
- Tree of the export directory: file types, counts, sizes.
- For each distinct file type: one representative sample opened and quoted (truncated), with a one-line guess of its role (test definition, object repository, test data, execution report, config, noise).
- Encoding/format anomalies noted (Excel with merged cells, XML namespaces, zipped bundles: unpack copies into a working area, never in place).

## 5. Phase 1: Data model reconstruction

Deliverable: `EXPLORATION/01-data-model.md`. Answer, with quoted evidence from the files, each of these questions; mark honestly what remains unknown:

1. **Test case anatomy**: how is a test case represented? Ordered steps? What fields does a step carry (action, target, value, expected result)?
2. **Action vocabulary**: are steps expressed as reusable keywords/verbs (click, set, select...) or as linear Selenium code? Enumerate the full observed action vocabulary with frequencies.
3. **Locator storage** (the decisive question): where do element identifiers live: inline per step, or in a separate object repository? What do they look like (XPath, CSS, ID patterns)?
4. **Semantic anchors present or absent** (the second decisive question): do the exports carry the functional, human-readable element names or visible labels anywhere (step descriptions, object names, comments)? Translatability hinges on this: if only raw XPath/IDs exist, intent must be inferred, which raises risk.
5. **Test data**: inline in steps, or externalized (sheets, CSV, parameters)?
6. **Assertions**: how are expected results/verifications encoded?
7. **Structure and reuse**: shared components/modules/functions across test cases, or copy-paste?
8. **Oracle-specific handling**: how does IQP encode LOV interactions, iframes, waits/synchronization?
9. **Execution artifacts** (for the later self-healing question, observation only): if any run reports are in the exports, what do they contain on failure (screenshot, DOM snapshot, selector that failed)?
10. **Volume**: how many test cases, how many steps total, distribution of step types.

## 6. Phase 2: Translatability verdict (GATE)

Deliverable: `EXPLORATION/02-translatability-report.md`.

- **Mapping matrix**: every observed IQP action/step type to target blueprint action, marked `direct` (mechanical mapping), `assisted` (LLM inference needed, e.g. deriving a label from an XPath or a step description), or `untranslatable` (no equivalent, or intent unrecoverable). With counts and percentages over the whole corpus.
- **Loss analysis**: what information the blueprint format cannot carry (custom waits, scripted branches, environment tricks) and whether the loss matters.
- **Risk register**: top 5 things most likely to make converted blueprints wrong, each with a mitigation.
- **Verdict**, quantified: "X% of steps map direct, Y% assisted, Z% untranslatable; estimated effort for a converter: N hours; confidence: P%." Plus a recommendation among: (a) build the converter, (b) skip conversion, populate blueprints via codegen capture, (c) hybrid (convert the high-volume scenario families, capture the rest).
- **STOP.** User decides. Phase 3 only on explicit approval; if verdict is (b), jump the gate directly to phase 4.

## 7. Phase 3 (gated): Pilot conversion

> Replaced by `SPEC-v2-engine.md` section 8, step 4b.

Deliverable: `blueprints/` with 1 to 3 converted scenarios + `EXPLORATION/03-pilot-notes.md`.

- Pick 1 to 3 representative test cases (one simple, one LOV-heavy, one long) with the user.
- Convert them to the v0 schema. Where inference was needed, mark the step with `# INFERRED:` comments so review is targeted.
- Schema adjustments discovered during conversion: apply them and document them in the notes.
- Acceptance: the user reads each YAML side by side with the original test and confirms the sequence matches the manual test as they know it (intent fidelity review; no replay exists yet). Conversion throughput estimate for the full corpus goes in the notes.

## 8. Phase 4 (gated): Minimal Playwright interpreter

> Replaced by `SPEC-v2-engine.md` sections 3 to 8.

Prerequisites, provided by the user at gate time: DEV/TEST environment URL, a test account, and the auth reality (SSO? MFA?). If MFA blocks headless auth, the fallback is a one-time manual login captured into `storageState.json` (gitignored), refreshed when expired.

Deliverable: a repo layout and a first green run.

```
playwright-hcm-blueprint/
package.json                 # TypeScript + @playwright/test
playwright.config.ts         # screenshot: 'on', trace: 'on', video: 'retain-on-failure'
blueprints/                  # the YAML scenarios (from phase 3 and/or codegen capture)
data/                        # data profiles
src/
  interpreter.ts             # loads YAML, iterates steps, dispatches keywords
  keywords/                  # one module per action (9 keywords, section 3)
  locate.ts                  # resolution chain: getByLabel, getByRole(name),
                             #   label-adjacent text, hints. NO stored selectors.
auth.setup.ts                # login once, save storageState (gitignored)
reports/                     # Playwright HTML report output (gitignored)
```

Scope discipline for v1 of the interpreter:
- Exactly the 9 keywords, nothing more. `select_lov` gets the most care: type into the field, wait for the listbox/options to render, select by exact visible text, assert the field value after selection. Async type-ahead is the number one breakage point on Fusion.
- One UI world first: whichever (Redwood or ADF) dominates the pilot blueprints. The other world's quirks (iframes for ADF, shadow DOM for Redwood: Playwright locators pierce open shadow DOM natively) are handled only when a real blueprint needs them.
- Reporting v1 is Playwright's native HTML report with per-step screenshots and full trace: zero custom code. A custom reporter matching the IQP report standard is explicitly deferred until the user supplies that standard; leave a `// TODO custom reporter` marker in the config, nothing else.
- Acceptance: one blueprint (a real converted or captured scenario) runs green end to end against DEV, and the HTML report shows per-step screenshots. One deliberate failure (wrong label) produces a readable error naming the label it could not resolve.

## 9. Build/exploration order (stop and demo after each)

> Replaced by `SPEC-v2-engine.md` section 8.

1. Phase 0 inventory.
2. Phase 1 data model.
3. Phase 2 translatability report. GATE: user verdict.
4. Phase 3 pilot conversion (if approved).
5. Phase 4 interpreter skeleton + keywords + first green blueprint run (needs env + credentials from user).
6. Retro note: schema v0 to v1 changes, and what the next 5 blueprints should be.

## 10. Security and data handling

> Still in force. Amended and extended by `SPEC-v2-engine.md` section 10.

- IQP exports: client material, read-only, gitignored, never pushed anywhere. Converted blueprints derived from them stay local until an explicit, separate anonymization pass (out of scope here).
- Oracle credentials: env vars + gitignored storageState only. DEV/TEST only. The interpreter refuses to run if the target URL matches a PROD pattern (hard guard in code, configurable prod-URL denylist).
- HAR/trace/video files can contain session tokens: gitignored by default (see launch prompt).
