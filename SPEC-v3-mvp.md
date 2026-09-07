# SPEC v3: supervised translation engine (MVP)

Status: current. Supersedes `SPEC-v2-engine.md`, which is kept for its reasoning and its record of
what was already built. `docs/SPEC-v1-original.md` remains historical only.
Decided 2026-08-29 after reviewing four further IQP exports (1852 steps, 35 distinct verbs).
Language of all code, comments, schemas and reports: English.

---

## 1. What the product is, in one sentence

**A two way translator between what a person does in a browser and a portable, human readable test
file, plus an execution engine that replays that file and stops the moment reality diverges.**

```
person performs the test in the GUI   ->   portable test file
portable test file                    ->   execution, supervised by a person
```

This is a reframing, not a new project. v2 described "a replacement for the IQP execution engine".
That was too narrow: it made IQP the centre of gravity. IQP is now one input format among several,
and the durable asset is the test file itself.

**The governing image, from the operator:** a wind up toy. Stored energy, a straight line, no
autonomy whatsoever, and a clean stop at the first obstacle. Anything resembling "the toy steers
around the obstacle by itself" is permanently out of scope. What is new in v3 is that when someone
picks the toy up and puts it back on course, **the engine remembers the correction.**

## 1b. Hard constraints

Four rules that are not preferences. Each one, if broken, either kills a whole feature or reopens a
scope decision that was closed deliberately. They are repeated in context further down; they are
gathered here because an implementer reads the schema before reaching section 7.

**C1. The browser stays open and paused on the failing screen.**
Web state cannot be saved and restored. Resuming at step 8 is only possible in the very browser that
reached step 7. Any design that closes the page and reopens it has silently removed assisted mode.

**C2. The resume control lives inside the paused page, never in a central interface.**
An in page banner carrying the explanation and a Resume button. With several tests paused at once, a
single terminal prompt cannot ask which one, and the tester is already in that window. This is also
what keeps the parallel workflow free of any interface to build.

**C3. The per test timeout is disabled while a test is paused.**
Playwright's default kills a test after ten minutes. A test waiting for a human will exceed that
every time. Forget this and assisted mode does not work at all, in a way that looks like a random
flake rather than a missing setting.

**C4. No dashboard. Supervision is `playwright test --ui`.**
It already provides a live test list, status, pause and inspection, and someone else maintains it.
A custom one is 3 to 5 days and reopens the "engine, not platform" door that D1 closed. Build custom
only against a specific, demonstrated gap, and say what the gap is.

## 2. What changed since v2, and why

Four decisions, all in the direction of less.

### 2.1 Stored selectors are gone

v2 kept the IQP XPath as the last link of the resolution chain, so the engine "could never do worse
than IQP". That argument rested on obtaining a complete IQP export including its object repository.
That assumption is dead: the operator now has IQP access and reports that objects must be extracted
one at a time. The four new exports contain **302 referenced objects and zero XPath**.

So the safety net would be empty in almost every case, while still costing a schema field, a code
path, tests and a concept to explain. It is removed. **Resolution is 100% semantic.**

Accepted consequence: a step whose label is wrong now fails immediately instead of quietly working.
Under section 4 that is a feature, not a regression: the work surfaces at once instead of hiding
until the next Oracle patch.

### 2.2 One test is one user session

No login steps, no logout steps, no persona switching, no `close browser`. A test covers what one
person can do from A to Z inside one active Oracle session.

An IQP scenario with four personas becomes **four separate tests**, run in sequence by a human. The
coverage is preserved; only the automatic chaining is lost. What this removes is large: the sessions
block, sign out handling, and the business process waits of up to 260 seconds that exist purely to
let an approval propagate to another user's inbox.

### 2.3 Authentication is infrastructure, not test content

The blueprint no longer starts with `login`. It starts with the first functional action and assumes
a live session. Authentication happens once, out of band, and the session is reused.

This removes passwords, `password_var` and per persona credentials from the schema entirely, and it
**neutralises the MFA risk**, which was open question Q1 and the one thing that could have killed
the project.

### 2.4 No conditional branching

The corpus contains `I check if ... / I end conditional check`: 2 occurrences out of 1852 steps,
0.1%. Adding branching to a declarative format is the first step towards a programming language,
which is what this project exists to avoid. Untranslatable, marked as such in a comment, revisited
only if a larger corpus proves it common.

## 3. What the new corpus corrected

Findings from `FixedAssets`, `Absence`, `HRLocalandGlobalTransfer` and `test_externaldata`.

**Assertions exist.** `EXPLORATION/02-translatability-report.md` states "zero assertions across the
corpus". That was true of the Learning module and **false in general**. The new files contain 26:

```gherkin
Then "[Depreciation_Success]" should be present
Then "[ProcessRow_status]" should have partial text as "Succeeded"
And "[PeriodAcrrual]" should have text as "(PeriodAcrrual1)"
```

`verify` therefore has real source material. Risk 3 of the phase 2 report is downgraded.

**Iframes are confirmed.** `switch to frame having xpath` and `having index` appear in the ADF heavy
FixedAssets suite. They were marked UNKNOWN in phase 1.

An iframe is a page embedded inside a page: searching the outer document for a label that lives
inside the inner one never finds it, whatever the search method. This is unrelated to XPath and is
not solved by removing selectors. **Handled automatically** (section 5), never mentioned in a
blueprint. This is strictly better than IQP, which switches by index and breaks whenever Oracle adds
a frame.

**Some sleeps are semantically necessary.** 758 sleeps totalling 80 minutes, but the distribution
matters: 660 are under 10 seconds (UI rendering, auto waiting replaces them) while 5 are 60 seconds
or more and wait for an approval workflow to propagate. Most of the latter disappear with 2.2; any
that remain inside a single session become an explicit `wait_for`.

**Vocabulary grew from 13 to 35 verbs**, still closed and self describing. New ones worth
implementing: `select from dropdown` (a real choice list, distinct from a type ahead list of
values), `double click`, `click on single key` (a key press not bound to a field), `refresh page`,
`download file`. Not implemented: `run visual button click` (image recognition, out of scope),
`check if / end conditional check` (2.4).

**Object names are readable.** Of 302 distinct object names with no locator attached, about 90% map
directly to an on screen label: `Absence Records`, `AddAbsence`, `SearchPerson`,
`Calculate_Depreciation`, `Sign_out`. Conversion from a `.feature` alone is therefore viable; every
label simply starts life unconfirmed.

## 4. Assisted mode: the heart of v3

The tester is not an operator waiting for a green run. **The tester is a supervisor of parallel
bots**, whose judgement is spent only where a machine has none.

A test that blocks is the expected outcome, not the exception. So blocking is designed for.

### The loop

1. The engine runs a blueprint until a step cannot resolve.
2. It **keeps the browser open, paused on the exact screen where it stopped** (C1).
3. It injects a banner into that page:
   *"Paused at step 7. I was looking for a field labelled "Paramètres". Do the action yourself, then
   click Resume."* The banner carries the Resume button.
4. It lists, in the banner and in the terminal, **every actionable label currently on the page**, so
   the tester can often fix it by reading rather than by clicking.
5. The tester performs the action in that window. A click listener captures the accessible name of
   whatever they clicked.
6. The tester clicks Resume. The engine proposes: *"you clicked "Settings and Actions". Update step 7
   and continue?"* On yes, the blueprint file is updated and the run continues.

Step 5 is the whole point: **the correction the tester was going to make anyway becomes reusable
knowledge, at no extra cost.**

### The consequence worth stating explicitly

If the engine learns at the point of failure, a blueprint no longer has to be correct when written.

> **The test file is a draft. The run is the compiler.**

A new test can be written as ten lines of approximate plain language, guessed from what is on
screen, then run and repaired as it goes. This is why the standalone recorder is not in the MVP: the
operator is repairing conversions, not authoring from nothing, and assisted mode is the exact tool
for that. A recorder solves "I have nothing"; that is not the situation.

### Why the resume control lives in the page (C2)

With several tests paused at once, a single terminal prompt cannot ask "which one?". Putting the
control in the paused page removes the question: the tester is already in that window. No central
interface has to exist.

## 5. Element resolution

```
1. getByLabel(label)                   exact visible form label
2. getByRole(role, { name: label })    accessible name, role inferred from the action
3. getByPlaceholder(label)
4. adjacent text                       the label, then the nearest control after it
5. hints                               section: "Assignment Info", index: 2
```

Then, and only then, failure: pause, explain, list what is on the page, learn.

**Frames are searched automatically.** The chain runs against the main document, then against each
embedded document in turn, so a blueprint never mentions an iframe.

**Nothing is ever stored as a selector.** `hints` is the only disambiguation, and it is
human readable by construction: a panel name and an ordinal, not a path.

For a control with genuinely no accessible name, `hints` is the answer. If no human can describe a
control by a visible name, no human can write or read that test step either, and the honest response
is a positional hint rather than a hidden selector.

## 6. Blueprint schema v0.2

Smaller than v0.1. Gone: `login`, `sessions`, `legacy_xpath`, `needs_verification`, `password_var`.

```yaml
scenario: create_a_course
source: PROJ-1002          # traceability, optional
app: oracle-hcm
area: learning
description: >
  A learning specialist creates a course and saves it.
data_profile: learning_default

steps:
  - action: navigate
    path: ["Navigator", "My Client Groups", "Learning", "Courses"]

  - action: click
    label: "Create"

  - action: fill
    label: "Title"
    value: "{{title}}"

  - action: select
    label: "Category"
    value: "{{category}}"

  - action: capture
    label: "Course Number"
    as: course_number

  - action: click
    label: "Save and Close"

  - action: verify
    text_contains: "was created"
```

### Keywords

| Keyword | Notes |
|---|---|
| `navigate` | A path of visible labels, or a URL. |
| `click` | Any clickable thing, by visible label. `double: true` for a double click. |
| `fill` | Types into a field. `press_enter: true` for a search box. |
| `select` | A list of values: type, wait for the list, pick by exact text, confirm the field holds it. `mode: dropdown` for a plain choice list. |
| `press_key` | A key press not bound to a field (Tab, Enter, Down). Replaces IQP's `click on single key`. |
| `capture` | Reads a read only value into a variable for later steps. |
| `verify` | `text_contains`, or a `label` with `equals` / `contains`. |
| `wait_for` | A named state change. Not a sleep. Rare by design. |
| `switch_window` / `close_window` | Popups still occur inside one session (BPM notifications). |
| `refresh` | Reload the page. Present in the corpus, trivial. |

Ten keywords. Adding an eleventh requires a real blueprint that needs it.

## 7. Supervision and parallelism

**Do not build a dashboard (C4).** `playwright test --ui` already provides a live list of tests, their
status, pause and inspection, and it is maintained by someone else. Use it for the MVP and build
something custom only against a specific, demonstrated gap.

Parallelism moves from `workers: 1` to configurable, with two conditions the operator has accepted:

- **Scenarios in one batch must be independent.** Two tests creating the same object at the same
  time collide in Oracle. This is a discipline of batch composition, not a technical limit.
- **Realistically 3 to 5 in parallel, not 12.** Beyond that nobody supervises anything. The number
  is a parameter, to be tuned in practice.

The per test timeout must be **disabled while a test is paused** (C3).

## 8. Authentication

One manual sign in, captured into a gitignored `storageState.json`, reused by every run until it
expires. Refreshing is a one command chore.

The production guard is unchanged and still applies before the first navigation: it reads the
environment token from the first hostname label, because an Oracle DEV pod is legitimately named
`fa-xxxx-dev1-saasfaprod1...` and a naive search for "prod" would block it.

## 9. Build order

Estimates are for one non professional developer working with an assistant.

| # | Step | Estimate | Status |
|---|---|---|---|
| 1 | Remove stored selectors, sessions and login from the engine and the schema | 0.5 d | **done** 2026-09-02 |
| 2 | Authentication as infrastructure: capture and reuse `storageState.json` | 0.5 d | **done** 2026-09-02 |
| 3 | Automatic frame search in the resolution chain | 0.5 d | **done** 2026-09-02 |
| 4 | New keywords: dropdown mode, double click, `press_key`, `refresh` | 0.5 d | **done** 2026-09-02 |
| 5 | **Assisted mode**: pause, in page banner, label listing, click capture, blueprint update, resume | 1.5 d | **done** 2026-09-02 |
| 6 | Converter updates: no locators expected, new verbs, one test per persona segment | 0.5 d | **done** 2026-09-02 |
| 7 | **First real run** against a DEV pod, then tuning the Oracle specific lists | 1 to 2 d | open, needs the operator |

**About 5 to 6 days.** Steps 1 to 4 were deletions and small additions; step 5 was the only genuinely
new construction; step 7 is the only one that cannot be done offline.

Steps 1 to 6 are verified by 50 offline tests (`npm run check`), including assisted mode driven
end to end with nobody there. Step 7 begins with `npm run auth`: the operator signs in by hand,
once.

Deferred to phase 2, explicitly not in the MVP: the standalone recorder (GUI to blueprint from
nothing), a custom supervision interface, reusable blueprint fragments for repeated patterns such as
Scheduled Processes, and the client facing report format.

## 10. What the MVP cannot do, stated plainly

- Test an approval workflow end to end in one run. Four personas means four tests, chained by a
  human.
- Run unattended overnight. Assisted mode assumes somebody is there. A blocked test waits.
- Branch on a condition.
- Recover from anything by itself. By design.

None of these is a defect. Each is a deliberate trade for an engine that one person can build,
understand and maintain.

## 11. Acceptance

- A converted blueprint runs green end to end against a real DEV pod, screenshot on every step.
- A step whose label is wrong pauses the run, shows the tester what is on the page, accepts their
  action, updates the blueprint from the element they clicked, and continues.
  **Verified offline** by `selftest/assist.spec.ts`.
- An operation Oracle rejects fails the run carrying Oracle's own error text, rather than going
  green. **Verified offline.**
- Three tests run in parallel and each pauses independently without blocking the others.
- Three tests pause at once and each is resumed from its own page, with no central interface (C2).
- A test paused for more than ten minutes is still alive and still resumable (C3).
  **Partly verified offline**: the setting that makes it possible (`timeout: 0`) is asserted, since
  the symptom itself takes eleven minutes to observe.
- `npm run check` still passes with no credentials, no workspace and no network. **Verified.**

Everything not marked verified needs the DEV pod, and therefore the operator.
