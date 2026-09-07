/**
 * One Playwright test per blueprint found in blueprints/.
 *
 * There is no per scenario test file to write. Drop a YAML file in blueprints/ and it runs.
 * To run a single one:  npm run test:one -- "create_a_course"
 */

import path from 'node:path';
import { test } from '@playwright/test';
import { blueprintFiles, blueprintsDir, loadBlueprint } from '../src/blueprint';
import { runBlueprint } from '../src/interpreter';

// Playwright compiles test files to CommonJS, so __dirname is available and import.meta is not.
declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');
const files = blueprintFiles(rootDir);

if (files.length === 0) {
  // Not an error. Blueprints live in the workspace, outside this repository, because they derive
  // from client material. A checkout with no workspace configured legitimately has none.
  test('no blueprints to run', () => {
    test.skip(
      true,
      [
        `No blueprints found in ${blueprintsDir(rootDir)}.`,
        'Blueprints and data profiles live OUTSIDE this repository, in a workspace directory,',
        'because they contain client scenarios, usernames and environment URLs.',
        'Point BLUEPRINT_WORKSPACE in .env at that directory.',
        'To create one: put an IQP export in <workspace>/iqp-exports and run "npm run convert",',
        'or record a new scenario with "npm run record".',
        'The engine itself needs neither: "npm run check" verifies it offline.',
        'For the blueprint format, read selftest/blueprints/selftest_create_course.yaml.',
      ].join(' '),
    );
  });
}

for (const file of files) {
  // Loading happens at collection time so a malformed blueprint fails fast and names itself,
  // before any browser opens.
  const blueprint = loadBlueprint(file);
  const title = blueprint.source
    ? `${blueprint.scenario} (${blueprint.source})`
    : blueprint.scenario;

  test(title, async ({ browser }, testInfo) => {
    testInfo.annotations.push({ type: 'blueprint', description: path.basename(file) });
    if (blueprint.description) {
      testInfo.annotations.push({ type: 'description', description: blueprint.description.trim() });
    }
    await runBlueprint(blueprint, { browser, testInfo, rootDir });
  });
}
