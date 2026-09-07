# Phase 2: Translatability verdict (GATE)
<!-- superseded-banner -->

> **Two of its conclusions were later measured to be wrong.** A larger corpus (1852 steps, four
> more exports) showed that IQP assertions do exist (26 of them; this report says there are none)
> and that iframes are used (marked unknown here). The mitigations that mention
> `needs_verification` describe a schema that was since removed.
>
> The measurements about this sample remain sound, and the gate verdict still stands. See the
> "Corrections to earlier findings" section of `memory/PROJECT.md` for the full list.


Scope of the measurement: 439 steps, 7 scenarios, 1 module (Oracle HCM Learning), 1 client project.
This is a sample, not the portfolio. Every percentage below is measured on that sample and extrapolated
to nothing.

## 1. Headline

**The IQP export is far more translatable than the spec anticipated.** The pessimistic scenario feared
by the spec (raw recorded Selenium code, inline opaque XPath, no functional names) does not occur here.
IQP already stores intent separately from binding: symbolic step text, a separate object repository, and
an external data profile. The conversion is a **format migration between two declarative models**, not
an intent-recovery exercise.

The real difficulty is elsewhere, and it is not a conversion problem: **the source corpus contains zero
assertions**. Converting it perfectly yields tests that click through Oracle and verify nothing.

## 2. Mapping matrix

Categories:
`direct` = mechanical, deterministic, no inference.
`assisted` = LLM or human must infer the on-screen label or the intent.
`extension` = mechanically convertible but needs a schema keyword that v0 does not have.
`untranslatable` = intent not recoverable from the export.
`dropped` = deliberately not carried over, because Playwright makes it unnecessary. This is a gain, not a loss.

| IQP step | Count | % corpus | Target blueprint action | Verdict |
|---|---:|---:|---|---|
| `I add wait seconds of "N"` | 184 | 41.9 | none (auto-waiting) | dropped |
| `I take screenshot` | 51 | 11.6 | none (`screenshot: 'on'` in config) | dropped |
| `I scroll to end of page` / `scroll to element` / `scroll down by N pixels` | 3 | 0.7 | none (auto scroll-into-view) | dropped |
| `I navigate to "(URL)"` (plus the 4-step login block that follows) | 11 | 2.5 | `login` / `navigate` | direct |
| `I click on "[X]" link` / `button`, class A anchor | ~50 | ~11.4 | `click_action` | direct |
| `I click on "[X]" link` / `button`, class B or D anchor | ~54 | ~12.3 | `click_action` | assisted |
| `I enter into input field "[X]" the value "V"`, class A anchor | ~27 | ~6.2 | `fill_field` | direct |
| `I enter into input field "[X]" the value "V"`, class B or D anchor | ~30 | ~6.8 | `fill_field` | assisted |
| `I clear the content of input field "[X]"` | 5 | 1.1 | folded into `fill_field` | direct |
| `I press enter key` / `press tab key on "[X]"` | 9 | 2.1 | folded into `select_lov` or `submit` | direct (idiom-matched) |
| `I close browser` then a new `Given I navigate` | 5 | 1.1 | new `session` / persona block | extension |
| `I switch to new window` / `close new window` / `switch to main window` | 4 | 0.9 | new `switch_context` keyword | extension |
| `I capture element "[X]" as variable` | 2 | 0.5 | new `capture` keyword | extension |
| `custom code "GenerateRandomString"` plus argument rows | 4 | 0.9 | none | untranslatable |
| **assertions** | **0** | **0.0** | `verify_field` / `verify_message` | **no source** |

Class A/B split applied to click and fill steps comes from the usage-weighted locator classification
measured on the fully exported scenarios (63 object references: 52.4% class A or C, 47.6% class B or D).

### Aggregate

| Bucket | Steps | % of all 439 | % of the 201 meaningful steps |
|---|---:|---:|---:|
| dropped (pure gain) | 238 | 54.2 | n/a |
| direct | ~104 | ~23.7 | **~52** |
| assisted | ~84 | ~19.1 | **~42** |
| extension | 11 | 2.5 | ~5 |
| untranslatable | 4 | 0.9 | ~2 |

Read the middle column first: **more than half of the IQP corpus is scaffolding that simply disappears.**
A 121-step IQP scenario becomes a roughly 45-step blueprint.

## 3. Loss analysis

What the target format cannot carry, and whether it matters:

| Lost | Matters? | Comment |
|---|---|---|
| 184 hardcoded sleeps | No, this is the point | Playwright auto-waits. Keep a semantic `wait_for` for the 3 to 5 places where a real state change is awaited (post-submit, post-save). Do not translate sleeps one for one. |
| 51 screenshot steps | No | Playwright captures per step natively, with a trace on top. Strictly better evidence than the IQP screenshots. |
| Custom code hook | Yes, but small | `GenerateRandomString` is trivially reimplementable in TypeScript. The risk is scale: **UNKNOWN** how many custom functions exist in the wider asset base. Question for the IQP team. |
| Browser lifecycle and multi-persona chaining | Yes | Scenario 4 runs four personas in one test. v0 has no session concept. Needs a schema extension, and it is a genuine feature, not noise. Playwright handles it natively with one browser context per persona, better than close-browser-and-relogin. |
| Window switching for BPM notifications | Yes | Needs a keyword. Playwright popup handling is cleaner than Selenium window handles. |
| Runtime variable capture (`$var$`) | Yes | Needed for chained scenarios (capture the course number, reuse it). Straightforward extension. |
| `keywordIdentifier`, `scope`, `sequenceNo` | No | IQP-internal bookkeeping with no target meaning. |
| Positional XPath intent (`OfferingCreate`) | Yes, locally | One object out of 32 where only the object name survives. Must be resolved against a live page. |

## 4. Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Class B labels are guessed wrong.** 47.6% of object references resolve to internal id fragments (`sdDt`, `ttlInp`, `crnmLbl`, `adCwMn`) with no visible label in the export. An inferred label such as "Start Date" may not be the real on-screen string. | High | Converter marks every inferred label with `# INFERRED:` and a `needs_verification: true` flag. The first DEV run validates them: a label the interpreter cannot resolve must fail with the exact label it looked for. Budget one validation run per converted scenario, not a desk review. |
| 2 | **Ambiguous labels.** "Next" is used for two different buttons in scenario 1, "Save and Close" for two, "Create" and "Courses" are generic Oracle navigation words that appear many times per page. `getByRole` will match several nodes. | High | Use the `hints:` block from the start, not as an afterthought: `section:` derived from the preceding navigation step, and `index:` where the IQP XPath already carried one (`(//span[text()='Add Item'])[1]`). The converter can emit these mechanically. |
| 3 | **Converted tests assert nothing and pass anyway.** With zero source assertions, a converted blueprint is a click-through. It will go green while the offer status is wrong. | Certain | Do not accept a blueprint without at least one `verify_field` or `verify_message` per scenario, authored by hand from the functional intent (the Jira ticket id is in every scenario title, so the expected result is retrievable). Treat this as the main value-add of the migration, and price it into the effort. |
| 4 | **Export incompleteness is invisible.** 60 of the 66 objects used by commented scenarios have no locator row. Someone quoting a conversion effort from a file listing would be off by a factor of three. | Medium | Run the coverage check (object references vs object repository rows) on every export before quoting anything. It is a five-line script and it is already written. Require scenarios to be active in IQP at export time. |
| 5 | **The sample is one module and may not be representative.** All active scenarios here are Redwood. `frameLocatorsPriority` is empty everywhere, so ADF iframes and shadow DOM handling are untested. Class A share could be much lower in a suite recorded by a different consultant with different naming habits. | Medium | Before committing to a converter, obtain one more export from a different module and ideally a different author, and rerun the classification script. That is a 30 minute check that de-risks the whole estimate. |

## 5. Verdict

**Translatability, over meaningful steps: ~52% direct, ~42% assisted, ~5% needs a schema extension,
~2% untranslatable. Confidence in these numbers for this corpus: high (85%). Confidence that they hold
for the wider IQP asset base: low (40%), on a one-module sample.**

Conversion is feasible. The intent is recoverable in every case except one custom function and one
positional XPath. The blocking question is not "can it be converted" but "is a converter worth building
for the volume that actually exists".

### Effort

| Item | Estimate |
|---|---|
| Thin deterministic converter (parse 13 verbs, join 3 files, extract class A labels, drop waits/screenshots, match the LOV idiom, emit YAML with `# INFERRED:` markers) | 5 to 7 h |
| Full converter (plus LLM pass for class B labels, hints generation, session/persona blocks, popups, capture) | 12 to 16 h |
| Manual LLM-assisted conversion, per scenario, without a converter | 0.4 to 0.6 h |
| Review of converter output, per scenario | 0.15 h |
| Authoring assertions, per scenario (unavoidable either way) | 0.3 to 0.5 h |

**Break-even: about 15 scenarios for the thin converter, about 40 for the full one.** Below 15 scenarios,
building a converter is a hobby, not an economy. The corpus in hand is 7.

## 6. Options

**Option A, skip the converter.** Convert these 7 scenarios by hand with LLM assistance (about 4 h
including assertions), go straight to the Playwright interpreter. Fastest path to a working framework.
Correct if the IQP asset base you actually need to migrate is small or if you mainly want a beachhead to
demonstrate the approach.

**Option B, thin converter now.** 5 to 7 h, deterministic, no LLM in the pipeline. It handles the 52%
direct mechanically and emits explicit `# INFERRED:` and `needs_verification` markers for the rest, so
review is targeted rather than line by line. It is also a reusable asset if more exports arrive later,
and it doubles as the export-quality checker (risk 4). Correct if you expect to see more IQP exports,
even without knowing how many.

**Option C, hybrid, recommended.** Do Option A's manual conversion for the pilot scenarios **and** start
phase 4 immediately, then build the thin converter only once the interpreter has proved which parts of
the YAML actually matter in practice. Rationale: the schema will change during phase 4 (session blocks,
hints, verify semantics), and a converter built before that will be rewritten. Building the interpreter
first also front-loads the real technical risk, which is Redwood label resolution on live pages, not
parsing.

Under all three options the framework is the destination and the converter is optional. Nothing measured
here argues against phase 4.

## 7. Two decisions needed before phase 3 or 4

1. **Volume.** How many IQP scenarios do you actually intend to migrate, order of magnitude? 7, 70, or
   700? This alone decides between options A, B and C.
2. **One more export, ideally ADF-heavy and from another author.** 30 minutes of your time, and it moves
   confidence in the extrapolation from 40% to something usable. Without it, every number in section 5
   describes one module by one person.

## 8. Immediate housekeeping, unrelated to the verdict

`iqp-data-extract/Learning_Sample (1).csv` contains a DEV pod URL, six usernames, two cleartext passwords
and one real person's full name. `.gitignore` now excludes the directory. If this export has been sent
by email or stored outside the workstation, the DEV credentials should be rotated. This is a note, not
an alarm: it is a DEV pod, not production.
