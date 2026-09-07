/**
 * IQP export to blueprint converter.
 *
 *   npm run convert                       reads <workspace>/iqp-exports, writes <workspace>/
 *   npm run convert -- <exportDir> <outDir>
 *   npm run convert -- <exportDir> <outDir> --force
 *
 * An existing blueprint is never overwritten without --force. Reviewed blueprints carry hand
 * corrected labels that the converter cannot reproduce, and losing them silently would be the
 * most expensive kind of bug this tool could have.
 *
 * What it does, and what it deliberately does not do.
 *
 * The IQP export is a three file model: a Gherkin .feature holding symbolic steps, a CSV object
 * repository holding one XPath per object, and a CSV data profile. The converter joins the three
 * and emits a blueprint that binds by visible label at run time.
 *
 * No selector survives the conversion. Where the original XPath does contain a visible label, that
 * label is used; otherwise the label is guessed from the IQP object name and an `# INFERRED`
 * comment is written above the step. In practice the second case is the common one: the four
 * exports reviewed for SPEC-v3 carry 302 object references and zero XPath, and about 90% of those
 * object names map straight onto something readable on screen. A guessed label is not a problem to
 * be hidden, it is the first thing the run will tell you about (SPEC-v3-mvp.md section 4).
 *
 * Conversion rules that involve judgement, all of them conservative:
 *   - `add wait seconds`, `take screenshot` and the scroll verbs are dropped. Playwright waits for
 *     elements automatically and screenshots every step.
 *   - a sign in block (navigate + user + password + sign in) is DROPPED, and starts a new part.
 *     Signing in is infrastructure now, and one test is one session.
 *   - so is a sign out, and `close browser`. An IQP scenario that switched persona four times
 *     becomes four blueprints, run in order by a human.
 *   - a run of clicks starting at Navigator or Home collapses into one `navigate` path. IQP authors
 *     place a screenshot at logical checkpoints, so a screenshot ends the run.
 *   - fill followed by Enter becomes `fill` with `press_enter`, because Enter submits a search.
 *   - fill followed by Tab becomes `select`, because Tab commits a list of values.
 *   - `switch to frame` is dropped: frames are searched automatically, so saying which one is at
 *     best redundant and at worst wrong the day Oracle adds another.
 *   - a step commented out in the export is dropped, unless the whole scenario is commented out,
 *     in which case the comments are all there is.
 *   - custom code, `run visual button click` and `check if / end conditional check` are not
 *     translated. They are written out as comments for a human.
 *
 * Everything the converter was unsure about is listed in the conversion report it prints.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------- CSV

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

// ---------------------------------------------------------------------------- label extraction

const LABEL_PATTERNS: RegExp[] = [
  /text\(\)\s*=\s*'([^']+)'/,
  /text\(\)\s*=\s*"([^"]+)"/,
  /@aria-label\s*=\s*'([^']+)'/,
  /@aria-label\s*=\s*"([^"]+)"/,
  /@title\s*=\s*'([^']+)'/,
  /@title\s*=\s*"([^"]+)"/,
  /@placeholder\s*=\s*'([^']+)'/,
  /@placeholder\s*=\s*"([^"]+)"/,
  /@alt\s*=\s*'([^']+)'/,
  /contains\(\s*text\(\)\s*,\s*'([^']+)'\s*\)/,
  /normalize-space\(\s*\)\s*=\s*'([^']+)'/,
];

/** Pull the visible label out of an IQP XPath. Returns null when the XPath carries no label. */
function labelFromXPath(xpath: string): string | null {
  for (const pattern of LABEL_PATTERNS) {
    const m = pattern.exec(xpath);
    if (m && m[1]) {
      const label = m[1].trim();
      // A generated id fragment that happens to sit in one of these attributes is not a label.
      // Detect it by the separators Oracle uses in generated ids, which never appear in a visible
      // label. Do NOT use word length: "Notifications" is 13 characters and is a real label.
      if (/[:_]/.test(label)) continue;
      return label;
    }
  }
  return null;
}

/** Turn an IQP object name into a plausible on screen label. Always a guess, always flagged. */
function labelFromObjectName(name: string): string {
  const cleaned = name
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  const expansions: Record<string, string> = {
    desc: 'Description',
    pub: 'Publish',
    num: 'Number',
    curr: 'Currency',
    cat: 'Category',
    'S&Vl': 'Save and Close',
    btn: '',
    lnk: '',
  };

  return cleaned
    .split(' ')
    .map((word) => {
      const key = word.toLowerCase();
      if (key in expansions) return expansions[key] as string;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------- feature parsing

type IqpStep = {
  raw: string;
  commented: boolean;
  verb: string;
  object?: string;
  value?: string;
  extra?: string;
};

type IqpScenario = {
  title: string;
  /** Number prefix and ticket id parsed out of the IQP title. */
  name: string;
  ticket?: string;
  disabled: boolean;
  steps: IqpStep[];
};

const STEP_PATTERNS: Array<{ verb: string; re: RegExp; map: (m: RegExpExecArray) => Partial<IqpStep> }> = [
  { verb: 'navigate', re: /I navigate to "(.+?)"/, map: (m) => ({ value: m[1] }) },
  {
    verb: 'fill',
    re: /I enter into input field "(.+?)" the value "(.*?)"$/,
    map: (m) => ({ object: m[1], value: m[2] }),
  },
  { verb: 'clear', re: /I clear the content of input field "(.+?)"/, map: (m) => ({ object: m[1] }) },
  { verb: 'click', re: /I click on "(.+?)" (?:link|button)/, map: (m) => ({ object: m[1] }) },
  { verb: 'double_click', re: /I double click on "(.+?)"/, map: (m) => ({ object: m[1] }) },
  {
    verb: 'select_dropdown',
    re: /I select from dropdown "(.+?)" the value "(.*?)"$/,
    map: (m) => ({ object: m[1], value: m[2] }),
  },
  {
    verb: 'select_list',
    re: /I select from list "(.+?)" the value "(.*?)"$/,
    map: (m) => ({ object: m[1], value: m[2] }),
  },
  { verb: 'single_key', re: /I click on single key "(.+?)"/, map: (m) => ({ value: m[1] }) },
  { verb: 'refresh', re: /I refresh page/, map: () => ({}) },
  { verb: 'download', re: /I download file from "(.+?)"/, map: (m) => ({ object: m[1] }) },
  { verb: 'visual_click', re: /I run visual button click on text "(.+?)"/, map: (m) => ({ object: m[1] }) },
  { verb: 'switch_frame', re: /I switch to frame having (?:xpath|index) "(.+?)"/, map: (m) => ({ value: m[1] }) },
  { verb: 'check_if', re: /I check if "(.+?)"/, map: (m) => ({ object: m[1] }) },
  { verb: 'end_check', re: /I end conditional check/, map: () => ({}) },
  {
    verb: 'assert_partial',
    re: /"(.+?)" should have partial text as "(.*?)"$/,
    map: (m) => ({ object: m[1], value: m[2] }),
  },
  {
    verb: 'assert_text',
    re: /"(.+?)" should have text as "(.*?)"$/,
    map: (m) => ({ object: m[1], value: m[2] }),
  },
  { verb: 'assert_link', re: /Link having text "(.+?)" should be present/, map: (m) => ({ value: m[1] }) },
  { verb: 'assert_present', re: /"(.+?)" should be present/, map: (m) => ({ object: m[1] }) },
  { verb: 'assert_title', re: /I should see page title as "(.+?)"/, map: (m) => ({ value: m[1] }) },
  { verb: 'wait', re: /I add wait seconds of "(\d+)"/, map: (m) => ({ value: m[1] }) },
  { verb: 'screenshot', re: /I take screenshot/, map: () => ({}) },
  { verb: 'press', re: /I press (enter|tab) key on "(.+?)"/, map: (m) => ({ extra: m[1], object: m[2] }) },
  { verb: 'capture', re: /I capture element "(.+?)" as variable/, map: (m) => ({ object: m[1] }) },
  {
    verb: 'custom',
    re: /I capture return value as "(.+?)" from custom code "(.+?)" run with arguments/,
    map: (m) => ({ value: m[1], extra: m[2] }),
  },
  { verb: 'close_browser', re: /I close browser/, map: () => ({}) },
  { verb: 'switch_new', re: /I switch to new window/, map: () => ({}) },
  { verb: 'close_new', re: /I close new window/, map: () => ({}) },
  { verb: 'switch_main', re: /I switch to main window/, map: () => ({}) },
  { verb: 'scroll', re: /I scroll/, map: () => ({}) },
  { verb: 'custom_arg', re: /^\|(.*)\|$/, map: (m) => ({ value: m[1] }) },
];

function parseFeature(text: string): IqpScenario[] {
  const scenarios: IqpScenario[] = [];
  let current: IqpScenario | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const commented = trimmed.startsWith('#');
    const line = commented ? trimmed.replace(/^#+\s*/, '') : trimmed;
    if (!line || line.startsWith('@') || line.startsWith('Feature:')) continue;

    if (line.startsWith('Scenario:')) {
      const title = line.slice('Scenario:'.length).trim();
      const ticketMatch = /([A-Z][A-Z0-9]+-\d+)/.exec(title);
      current = {
        title,
        name: slug(title),
        ticket: ticketMatch?.[1],
        disabled: commented,
        steps: [],
      };
      scenarios.push(current);
      continue;
    }

    if (!current) continue;

    let matched = false;
    for (const pattern of STEP_PATTERNS) {
      const m = pattern.re.exec(line);
      if (m) {
        current.steps.push({ raw: line, commented, verb: pattern.verb, ...pattern.map(m) });
        matched = true;
        break;
      }
    }

    // A line that looks like a step but matches no pattern used to vanish silently, which is the
    // worst possible outcome: the blueprint looks complete and is missing an action. IQP authors
    // also write plain prose comments ("1st Approval starts"), so only lines shaped like a step
    // are reported.
    if (!matched && /^(?:And |Given |Then |When |But )?(?:I |Link having |")/.test(line)) {
      current.steps.push({ raw: line, commented, verb: 'unrecognised' });
    }
  }

  return scenarios;
}

function slug(title: string): string {
  return title
    .replace(/[A-Z][A-Z0-9]+-\d+/g, '')
    .replace(/^\s*\d+\s*/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

// ---------------------------------------------------------------------------- object repository

type ObjectRepo = Map<string, Map<string, string>>; // scenario title -> object name -> xpath

function parseObjectRepo(rows: string[][]): ObjectRepo {
  const repo: ObjectRepo = new Map();
  const header = rows[0];
  if (!header) return repo;

  const iScenario = header.indexOf('scenario');
  const iName = header.indexOf('objectName');
  const iValue = header.indexOf('objectValue');
  if (iScenario < 0 || iName < 0 || iValue < 0) return repo;

  for (const row of rows.slice(1)) {
    const scenario = (row[iScenario] ?? '').replace(/^Scenario:\s*/, '').trim();
    const name = (row[iName] ?? '').trim();
    const value = (row[iValue] ?? '').trim();
    if (!scenario || !name || !value) continue;
    const byName = repo.get(scenario) ?? new Map<string, string>();
    if (!byName.has(name)) byName.set(name, value);
    repo.set(scenario, byName);
  }
  return repo;
}

// ---------------------------------------------------------------------------- value conversion

/** IQP references: (param) becomes {{param}}, $var$ becomes {{var}}, anything else is a literal. */
function convertValue(raw: string | undefined): string {
  if (!raw) return '';
  const param = /^\((.+)\)$/.exec(raw.trim());
  if (param && param[1]) return `{{${param[1].trim()}}}`;
  const variable = /^\$(.+)\$$/.exec(raw.trim());
  if (variable && variable[1]) return `{{${variable[1].trim()}}}`;
  return raw;
}

function objectRef(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^\[(.+)\]$/.exec(raw.trim());
  return m && m[1] ? m[1] : raw;
}

// ---------------------------------------------------------------------------- conversion

type OutStep = {
  yaml: string[];
  /** Notes for the conversion report. */
  issues: string[];
};

type Binding = {
  label: string;
  /** True when the label was guessed from the IQP object name rather than read off a real XPath. */
  inferred: boolean;
};

function bind(
  objectName: string,
  repo: Map<string, string> | undefined,
  issues: string[],
  scenarioTitle: string,
): Binding {
  const xpath = repo?.get(objectName);

  if (!xpath) {
    const label = labelFromObjectName(objectName);
    // Not an anomaly any more. The four exports reviewed for SPEC-v3 carry 302 object references
    // and no XPath at all, because objects have to be extracted from IQP one at a time. The object
    // name is then the only evidence there is, and it is usually enough: about 90% of them read
    // straight off the screen.
    issues.push(
      `no locator exported for object "${objectName}", so the label was guessed from the name: ` +
        `"${label}". Check it, or let the first run tell you.`,
    );
    return { label, inferred: true };
  }

  const fromXPath = labelFromXPath(xpath);
  if (fromXPath) return { label: fromXPath, inferred: false };

  const label = labelFromObjectName(objectName);
  issues.push(
    `"${objectName}" in "${scenarioTitle}" is bound to a generated id, label guessed as "${label}".`,
  );
  return { label, inferred: true };
}

function q(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function emitElementStep(
  action: string,
  binding: Binding,
  extraLines: string[],
): string[] {
  const lines: string[] = [];
  if (binding.inferred) {
    // A YAML comment, not a schema field. The blueprint stays exactly as expressive as it would
    // be if a human had written it, and the first run tells you whether the guess was right.
    lines.push(`  # INFERRED label, guessed from the IQP object name. Confirm it on the real page.`);
  }
  lines.push(`  - action: ${action}`);
  lines.push(`    label: ${q(binding.label)}`);
  lines.push(...extraLines);
  return lines;
}

/** Key names IQP borrows from Java AWT, mapped onto the ones Playwright understands. */
const KEY_NAMES: Record<string, string> = {
  VK_ENTER: 'Enter',
  VK_TAB: 'Tab',
  VK_ESCAPE: 'Escape',
  VK_DOWN: 'ArrowDown',
  VK_UP: 'ArrowUp',
  VK_LEFT: 'ArrowLeft',
  VK_RIGHT: 'ArrowRight',
  VK_SPACE: 'Space',
  VK_BACK_SPACE: 'Backspace',
  VK_DELETE: 'Delete',
  VK_PAGE_DOWN: 'PageDown',
  VK_PAGE_UP: 'PageUp',
  VK_HOME: 'Home',
  VK_END: 'End',
};

/**
 * A sign out, in any of the spellings the corpus uses. Dropped, along with the user menu click
 * that opens it: it belongs to the session, and the session is not test content any more.
 */
const SIGN_OUT = /sign[_\s-]?out|log[_\s-]?out|signout|logout/i;
const USER_MENU = /settings?[_\s-]?(and[_\s-]?)?actions?|user[_\s-]?menu|avatar|profile[_\s-]?ic/i;

const NAV_ROOTS = new Set(['navigator', 'home', 'homeicon', 'homeicn', 'home me', 'link me']);

type ConvertedPart = {
  /** File name stem, and the scenario key inside the file. */
  name: string;
  yaml: string;
};

/**
 * One IQP scenario becomes one or more blueprints.
 *
 * IQP chains several people into a single run by signing out and back in. That is not something a
 * test can do any more: one test is one session (SPEC-v3-mvp.md 2.2). So every sign in block ends
 * the part being built and starts the next one, and the sign in itself is dropped. The coverage is
 * identical; what is lost is the automatic chaining, which a human now provides by running the
 * parts in order.
 */
function convertScenario(
  scenario: IqpScenario,
  repo: Map<string, string> | undefined,
): { parts: ConvertedPart[]; issues: string[] } {
  const issues: string[] = [];
  const segments: string[][] = [];
  let current: string[] = [];

  const closeSegment = (): void => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  // A step commented out inside a live scenario is a step its author switched off, and converting
  // it would produce a test nobody asked for. A scenario commented out in its entirety is the
  // opposite case: the comments are all there is.
  const usable = scenario.disabled ? scenario.steps : scenario.steps.filter((s) => !s.commented);
  const commentedOut = scenario.steps.length - usable.length;
  if (commentedOut > 0) {
    issues.push(
      `${commentedOut} step(s) were commented out in the export and were not converted. If any of ` +
        `them mattered, uncomment them in IQP and export again.`,
    );
  }

  const steps = usable.filter((s) => s.verb !== 'wait' && s.verb !== 'scroll');

  // Sign out steps, and the user menu click that opens them, are session plumbing rather than test
  // content. Marked here rather than in the loop below, because the menu click comes first and
  // only turns out to be plumbing once the sign out after it is seen.
  const dropped = new Set<number>();
  steps.forEach((step, index) => {
    if (step.verb !== 'click' && step.verb !== 'double_click') return;
    if (!SIGN_OUT.test(objectRef(step.object) ?? '')) return;
    dropped.add(index);
    let seenClicks = 0;
    for (let k = index - 1; k >= 0 && seenClicks < 2; k--) {
      const prev = steps[k];
      if (!prev || (prev.verb !== 'click' && prev.verb !== 'double_click')) continue;
      seenClicks++;
      if (USER_MENU.test(objectRef(prev.object) ?? '')) {
        dropped.add(k);
        break;
      }
    }
  });
  if (dropped.size > 0) {
    issues.push(
      `${dropped.size} sign out step(s) were dropped. Signing out ends a part; it is not an action ` +
        `a test performs.`,
    );
  }

  let i = 0;
  while (i < steps.length) {
    const step = steps[i]!;

    if (dropped.has(i)) {
      i++;
      continue;
    }

    // --- close browser: an unambiguous part boundary
    if (step.verb === 'close_browser') {
      closeSegment();
      i++;
      continue;
    }

    // --- sign in block: navigate + fill(UserId) + fill(Password) + click(SignIn)
    if (step.verb === 'navigate') {
      const userStep = steps[i + 1];
      const passStep = steps[i + 2];
      const signInStep = steps[i + 3];
      const looksLikeLogin =
        userStep?.verb === 'fill' &&
        passStep?.verb === 'fill' &&
        /password/i.test(objectRef(passStep.object) ?? '') &&
        signInStep?.verb === 'click';

      if (looksLikeLogin) {
        // Dropped, not translated. The run starts inside a session captured by npm run auth.
        issues.push(
          `a sign in block was dropped (as ${convertValue(userStep.value)}). Authentication is ` +
            `infrastructure now: run npm run auth once, and the blueprint starts at the first ` +
            `functional action.`,
        );
        closeSegment();
        i += 4;
        continue;
      }

      issues.push(`a navigate step was not part of a sign in block and was dropped: ${step.raw}`);
      i++;
      continue;
    }

    // --- navigation run: consecutive clicks starting at Navigator or Home, ended by a screenshot
    if (step.verb === 'click') {
      const objectName = objectRef(step.object) ?? '';
      const binding = bind(objectName, repo, issues, scenario.title);
      const isNavRoot =
        NAV_ROOTS.has(objectName.toLowerCase()) || NAV_ROOTS.has(binding.label.toLowerCase());

      if (isNavRoot) {
        const navPath: string[] = [binding.label];
        let anyInferred = binding.inferred;
        let j = i + 1;
        while (j < steps.length && navPath.length < 6) {
          const next = steps[j]!;
          if (next.verb === 'screenshot') break; // authors put a screenshot at logical checkpoints
          if (next.verb !== 'click' || dropped.has(j)) break;
          const nextBinding = bind(objectRef(next.object) ?? '', repo, issues, scenario.title);
          navPath.push(nextBinding.label);
          anyInferred = anyInferred || nextBinding.inferred;
          j++;
        }

        if (navPath.length > 1) {
          if (anyInferred) {
            current.push(`  # INFERRED: at least one label in this path was guessed`);
          }
          current.push(`  - action: navigate`);
          current.push(`    path: [${navPath.map(q).join(', ')}]`);
          if (j - i > 4) {
            issues.push(
              `navigation path in "${scenario.title}" swallowed ${j - i} clicks: ` +
                `[${navPath.join(' > ')}]. Check that the last entries are really navigation and ` +
                `not actions.`,
            );
          }
          i = j;
          continue;
        }
      }

      current.push(...emitElementStep('click', binding, []));
      i++;
      continue;
    }

    if (step.verb === 'double_click') {
      const binding = bind(objectRef(step.object) ?? '', repo, issues, scenario.title);
      current.push(...emitElementStep('click', binding, [`    double: true`]));
      i++;
      continue;
    }

    // --- clear + fill on the same field: Playwright's fill clears first, so drop the clear
    if (step.verb === 'clear') {
      const next = steps[i + 1];
      if (next?.verb === 'fill' && next.object === step.object) {
        i++;
        continue;
      }
      issues.push(`a "clear" step had no matching fill and was dropped: ${step.raw}`);
      i++;
      continue;
    }

    // --- fill, possibly followed by a key press
    if (step.verb === 'fill') {
      const objectName = objectRef(step.object) ?? '';
      const binding = bind(objectName, repo, issues, scenario.title);
      const value = convertValue(step.value);

      let j = i + 1;
      while (j < steps.length && steps[j]!.verb === 'screenshot') j++;
      const follower = steps[j];
      const pressesSameField =
        follower?.verb === 'press' && objectRef(follower.object) === objectName;

      if (pressesSameField && follower!.extra === 'tab') {
        // Tab commits a list of values.
        current.push(
          ...emitElementStep('select', binding, [`    value: ${q(value)}`, `    match: exact`]),
        );
        i = j + 1;
        continue;
      }

      if (pressesSameField && follower!.extra === 'enter') {
        // Enter submits a search box.
        current.push(
          ...emitElementStep('fill', binding, [`    value: ${q(value)}`, `    press_enter: true`]),
        );
        i = j + 1;
        continue;
      }

      current.push(...emitElementStep('fill', binding, [`    value: ${q(value)}`]));
      if (/categor|business unit|person|manager|location|department/i.test(binding.label)) {
        issues.push(
          `"${binding.label}" in "${scenario.title}" was converted to fill, but it looks like a ` +
            `list of values. If the value does not stick, change the action to select.`,
        );
      }
      i++;
      continue;
    }

    // --- the two list keywords, which look alike on screen and behave nothing alike
    if (step.verb === 'select_list' || step.verb === 'select_dropdown') {
      const binding = bind(objectRef(step.object) ?? '', repo, issues, scenario.title);
      const extra = [`    value: ${q(convertValue(step.value))}`];
      if (step.verb === 'select_dropdown') extra.push(`    mode: dropdown`);
      else extra.push(`    match: exact`);
      current.push(...emitElementStep('select', binding, extra));
      i++;
      continue;
    }

    if (step.verb === 'press') {
      // A key press with no preceding fill on the same field. It has its own keyword now.
      const binding = bind(objectRef(step.object) ?? '', repo, issues, scenario.title);
      const key = step.extra === 'tab' ? 'Tab' : 'Enter';
      current.push(...emitElementStep('press_key', binding, [`    key: ${q(key)}`]));
      i++;
      continue;
    }

    if (step.verb === 'single_key') {
      const raw = (step.value ?? '').trim();
      const key = KEY_NAMES[raw];
      if (!key) {
        issues.push(`unknown key "${raw}" in "${scenario.title}". Add it to KEY_NAMES.`);
        current.push(`  # NOT CONVERTED: ${step.raw}`);
      } else {
        current.push(`  - action: press_key`, `    key: ${q(key)}`);
      }
      i++;
      continue;
    }

    if (step.verb === 'refresh') {
      current.push(`  - action: refresh`);
      i++;
      continue;
    }

    if (step.verb === 'switch_frame') {
      // Dropped on purpose. The resolution chain searches the page and every frame in it, so
      // naming a frame is at best redundant and at worst wrong the day Oracle adds another.
      issues.push(
        `a "switch to frame" step was dropped (${step.value}). Frames are searched automatically, ` +
          `so a blueprint never names one.`,
      );
      i++;
      continue;
    }

    // --- assertions. IQP has them after all: the Learning module simply had none.
    if (step.verb === 'assert_present') {
      const binding = bind(objectRef(step.object) ?? '', repo, issues, scenario.title);
      current.push(
        `  # assertion: ${step.raw}`,
        `  - action: wait_for`,
        `    label: ${q(binding.label)}`,
        `    state: visible`,
      );
      i++;
      continue;
    }

    if (step.verb === 'assert_text' || step.verb === 'assert_partial') {
      const binding = bind(objectRef(step.object) ?? '', repo, issues, scenario.title);
      const comparison = step.verb === 'assert_text' ? 'equals' : 'contains';
      current.push(
        `  - action: verify`,
        `    label: ${q(binding.label)}`,
        `    ${comparison}: ${q(convertValue(step.value))}`,
      );
      i++;
      continue;
    }

    if (step.verb === 'assert_title' || step.verb === 'assert_link') {
      current.push(`  - action: verify`, `    text_contains: ${q(convertValue(step.value))}`);
      i++;
      continue;
    }

    if (step.verb === 'check_if') {
      // The whole block is commented out, not just the test around it. IQP performs these steps
      // only when the element happens to be there; emitting them as ordinary steps would make the
      // test fail on every run where it is not, which is a worse answer than saying nothing.
      let j = i + 1;
      const enclosed: string[] = [];
      while (j < steps.length && steps[j]!.verb !== 'end_check') {
        enclosed.push(steps[j]!.raw);
        j++;
      }
      current.push(
        `  # NOT CONVERTED, conditional block:`,
        `  #   ${step.raw}`,
        ...enclosed.map((raw) => `  #     ${raw}`),
        `  #   Branching is deliberately out of scope: 2 occurrences in 1852 steps, and adding it`,
        `  #   turns a declarative format into a programming language. If these steps always have`,
        `  #   to run, write them out as real steps; if they never do, delete this block; if it`,
        `  #   genuinely depends, split the scenario in two.`,
      );
      issues.push(
        `a conditional block in "${scenario.title}" was not converted (${enclosed.length} step(s) ` +
          `inside it). It is left as a comment in the blueprint.`,
      );
      i = j + 1;
      continue;
    }

    if (step.verb === 'end_check') {
      i++;
      continue;
    }

    if (step.verb === 'visual_click' || step.verb === 'download') {
      const what =
        step.verb === 'visual_click' ? 'clicking by image recognition' : 'downloading a file';
      current.push(`  # NOT CONVERTED: ${step.raw}`, `  #   ${what} is not supported.`);
      issues.push(`"${step.raw}" was not converted: ${what} is out of scope for the MVP.`);
      i++;
      continue;
    }

    if (step.verb === 'capture') {
      const objectName = objectRef(step.object) ?? '';
      const binding = bind(objectName, repo, issues, scenario.title);
      const varName = objectName.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
      current.push(...emitElementStep('capture', binding, [`    as: ${varName}`]));
      issues.push(
        `IQP captured "${objectName}" without naming a variable. It is stored as "{{${varName}}}".`,
      );
      i++;
      continue;
    }

    if (step.verb === 'custom') {
      const args: string[] = [];
      let j = i + 1;
      while (j < steps.length && steps[j]!.verb === 'custom_arg') {
        args.push((steps[j]!.value ?? '').replace(/"/g, ''));
        j++;
      }
      current.push(
        `  # NOT CONVERTED: IQP called custom code ${step.extra}(${args.join(', ')})`,
        `  #   and stored the result as {{${step.value}}}.`,
        `  #   Replace the reference with a built in generator, for example {{random_string(6)}},`,
        `  #   or delete this comment if the value is no longer needed.`,
      );
      issues.push(
        `custom code "${step.extra}" is not translated. Its result was used as {{${step.value}}}.`,
      );
      i = j;
      continue;
    }

    if (step.verb === 'switch_new') {
      current.push(`  - action: switch_window`, `    to: new`);
      i++;
      continue;
    }
    if (step.verb === 'switch_main') {
      current.push(`  - action: switch_window`, `    to: main`);
      i++;
      continue;
    }
    if (step.verb === 'close_new') {
      current.push(`  - action: close_window`);
      i++;
      continue;
    }

    if (step.verb === 'unrecognised') {
      current.push(`  # NOT CONVERTED, unrecognised step: ${step.raw}`);
      issues.push(
        `no conversion rule for: ${step.raw}. It is left as a comment in the blueprint, so the ` +
          `test is short by one action until someone decides what it should be.`,
      );
      i++;
      continue;
    }

    // screenshot and anything else: dropped on purpose
    i++;
  }

  closeSegment();

  if (segments.length === 0) {
    issues.push(`"${scenario.title}" produced no steps at all.`);
    segments.push([]);
  }

  const multi = segments.length > 1;
  if (multi) {
    issues.push(
      `"${scenario.title}" switched user ${segments.length - 1} time(s) and became ` +
        `${segments.length} blueprints. Run them in order: each one expects what the previous one ` +
        `created, and any approval it triggered, to already exist.`,
    );
  }

  const parts = segments.map((body, index) => {
    const name = multi ? `${scenario.name}_${index + 1}` : scenario.name;
    const head: string[] = [
      `scenario: ${name}`,
      scenario.ticket ? `source: ${scenario.ticket}` : '',
      `app: oracle-hcm`,
      `ui: redwood`,
      `description: >`,
      multi ? `  ${scenario.title} (part ${index + 1} of ${segments.length})` : `  ${scenario.title}`,
      `data_profile: DATA_PROFILE`,
      ``,
      `# Converted from an IQP export. A step marked INFERRED had no visible label in the original,`,
      `# so the label was guessed from the IQP object name: the first run will tell you whether the`,
      `# guess was right, and let you correct it on the spot.`,
      ...(multi
        ? [
            `#`,
            `# Part ${index + 1} of ${segments.length}. The IQP scenario chained these by signing out and`,
            `# back in as somebody else. One test is one session now, so a person runs the parts in`,
            `# order. Nothing here signs in: the session comes from npm run auth.`,
          ]
        : []),
      ``,
    ].filter((l) => l !== '');

    return { name, yaml: [...head, `steps:`, ...body, ''].join('\n') };
  });

  return { parts, issues };
}

// ---------------------------------------------------------------------------- main

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const force = process.argv.includes('--force');
  // Default input and output both sit in the workspace, outside this repository, because an IQP
  // export and everything derived from it is client material. See BLUEPRINT_WORKSPACE in .env.
  const workspace = process.env.BLUEPRINT_WORKSPACE ?? '.';
  const exportDir = path.resolve(args[0] ?? path.join(workspace, 'iqp-exports'));
  const outDir = path.resolve(args[1] ?? workspace);

  if (!fs.existsSync(exportDir)) {
    console.error(
      `Export directory not found: ${exportDir}\n` +
        `  IQP exports live in the workspace, outside this repository. Set BLUEPRINT_WORKSPACE\n` +
        `  in .env, or pass the export directory as the first argument.`,
    );
    process.exit(1);
  }

  const files = fs.readdirSync(exportDir);
  const featureFiles = files.filter((f) => f.endsWith('.feature'));
  if (featureFiles.length === 0) {
    console.error(`No .feature file in ${exportDir}. Is this really an IQP export?`);
    process.exit(1);
  }

  const blueprintsDir = path.join(outDir, 'blueprints');
  const disabledDir = path.join(blueprintsDir, 'disabled');
  const dataDir = path.join(outDir, 'data');
  fs.mkdirSync(blueprintsDir, { recursive: true });
  fs.mkdirSync(disabledDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const allIssues: string[] = [];
  const skipped: string[] = [];
  let written = 0;
  let writtenDisabled = 0;

  for (const featureFile of featureFiles) {
    const suite = path.basename(featureFile, '.feature');
    const featureText = fs.readFileSync(path.join(exportDir, featureFile), 'utf8');
    const scenarios = parseFeature(featureText);

    // The object repository is the CSV named exactly like the suite.
    const repoFile = files.find((f) => f === `${suite}.csv`);
    const repo = repoFile
      ? parseObjectRepo(parseCsv(fs.readFileSync(path.join(exportDir, repoFile), 'utf8')))
      : new Map();

    // The data profile is any other CSV of the same suite, typically "<suite> (1).csv".
    const dataFile = files.find(
      (f) => f !== repoFile && f.startsWith(suite) && f.toLowerCase().endsWith('.csv'),
    );
    const profileName = `${suite.toLowerCase()}_default`;
    if (dataFile) {
      writeDataProfile(path.join(exportDir, dataFile), path.join(dataDir, `${profileName}.yaml`), allIssues);
    }

    for (const scenario of scenarios) {
      const scenarioRepo = repo.get(scenario.title.replace(/^Scenario:\s*/, '').trim());
      const { parts, issues } = convertScenario(scenario, scenarioRepo);

      // Collected before the skip check, so the report stays complete even on a re run that
      // writes nothing.
      allIssues.push(...issues.map((issue) => `[${scenario.name}] ${issue}`));

      for (const part of parts) {
        const finalYaml = part.yaml.replace(
          'data_profile: DATA_PROFILE',
          `data_profile: ${profileName}`,
        );

        const target = scenario.disabled ? disabledDir : blueprintsDir;
        const outFile = path.join(target, `${part.name || 'scenario'}.yaml`);

        if (fs.existsSync(outFile) && !force) {
          skipped.push(path.relative(outDir, outFile));
          continue;
        }

        const header = scenario.disabled
          ? `# DISABLED in the IQP export (the whole scenario was commented out), so no locators\n` +
            `# were exported for it. Every label below is a guess. Move this file up one directory\n` +
            `# to run it.\n`
          : '';
        fs.writeFileSync(outFile, header + finalYaml, 'utf8');

        if (scenario.disabled) writtenDisabled++;
        else written++;
      }
    }
  }

  // Written into reports/, not EXPLORATION/, because it quotes the source export verbatim and
  // is therefore client derived. reports/ is excluded; EXPLORATION/ is documentation.
  const reportFile = path.join(outDir, 'reports', 'conversion-report.md');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const uniqueIssues = [...new Set(allIssues)];
  fs.writeFileSync(
    reportFile,
    [
      `# Conversion report`,
      ``,
      `Source: \`${exportDir}\``,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `${written} blueprint(s) written to \`blueprints/\`.`,
      ...(skipped.length > 0
        ? [
            ``,
            `${skipped.length} existing blueprint(s) were left untouched, because overwriting a`,
            `reviewed blueprint would silently discard hand corrected labels. Re run with --force`,
            `only if that is really what you want:`,
            ``,
            ...skipped.map((f) => `- \`${f}\``),
          ]
        : []),
      `${writtenDisabled} blueprint(s) written to \`blueprints/disabled/\` (commented out in IQP,`,
      `no locators exported, every label is a guess, they do not run until moved up a directory).`,
      ``,
      `## Things a human should look at (${uniqueIssues.length})`,
      ``,
      ...(uniqueIssues.length > 0 ? uniqueIssues.map((i) => `- ${i}`) : ['- Nothing. Suspicious.']),
      ``,
      `## Reminder`,
      ``,
      `A converted test mostly navigates and clicks. IQP assertions do exist and are translated`,
      `(\`should be present\`, \`should have text as\`, \`should have partial text as\`), but they are`,
      `rare: 26 in 1852 steps across the corpus reviewed for SPEC-v3. Add at least one \`verify\``,
      `step per scenario before treating a green run as proof of anything.`,
      ``,
      `Nothing here signs in. Run \`npm run auth\` once and every blueprint reuses that session.`,
      ``,
    ].join('\n'),
    'utf8',
  );

  console.log(`${written} blueprint(s) in blueprints/`);
  if (writtenDisabled > 0) console.log(`${writtenDisabled} disabled blueprint(s) in blueprints/disabled/`);
  if (skipped.length > 0) {
    console.log(`${skipped.length} left untouched because they already exist (use --force to overwrite):`);
    for (const f of skipped) console.log(`  ${f}`);
  }
  console.log(`${uniqueIssues.length} thing(s) to review, listed in ${reportFile}`);
}

function writeDataProfile(csvFile: string, outFile: string, issues: string[]): void {
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf8'));
  const header = rows[0];
  const values = rows[1];
  if (!header || !values) {
    issues.push(`data file ${path.basename(csvFile)} has no value row.`);
    return;
  }

  const lines: string[] = [
    `# Data profile converted from ${path.basename(csvFile)}.`,
    `# Passwords are deliberately absent, and there is nowhere left to put one: the session is`,
    `# captured once by npm run auth, so no test ever handles a credential.`,
    ``,
  ];

  let skipped = 0;
  header.forEach((name, i) => {
    const key = name.trim();
    if (!key) return;
    if (/password|pwd|secret|token/i.test(key)) {
      skipped++;
      lines.push(`# ${key}: removed. Sign in by hand once with npm run auth instead.`);
      return;
    }
    const value = (values[i] ?? '').trim();
    lines.push(`${key}: ${JSON.stringify(value)}`);
  });

  fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
  if (skipped > 0) {
    issues.push(
      `${skipped} password column(s) were stripped from the data profile. Nothing replaces them: ` +
        `run npm run auth once, signed in as the person the test needs to be.`,
    );
  }
}

main();
