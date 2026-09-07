# Phase 1: IQP data model reconstruction

Evidence base: the three files inventoried in `00-inventory.md`. Every claim below is backed by a
quote from those files. Unknowns are marked **UNKNOWN** and not guessed.

## Model in one sentence

IQP exports a **keyword-driven, Gherkin-fronted, three-file model**: a `.feature` file holding ordered
natural-language steps drawn from a closed verb vocabulary, a CSV **object repository** mapping symbolic
object names to XPath locators per scenario, and a CSV **data profile** mapping symbolic parameter names
to literal values. The step text contains no locator and no data value, only symbolic references.

```
Learning_Sample.feature            Learning_Sample.csv                  Learning_Sample (1).csv
  step: I enter into             objectName: AddAPerson            header: AddAPerson
  input field "[AddAPerson]"     objectValue: xpath://input        value:  1845
  the value "(AddAPerson)"         [@placeholder='Type the ...']
        |                                ^                               ^
        +-- [ ] resolves to -------------+                               |
        +-- ( ) resolves to ---------------------------------------------+
```

This three-way separation is the single most favourable fact for the project: **IQP already separates
intent from binding.** The target blueprint format asks for the same separation.

## Q1. Test case anatomy

A test case is a `Scenario:` block: a tag line, a title, then an ordered flat list of steps. No nesting,
no sub-blocks, no `Background`, no `Scenario Outline`, no `Examples` table. The title encodes three
things by convention: sequence number, functional name, and the ALM/Jira ticket id.

```gherkin
Scenario: 1 Assign Learning (specialist)_PROJ-10240
Scenario: 5 Create a Course_PROJ-10237
Scenario: 6 Create Offering_PROJ-10238
```

A step carries: a verb (the keyword), zero or one object reference `[X]`, zero or one value `(Y)` or
literal. There is no separate "expected result" field on a step.

## Q2. Action vocabulary (the full observed set, with frequencies)

Corpus: 439 steps (142 active, 297 commented). 13 distinct verbs.

| Verb (normalised) | Active | Commented | Total | % of corpus |
|---|---:|---:|---:|---:|
| `I add wait seconds of "N"` | 60 | 124 | 184 | 41.9 |
| `I click on "[X]" link` / `... button` | 30 | 74 | 104 | 23.7 |
| `I enter into input field "[X]" the value "V"` | 24 | 33 | 57 | 13.0 |
| `I take screenshot` | 12 | 39 | 51 | 11.6 |
| `I navigate to "(URL)"` | 3 | 8 | 11 | 2.5 |
| `I press enter key on "[X]"` / `press tab key on "[X]"` | 2 | 7 | 9 | 2.1 |
| `I clear the content of input field "[X]"` | 5 | 0 | 5 | 1.1 |
| `I close browser` | 0 | 5 | 5 | 1.1 |
| `I switch to new window` / `close new window` / `switch to main window` | 0 | 4 | 4 | 0.9 |
| `I capture return value as "v" from custom code "F" run with arguments` plus arg rows | 4 | 0 | 4 | 0.9 |
| `I scroll to end of page` / `scroll to element "[X]"` / `scroll down on page by "N" pixels` | 0 | 3 | 3 | 0.7 |
| `I capture element "[X]" as variable` | 2 | 0 | 2 | 0.5 |
| **assertion of any kind** | **0** | **0** | **0** | **0.0** |

The vocabulary is small, closed, and mechanically parseable: each verb is a fixed sentence template with
quoted slots. A regex-per-verb parser is sufficient. No linear Selenium code appears anywhere.

## Q3. Locator storage (decisive question 1)

Locators live **exclusively in the separate object repository CSV**, never inline in a step. 63 rows,
32 unique (objectName, xpath) pairs, 29 unique XPath expressions.

Format is uniformly `xpath:<expression>`. **100% XPath, 0% CSS, 0% id strategy, 0% accessibility-based
strategy.** `frameLocatorsPriority` is empty everywhere, so no iframe handling is encoded in this export
(the Learning module here is Redwood, which does not use ADF iframes; **UNKNOWN** whether ADF-heavy
suites populate that column).

The repository is **denormalised per scenario**: the same object (for example `PubStartDate`) is
redeclared in every scenario that uses it, sometimes with a different `keywordIdentifier`. There is no
shared, global object repository in this export. Fixing a rotten locator therefore means fixing it once
per scenario, which is exactly the maintenance cost the project is trying to eliminate.

## Q4. Semantic anchors (decisive question 2)

**Present, and doubly so.** This is the key finding of phase 1.

**Anchor source A, the object name.** Names are human-authored and functional, not generated:
`UserId`, `SignIn`, `Navigator`, `MyClientGroups`, `LearningAssignment`, `AddLeader`, `SelectItem`,
`ItemName`, `AddItem`, `NextAddItem`, `AddAPerson`, `SubmitLearning`, `PubStartDate`, `PubEndDate`,
`ShortDesc`, `CategoryCourse`, `S&VlCourse` (Save and Close), `offeringtitile` (sic), `sylllabus` (sic).
Typos and abbreviations exist but the intent is readable by a human or an LLM in every case.

**Anchor source B, the visible string inside the XPath.** Classification of the 32 unique objects:

| Class | Count | % | Example |
|---|---:|---:|---|
| A. Visible text or accessible attribute (`text()=`, `@aria-label`, `@title`, `@placeholder`) | 19 | 59.4 | `.//div[@aria-label='Add Learners']`, `.//button[text()='Next']` |
| B. Generated or internal id fragment (`contains(@id,'...')`, `@id='...'`) | 11 | 34.4 | `.//span[contains(@id,'sdDt')]/input[1]` |
| C. Other attribute | 1 | 3.1 | `//input[@type='password']` |
| D. Purely structural | 1 | 3.1 | `//div[@contenteditable='true']` |

Class A yields the on-screen label **mechanically**, by regex extraction, with no inference:
`Add Learners`, `Next`, `Save and Close`, `Submit`, `Select Item`, `Learning Assignments`, `Courses`,
`Create`, `Offerings`, `Self-Paced Offering`, `Voluntary Assignment`, `Username`, `Navigator`,
`Enter a search term.`, `Type the name of a person you want to add`, `Add Item`.

Class B carries no visible label, but the object name plus the id fragment usually make the intent
obvious to an LLM (`PubStartDate` plus `sdDt` = the Start Date field; `CourseNum` plus `crnmLbl` = the
Course Number read-only label). One class B object is genuinely opaque and positional:
`.//div[contains(@id,'adCwMn')]/div[1]/table[1]/tbody[1]/tr[1]/td[3]/div[1]` for `OfferingCreate`,
where only the object name survives as intent and the real on-screen label must be confirmed on a
live page.

## Q5. Test data

Fully externalised. `(Name)` in a step resolves to a column header in the data CSV. Coverage over active
scenarios is complete: 26 parameter references, 13 distinct, **0 unresolved**. The file holds exactly one
value row, so one data profile per suite, no data-driven iteration in this export.

Inline literals do occur, mixed with references, in commented scenarios:
`And I enter into input field "[TypeRecord]" the value "External Training Approval"`.

A runtime variable mechanism also exists: `$title_course$`, populated by a capture step.

## Q6. Assertions

**There are none.** Zero verification steps across 439 steps. The vocabulary contains no `verify`,
`check`, `assert`, `should see`, or comparison verb of any kind.

The de facto verification method is `I take screenshot` (51 occurrences, 11.6% of the corpus), reviewed
by a human after the run. A test therefore passes as long as every element was found and clicked; it
cannot fail on wrong business data, wrong status, or a silent Oracle error banner.

This is the largest functional gap in the source material, and it is a gap in IQP, not in the target.

## Q7. Structure and reuse

**No reuse mechanism is visible.** No `Background`, no called scenarios, no shared step libraries, no
imported modules. The login block (navigate, user, password, sign in, wait, navigator) is copy-pasted
verbatim at the head of every scenario, 11 times across the corpus. The object repository is likewise
duplicated per scenario. The corpus is pure copy-paste composition.

One extension point exists: an external custom code hook.

```gherkin
And I capture return value as "title_course" from custom code "GenerateRandomString" run with arguments
|"string"|
|"3"|
|"4"|
```

The implementation of `GenerateRandomString` is **not in the export**. Only the call signature is
recoverable. **UNKNOWN**: how many such custom functions exist across the wider IQP asset base, and
whether their source is exportable. This matters, because custom code is the one construct whose intent
cannot be recovered from the export alone.

## Q8. Oracle-specific handling

- **LOV and type-ahead**: encoded as a multi-step idiom, not as a dedicated keyword.
  `enter into input field`, then `add wait seconds`, then `press enter key` or `press tab key`.
  Sometimes a further step clicks the suggestion (`Recordcategorycalue`, `RecordpersonValue`).
  The idiom is recognisable and convertible, but it must be pattern-matched across consecutive steps,
  not translated step by step.
- **Synchronisation**: hardcoded sleeps only, 184 of them, values from 2 to 40 seconds. Summed over the
  corpus this is roughly 40 minutes of pure sleeping. No conditional wait, no wait-for-element,
  no wait-for-network. This is the mechanism Playwright replaces entirely with auto-waiting.
- **Iframes**: not handled anywhere. `frameLocatorsPriority` empty in all rows. The active scenarios
  are Redwood pages. **UNKNOWN** for ADF-heavy modules.
- **Shadow DOM**: not addressed. The XPaths are ordinary document XPaths, which implies IQP is
  operating on pages where shadow DOM is not blocking, or is piercing it below the export layer.
- **Popups**: BPM approval notifications open a second window, handled by
  `switch to new window` / `close new window` / `switch to main window`.
- **Multi-persona flows**: scenarios 3 and 4 chain several logins in one scenario using
  `I close browser` followed by a fresh `Given I navigate to "(URL)"`, with a different user parameter.
  Scenario 4 runs four personas (employee, approver, learning specialist, HRBP) in one test.
- **Date entry**: dates are cleared before being filled (`I clear the content of input field
  "[PubStartDate]"`), because Oracle pre-populates them. Format in the data profile is mixed:
  `08/10/26` for one field, `2026-08-10` for others.

## Q9. Execution artifacts

None in this export. No run report, no failure log, no screenshot, no DOM snapshot, no failing-selector
record. **UNKNOWN** whether IQP can export them. This blocks any assessment of a future self-healing
loop over IQP assets, and it is worth a targeted question to the IQP platform team.

## Q10. Volume

| Metric | Value |
|---|---:|
| Feature files | 1 |
| Scenarios declared | 7 |
| Scenarios active | 3 |
| Steps, active | 142 |
| Steps, commented | 297 |
| Steps, total | 439 |
| Steps per scenario, range | 21 to 121 |
| Distinct verbs | 13 |
| Object repository rows | 63 |
| Distinct objects, active scenarios | 32 |
| Distinct objects referenced, commented scenarios | 66 (60 with no locator exported) |
| Data parameters | 32 columns, 1 value row |
| Assertions | 0 |

After removing waits, screenshots and scrolls, roughly **43% of steps carry actual test intent**; the
other 57% is synchronisation and evidence-capture scaffolding.
