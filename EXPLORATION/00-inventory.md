# Phase 0: Inventory (raw observation, no interpretation)

Source directory: `iqp-data-extract/` (read-only, gitignored).
Observation date: 2026-08-24. All three files carry the same timestamp (2026-08-24 12:54) and the same
base name `Learning_Sample`, so they are one coherent export bundle of a single IQP test suite.

## 1. Tree

| File | Size | Lines | Encoding | Role (first guess) |
|---|---|---|---|---|
| `Learning_Sample.feature` | 18089 B | 455 | ASCII, CRLF | Test definitions (Gherkin / Cucumber) |
| `Learning_Sample.csv` | 9209 B | 64 | ASCII, CSV | Object repository (element locators) |
| `Learning_Sample (1).csv` | 973 B | 2 | ASCII, CSV | Test data (one parameter row) |

No zip bundles, no XML, no Excel, no execution reports, no config files, no Java/Selenium source.
Three files, three distinct roles, one functional module (Oracle HCM Learning).

## 2. File type 1: `.feature` (test definitions)

Standard Gherkin. One `Feature`, tag lines, `Scenario:` blocks, steps prefixed `Given` / `And`.
Representative extract (scenario 1, truncated):

```gherkin
@OracleHCM @Learning
Feature: Learning
@Learning_Sample1 @Learning_Sample1 @Learning_Sample1 ...
Scenario: 1 Assign Learning (specialist)_PROJ-10240
Given I navigate to "(URL)"
And I enter into input field "[UserId]" the value "(UserIdHRAdmin)"
And I click on "[SignIn]" link
And I add wait seconds of "5"
And I take screenshot
And I click on "[AddLeader]" link
```

Three notational conventions are visible in the step text:
- `[Name]` : reference into the object repository CSV.
- `(Name)` : reference into the test data CSV (column header).
- `$name$` : reference to a variable captured at runtime (seen once, scenario 6).

## 3. File type 2: `Learning_Sample.csv` (object repository)

Header: `sequenceNo,scenario,objectName,objectValue,executedValue,keywordIdentifier,scope,frameLocatorsPriority`
63 data rows. Representative extract:

```csv
0,Scenario: 1 Assign Learning (specialist)_PROJ-10240,UserId,xpath:(//span[text()='Username']/following::input)[1],,6a4fee472a29a5dbea1f860a,object,
7,Scenario: 1 Assign Learning (specialist)_PROJ-10240,AddLeader,xpath:.//div[@aria-label='Add Learners'],,68b816d4c5727969d60330a0,application,
18,Scenario: 6 Create Offering_PROJ-10238,OfferingCreate,"xpath:.//div[contains(@id,'adCwMn')]/div[1]/table[1]/tbody[1]/tr[1]/td[3]/div[1]",,68b816d9c5727969d60330d2,object,
```

Observed column behaviour:
- `sequenceNo` restarts at 0 per scenario and matches the order of object usage inside that scenario.
- `scenario` repeats the full `Scenario:` line verbatim, so rows join to the feature file by exact string.
- `objectValue` is always prefixed `xpath:`. No other locator strategy appears anywhere in the file.
- `executedValue` is empty in all 63 rows.
- `keywordIdentifier` is a 24 hex char id (MongoDB ObjectId shape). Same object reused across scenarios
  sometimes shares the id, sometimes gets a fresh one, so it is not a stable object key.
- `scope` takes two values: `application` (37 rows) and `object` (26 rows).
- `frameLocatorsPriority` is empty in all 63 rows.

## 4. File type 3: `Learning_Sample (1).csv` (test data)

Two lines: a header row of 32 quoted parameter names, then exactly one value row. This is a single
data profile, not a data table for iterations. Extract (truncated, values redacted here):

```csv
"URL","UserIdHRAdmin","Password","ItemName","AddAPerson",...,"coursename1"
"https://fa-xxxx-dev1-....oraclecloud.com/","<user>","<password>","Expert Tips for ...",...
```

## 5. Anomalies and points to raise

1. **Live credentials in cleartext.** The data CSV contains a real DEV pod URL, six usernames, and two
   passwords in plain text, plus one real person's full name. The file must stay gitignored, and the
   passwords should be treated as compromised-by-sharing if this export leaves the workstation.
2. **Most scenarios are commented out.** 7 `Scenario:` blocks exist. Only 3 are active (1, 5, 6);
   scenarios 2, 3, 4 and 7 are entirely prefixed with `#`. Active steps: 142. Commented steps: 297.
   Two thirds of the corpus is disabled.
3. **The object repository only covers active scenarios.** Rows exist for scenarios 1, 5 and 6 only.
   Of the 66 distinct objects referenced by commented scenarios, 60 have no locator row at all.
   Consequence for any future extraction: scenarios must be active in IQP at export time, otherwise
   their locators are simply absent from the export.
4. **Tag lines are duplicated.** `@Learning_Sample1` appears 9 times on one line; scenario 5 carries both
   `@Learning_Sample5` (x7) and `@Learning_Sample2` (x2). This looks like an export artifact, not intent.
5. **Scenario numbering is not contiguous with the object repository ordering**, but the join key
   (full scenario string) is exact and unambiguous, so this is cosmetic.
6. **No execution artifacts.** No run reports, no failure logs, no screenshots, no DOM snapshots are
   present in this export. Question 9 of phase 1 therefore cannot be answered from this bundle.
7. **This is one module, not the portfolio.** Everything below describes the Learning module of one
   client project. Extrapolation to the full IQP asset base is an assumption, not a measurement.
