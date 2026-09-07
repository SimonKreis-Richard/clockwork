# Clockwork

> Coding agents: start with [AGENTS.md](AGENTS.md) and [memory/PROJECT.md](memory/PROJECT.md).
> This README is the operator facing manual for writing and running blueprints.

A two way translator between what a person does in a browser and a portable, readable test file,
plus an engine that replays that file against a web application and stops the moment reality
diverges. It screenshots every step and produces a pass or fail report.

When the application has renamed something, the run does not fail. It **pauses on that screen**,
tells you what it was looking for, lets you do the action yourself, and writes your correction back
into the test file. The test file is a draft; the run is the compiler.

The durable asset is the blueprint: the intent of a test, expressed as the labels a person sees on
screen. There is no selector in it, anywhere, ever.

Built for Oracle Fusion Cloud, and not tied to it: everything application specific sits in three
lists in [src/config.ts](src/config.ts).

## Status: works offline, never yet run against a real environment

Read this before you judge anything else here.

The engine is complete and verified **against a fake application built for the purpose**: 50 offline
checks covering the resolution chain, frames, the list of values, error detection, the IQP converter,
the report generator and assisted mode end to end. `npm run check` runs them with no credentials, no
network and no configuration.

**It has never touched a real Oracle Fusion pod.** That step needs an environment its author does not
yet have open, and it is the one thing that cannot be done offline. Expect the three
application specific lists in `src/config.ts` to need tuning on first contact; they were written from
an analysis of exported test definitions, not from a live page.

So: sound engine, unproven integration. If you are looking for something battle tested against
Oracle, this is not it yet. If you are looking for a small, readable engine that binds tests to
visible labels instead of selectors, all of that part works and is tested.

## The name

A wind up toy. Not a robot, not an agent, not an assistant. The image came from the operator during
the design discussions and it turned out to describe every decision in this project, so it became
the name:

| The toy | The engine |
|---|---|
| **Stored energy.** Everything it will do is wound in beforehand. | A blueprint is written first, and the run only spends what is in it. |
| **A straight line.** It has no steering. | No conditional branching, ever. That is a permanent scope decision, not a missing feature. |
| **No autonomy.** It does not decide anything. | No self healing, no retries, no guessing which element you probably meant. |
| **A clean stop at the first obstacle.** It does not thrash, it does not fall over, it stops. | A step that cannot find its element halts the run and says exactly what it was looking for. A blocked test is a valid outcome, not a defect. |
| **You pick it up and put it back on course.** | Assisted mode: the browser waits for you on the failing screen, and you do the action yourself. |

And the one thing a real wind up toy cannot do, which is the whole point of this version: **it
remembers the correction.** What you did by hand is written back into the test file, so the next run
does not stop there.

Anything that would make it steer around an obstacle by itself is out of scope, permanently. That is
what the name is for: it makes the boundary easy to remember, and easy to say no with.

## Getting started

```bash
npm install
npm run install:browsers
```

Check that the engine itself works, with no Oracle environment and no credentials:

```bash
npm run selftest
```

That runs 50 checks: a fake Oracle exercises the engine end to end (navigation, a list of values
with an asynchronous suggestion list, a plain dropdown, a field inside an iframe, a read only field,
error detection, assisted mode), and a synthetic IQP export exercises the converter. If it is green,
anything that breaks later is Oracle specific, not engine specific.

Then point it at a real environment:

```bash
cp .env.example .env
```

Two things to fill in:

- `BLUEPRINT_WORKSPACE`, the directory holding your `blueprints/` and `data/`. They live outside
  this repository because they contain client scenarios and usernames. See the workspace README.
- `ORACLE_BASE_URL`, a DEV or TEST pod. The engine refuses to start against a production one.

There is no password to fill in. See the next section.

## Signing in, once

```bash
npm run auth
```

A browser opens on your pod. **You** sign in, by hand, including any second factor. When the home
page is up, press Enter in the terminal. The session is saved to `.auth/storageState.json` and every
run reuses it until it expires.

Why it works this way:

- no password ever touches this repository, a config file or a test
- multi factor authentication stops being a problem, because a person answers it
- a blueprint starts at its first real action, with no sign in steps to maintain

That file holds live session cookies: it is exactly as sensitive as the password. It is gitignored,
and it never leaves your machine. When it expires the engine says so by name and tells you to run
the command again.

## Running tests

```bash
npm test                              # every blueprint in blueprints/
npm run test:one -- "create_a_course" # one of them
npm run ui                            # Playwright's UI mode: the supervision screen
npm run report                        # standardised summary of the last run
```

Runs are **headed** by default: assisted mode needs a window you can act in. Set `HEADLESS=true` in
`.env` for a run nobody is watching, and `ASSIST=false` with it, so a wrong label fails the run
instead of waiting forever for a person who is not there.

To run several scenarios at once, set `WORKERS` in `.env`. Three to five is realistic for one
person supervising. The limit is not the machine: two scenarios creating the same object in the
same environment collide, so a parallel batch has to be composed of independent scenarios.

Reports land in `reports/`:

| File | What it is |
|---|---|
| `journal-<run>.jsonl` | One record per step. The durable artifact: every other report is generated from it. |
| `summary-<run>.md` and `.html` | The pass or fail summary, screenshots embedded, safe to email. |
| `screenshots/<run>/` | One image per step. |
| `playwright-html/` | Playwright's own report, with a replayable trace of the whole run. |

## When a step cannot find its element

This is the normal way a test ends its first life, not an accident.

1. The run stops at that step and **leaves the browser open on the failing screen**.
2. A banner appears at the top of that page: which step, which label it wanted, and every label
   that is actually on the page right now.
3. Do the action yourself, in that window. The engine watches what you click.
4. Press **Resume**. It tells you what it captured, writes that label into the blueprint file, and
   carries on at the next step.

You can also click one of the labels in the banner to choose it directly, or press **Stop this
test** to end the run and get an ordinary red result.

Two consequences worth knowing:

- The run continues at the **next** step. It does not repeat the action you just performed by hand,
  because doing so would click Save twice.
- A blueprint therefore does not have to be right when it is written. Ten lines of approximate
  plain language, run and repaired as it goes, is a legitimate way to author a test.

With several tests running at once, each pauses in its own window and is resumed there. That is why
there is no dashboard: use `npm run ui` to see the list, and the paused window itself to fix it.

## Writing a test

A blueprint is a YAML file in `<workspace>/blueprints/`. Drop a file in, it runs. There is no code
to write.

```yaml
scenario: create_a_course
source: PROJ-10237          # the ticket, for traceability
data_profile: learning_sample_default

steps:
  - action: navigate
    path: ["Navigator", "My Client Groups", "Learning", "Courses"]

  - action: click
    label: "Create"

  - action: fill
    label: "Title"
    value: "{{title}}"

  - action: select               # a list of values: types, picks the option, checks the field
    label: "Category"
    value: "HR"

  - action: click
    label: "Save and Close"

  - action: verify
    text_contains: "was created"
```

No sign in, no sign out, no persona. **One test is one person, in one session, from A to Z.** An
IQP scenario with four people becomes four blueprints, run in order by a human.

### The ten keywords

| Keyword | What it does |
|---|---|
| `navigate` | Walks a menu path: `path: ["Navigator", "My Team", "Learning"]`. Or jumps to a `url:`. |
| `click` | Clicks a button, link or menu entry by its visible label. `double: true` for a double click. |
| `fill` | Types into a field. Add `press_enter: true` for a search box. |
| `select` | A list of values: types, waits for the list, picks the option, then checks the field really holds it. `mode: dropdown` for a plain choice list you open rather than type into. |
| `press_key` | A key press: `key: "Tab"`. Add a `label:` to aim it at a field first. |
| `capture` | Reads a read only field into a variable: `as: course_number`, reused later as `{{course_number}}`. |
| `verify` | Checks a field value (`label` plus `equals` or `contains`) or the page (`text_contains`). |
| `wait_for` | Waits for something to appear or disappear. Rarely needed: waiting is automatic. |
| `switch_window` / `close_window` | For approval notifications that open a popup. |
| `refresh` | Reloads the page. |

The worked example that is also a test fixture, so it can never go stale, is
[selftest/blueprints/selftest_create_course.yaml](selftest/blueprints/selftest_create_course.yaml).

### Data

Values come from a profile in `data/`, referenced as `{{name}}`. There are no passwords in a
blueprint or a profile, and nowhere to put one.

Generators are available for values that must be unique on each run, replacing IQP's custom code:
`{{random_string(6)}}`, `{{random_number(4)}}`, `{{today()}}`, `{{today(1)}}`, `{{today_us()}}`,
`{{timestamp}}`.

### When the same label appears twice

Add a hint. Nothing else, and never a selector.

```yaml
  - action: click
    label: "Next"
    hints:
      section: "Add a Person"    # restrict to a named panel or dialog
      index: 1                   # or take the second match, counting from zero
```

The report flags every step where a label matched several elements, so you find these without
hunting for them.

### Frames

There is nothing to write. A page embedded in a page (BI Publisher, classic ADF regions) is
searched automatically, after the main document. IQP switches frame by index and breaks the day
Oracle adds one; here the blueprint never mentions frames at all.

## Converting from an IQP export

```bash
npm run convert                       # reads <workspace>/iqp-exports
npm run convert -- <exportDir> <outDir>
```

It joins the three IQP files and writes blueprints. Where the original XPath contains a visible
label, that label is used. Where it does not, which is most of the time, the label is guessed from
the IQP object name and marked with an `# INFERRED` comment: the first run will tell you whether
the guess was right, and let you correct it on the spot.

A scenario that signs in as several people in a row becomes several blueprints, `_1`, `_2`, `_3`,
to be run in order. What the converter refuses to translate (custom code, image recognition,
conditional branching, a verb it has never seen) is written into the file as a comment rather than
dropped, so a blueprint is never quietly short of an action. Everything worth a second look is
listed in `reports/conversion-report.md`.

**Before exporting from IQP, make sure the scenarios are active.** A scenario commented out in IQP
exports its steps but none of its locators, so the export looks complete and is not.

## Why there is no selector anywhere

The resolution chain is:

```
visible label -> ARIA role and name -> placeholder -> adjacent text -> hints
```

and then it stops and asks you. Earlier versions kept the IQP XPath as a last resort, so the engine
"could never do worse than IQP". That rested on getting a complete object repository out of IQP,
and that turned out to be impossible: the exports carry 302 object references and no XPath at all.
A safety net that is always empty still costs a schema field, a code path and a concept, so it is
gone.

The consequence is deliberate. A step whose label is wrong now fails immediately instead of quietly
working against a selector that will rot at the next Oracle patch. Under assisted mode that is a
feature: the work surfaces at once, in front of somebody who can fix it in ten seconds.

## What this engine deliberately does not do

No self healing, no retries, no scheduling, no run history, no conditional branching, no dashboard.
It cannot test a four person approval chain in one run, and it cannot run unattended overnight: a
blocked test waits for a person. Each of those is a trade for an engine one person can build,
understand and maintain. See [SPEC-v3-mvp.md](SPEC-v3-mvp.md) for the reasoning.

## Layout

The client material is not here. It lives in a sibling directory, `../clockwork-workspace` by
default: `<workspace>/iqp-exports/`, `blueprints/`, `data/` and `reports/`. See its own README.
That separation is what keeps this repository anonymous and reusable across engagements.

```
src/
  locate.ts        the resolution chain. The heart of the project.
  assist.ts        the pause, the banner, the click capture, the file repair
  interpreter.ts   walks the steps, screenshots, journals
  keywords/        one module per action
  errors.ts        Oracle error detection
  config.ts        every tuning point, including the production guard
tools/
  capture-session.ts  npm run auth
  convert-iqp.ts      IQP export to blueprints
  report.ts           journal to summary
selftest/          the fake Oracle, a synthetic IQP export, and the offline suite
EXPLORATION/       the analysis of the IQP export that led here (anonymised)
```

## Licence

MIT. See [LICENSE](LICENSE).

Nothing client derived is in this repository, by construction: scenarios, data profiles and raw
exports live in a workspace directory outside it. Everything here that looks like a real system is
synthetic, including the fake Oracle under `selftest/` and the sample export next to it.
