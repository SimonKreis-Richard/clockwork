---
name: first-live-run
description: Point the blueprint engine at a real Oracle Fusion environment for the first time, or after a quarterly patch. Covers capturing the session, the order to tune the two Oracle specific config lists, and how to read the run journal to decide what to fix. Use when the operator supplies a DEV pod URL, when a previously green suite starts failing after an Oracle patch, or when a blueprint pauses on a label that no longer exists.
---

# First live run against Oracle

The engine has never touched a real Oracle page. Everything Oracle specific in `src/config.ts` is a
first draft. This procedure gets from "never connected" to "a blueprint runs green" without
thrashing.

Work in this order. Each step tells you what to do when it fails. Do not skip ahead: a failure in
step 2 is unreadable if step 1 was never confirmed.

## 0. Preconditions

```bash
npm install
npm run install:browsers
npm run check          # must be 50 passed before you blame Oracle for anything
cp .env.example .env
```

Fill two things in `.env`:

- `BLUEPRINT_WORKSPACE`, the directory outside this repository holding `blueprints/` and `data/`.
  Without it there is nothing to run: the engine finds no blueprints and `npm test` skips.
- `ORACLE_BASE_URL`, a DEV or TEST pod.

There is no password to fill in, and nowhere to put one.

If `npm run check` is not green, stop. The problem is in the engine, not the environment, and the
offline self test will tell you exactly where.

## 1. Capture the session

```bash
npm run auth
```

A browser opens on the pod. The **operator** signs in by hand, including any second factor, then
presses Enter. The session lands in `.auth/storageState.json` and every run reuses it.

This is the step that used to be the project's one real risk, when the engine typed a password
itself and MFA could have killed the whole idea. It cannot any more: a person answers whatever the
identity provider asks. Do not add a `login` keyword back, do not put credentials in `.env`, and do
not automate this. See `memory/PROJECT.md` D13.

| Symptom | Meaning | Fix |
|---|---|---|
| `Refusing to run: host ... does not carry a recognised non production token` | The production guard does not recognise the pod naming. | Add the token to `ALLOWED_ENV_TOKENS` in `.env`. Do **not** set `ALLOW_UNRECOGNISED_HOST` unless you have read the hostname and are certain it is not production. |
| `Nothing to save: the browser held no cookies` | The sign in never completed. | Try again, and watch the window this time. |
| A run says `Not signed in` although auth just ran | The pod sets its session on a different origin, or the file went somewhere unexpected. | Check the path the tool printed, and that `ORACLE_BASE_URL` is the same host you signed in to. |

Then run one scenario and watch it:

```bash
npm run test:one -- "<any scenario name>"
```

Stop here and report to the operator once a run gets past the opening navigation into the
application. That is the go/no-go, and it is now a formality rather than a risk.

## 2. Tune the list of values, then the error indicators

Do these two in this order and one at a time, because a bad error indicator makes every step look
like it failed for the wrong reason.

**Lists of values** are the number one breakage point on Fusion. If a `select` step fails with
"the field holds X afterwards", type into the field by hand in the paused window and inspect what
the suggestion list is actually made of. Add its container to `config.lov.optionContainers`. If the
control turns out to be a plain choice list rather than a type ahead, the fix is `mode: dropdown`
on that step, not a config change. Only if a real list genuinely never renders should you fall back
to `commit: tab`, which is what IQP did and is strictly weaker.

**Error indicators**: trigger a real Oracle validation error by hand (submit a form with a mandatory
field empty), and check that `config.errorIndicators` catches it. Then confirm a *confirmation*
banner does **not** trip it, adding to `config.errorIgnorePatterns` if needed. A false positive here
fails every scenario at its last step and is very confusing.

## 3. Expect to be paused, and use it

Assisted mode is on by default. A step whose label no longer matches does not fail the run: it
pauses on that screen with a banner. On a first live run against blueprints converted from IQP, most
of which carry guessed labels, **this will happen often, and that is the plan**.

For each pause: do the action in that window, check what the banner says it captured, press Resume.
The blueprint file is corrected as you go. A converted suite is meant to be walked through once like
this, not debugged from a log.

If you would rather collect failures than fix them, run with `ASSIST=false HEADLESS=true` and read
the report instead. That is the right mode for a regression check on a suite that already works,
and the wrong one for a first pass.

## 4. Read the journal, not just the pass or fail

```bash
npm run report
```

Two sections tell you what to do next:

- **Steps repaired during the run.** Old label next to new. This is your change log of what Oracle
  renamed, and the thing to review with fresh eyes: the engine wrote down what you clicked, not
  necessarily what you meant.
- **Ambiguous labels.** The label matched several elements and the first visible one was assumed.
  Add a `hints:` block with `section` or `index`.

## 5. What "done" looks like

- One converted blueprint runs green end to end, screenshot on every step.
- A deliberately wrong label pauses the run, accepts the tester's action, updates the blueprint from
  the element they clicked, and continues.
- An operation Oracle rejects fails the run carrying Oracle's own error text.
- Three tests run in parallel and each pauses independently, resumed from its own window.

The first three are already verified offline by `npm run selftest`, so if they hold live too, the
engine is sound and everything after this is content, not construction.

## After a quarterly Oracle patch

Re-run from step 3, with assisted mode on. The repair list from that run is the patch's change log,
and producing it is what this engine is for.
