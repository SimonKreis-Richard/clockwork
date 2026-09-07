# Phase 4b: pilot conversion notes, and what the schema learned
<!-- superseded-banner -->

> **HISTORICAL. This describes blueprint schema v0.1, which no longer exists.**
>
> The schema changes celebrated below (`sessions:`, `legacy_xpath`, `needs_verification`) were all
> removed in v0.2. The pilot itself is still worth reading: it is the record of which inferred
> labels were wrong and why. See `SPEC-v3-mvp.md` section 6 for the schema that actually runs.


Two scenarios were converted mechanically then reviewed by hand: `create_a_course` (simple) and
`assign_learning_specialist` (list of values heavy). A third, `create_offering`, was converted and
left as the converter produced it, as a control sample.

## Compression achieved

| Scenario | IQP steps | Blueprint steps | Ratio |
|---|---:|---:|---:|
| 1 Assign Learning (specialist) | 43 | 13 | 3.3x |
| 5 Create a Course | 33 | 13 | 2.5x |
| 6 Create Offering | 55 | 21 | 2.6x |

The reduction is not compression for its own sake. Everything removed was either a hardcoded sleep,
a screenshot step, or an object repository indirection, and none of the three exists any more.

## Labels: how many were free

Of the 32 distinct objects in the export, 19 carried their visible label inside the IQP XPath and
converted with zero inference. The remaining 13 were bound to generated Oracle ids and got a guess.

The guesses the converter made, and what was done with them:

| IQP object | Bound to | Guessed label | Reviewed to |
|---|---|---|---|
| `title` | `ttlInp` | Title | kept |
| `sylllabus` | any contenteditable div | Sylllabus | **corrected to "Syllabus"** (typo was in the IQP object name) |
| `ShortDesc` | `shdsInp` | Short Description | kept |
| `PubStartDate` | `sdDt` | Publish Start Date | kept |
| `PubEndDate` | `edDt` | Publish End Date | kept |
| `CourseNum` | `crnmLbl` | Course Number | kept |
| `CategoryCourse` | `trainingCategory` | Category Course | **corrected to "Category", and turned into a `select`** |
| `MyClientGroups` | `groupNode_workforce_management` | My Client Groups | kept, and it is a good guess |
| `OfferingCreate` | `adCwMn` plus a positional chain | Offering Create | left as is, genuinely opaque, must be recorded |

Every one of these still carries its `legacy_xpath`, so they work even if the guess is wrong. The
report will say which ones needed the fallback.

## Schema changes made during the pilot (v0 to v0.1)

| Change | Why |
|---|---|
| `select` gained `commit` and `skip_confirm` | Fusion commits a list of values three different ways. The default tries the option list, then falls back to a key press, which is what IQP did. |
| `fill` gained `press_enter` | IQP's "fill then press Enter" is a search submission, not a list of values. Conflating the two would have made the item search fail. |
| Added `sessions:` | IQP scenarios 3 and 4 log in as up to four people in a row. v0 had no way to express that. Each session now gets its own browser context. |
| Added `capture` | IQP reads the generated course number and reuses it. |
| Added `switch_window` and `close_window` | BPM approval notifications open a popup. |
| Added `legacy_xpath` and `needs_verification` on every element step | The safety net and the debt marker. This is the change that guarantees the engine cannot do worse than IQP. |
| Added a `value` element kind internally | Found by the self test: a read only field's label and its value are two separate elements, so looking for the label text captured the label. See below. |
| Dropped `login`'s separate navigate step | The login block is five IQP steps and one blueprint step. |

`v0`'s original nine keywords survived. The vocabulary did not grow: `submit` was folded into
`click`, and `wait_for` became semantic rather than a sleep.

## Conversion rules that involved judgement

All of them conservative, all of them behaviour preserving:

- A run of clicks starting at Navigator or Home collapses into one `navigate` path, ending at the
  next screenshot. IQP authors put screenshots at logical checkpoints, which turns out to be a
  usable boundary marker. In `create_a_course` the run swallowed one extra click ("Create", which
  is an action, not navigation). Behaviour is identical; it was split by hand during review and the
  converter reports any path longer than four entries so the same check can be made next time.
- `fill` then Tab becomes `select`. `fill` then Enter stays `fill` with `press_enter`.
- A field whose label matches category, business unit, person, manager, location or department and
  that was left as a `fill` is flagged in the conversion report as a probable list of values.
- Custom code is not translated. `GenerateRandomString` is written out as a comment pointing at the
  built in `{{random_string(n)}}`.

## What the self test caught

The offline end to end test found one real engine bug before any environment was involved:
`capture` on "Course Number" returned the string "Course Number" rather than the value beside it,
because the resolution chain matched the label element. Fixed by giving read only reads their own
strategy order (labelled control, then the element following the label, then the label itself).

That is the argument for keeping `npm run selftest` green: it is the only thing that can fail
honestly before the DEV credentials exist.

## What is still unverified, and can only be verified against a live pod

1. Every label marked `needs_verification`. Thirteen of them.
2. The list of values option markup. `config.lov.optionContainers` is a first draft covering Oracle
   JET and classic ADF patterns, written without seeing a Redwood page.
3. The Oracle error indicators in `config.errorIndicators`, same caveat.
4. Whether the two "Next" buttons in `assign_learning_specialist` are ever visible simultaneously.
   If the report flags them as ambiguous, they need a `section` hint.
5. The sign in field labels in `config.login`. Five candidates are tried in order; the real one is
   whichever the identity provider uses.

None of these is a design question. They are all one live run away from being answered.

## Throughput estimate for the full corpus

Converter output plus review took about 25 minutes for the two pilots, most of it spent on the
label corrections rather than the mechanics. On a larger export, expect roughly 10 minutes of
review per scenario, plus one live run per scenario to confirm the inferred labels. Scenarios whose
objects all carry visible labels (the 52% case) should need no review at all beyond a glance.
