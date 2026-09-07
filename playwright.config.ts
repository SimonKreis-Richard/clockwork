import { defineConfig } from '@playwright/test';
import 'dotenv/config';

// TODO custom reporter: a generator matching the IQP client report format, written against the
// run journal (reports/journal-*.jsonl), once that format is supplied. The engine will not change.

/**
 * How many scenarios run at once. One by default, which is the safe answer.
 *
 * Raising it is a decision about the test data, not about the machine: two scenarios creating the
 * same object in the same Oracle environment at the same time collide, whatever the engine does.
 * Compose a batch of independent scenarios first, then raise this. Three to five is the realistic
 * ceiling for one person supervising, not twelve (SPEC-v3-mvp.md section 7).
 */
const workers = Number.parseInt(process.env.WORKERS ?? '1', 10) || 1;

export default defineConfig({
  testDir: './tests',
  workers,
  fullyParallel: workers > 1,
  retries: 0, // A failure is a signal for a human, not something to paper over with a retry.

  /**
   * No per test timeout (C3).
   *
   * A test that pauses for a human will always exceed any limit worth setting, and Playwright's
   * default would kill it after ten minutes. The failure looks like a random flake rather than a
   * missing setting, which is the worst possible way for this to break. Individual actions still
   * have their own timeouts below, so nothing hangs silently.
   */
  timeout: 0,
  expect: { timeout: 15 * 1000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
  ],

  use: {
    screenshot: 'on',
    trace: 'on',
    video: 'retain-on-failure',
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
    // Assisted mode needs a window the tester can act in, so a run is headed unless told not to.
    headless: process.env.HEADLESS === 'true',
  },

  outputDir: 'reports/test-results',
});
