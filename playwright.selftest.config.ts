/**
 * Configuration for the offline end to end self test. Starts the fake Oracle, points the engine
 * at it, and runs everything in selftest/. No Oracle environment and no credentials needed.
 *
 *   npm run selftest
 */
import { defineConfig } from '@playwright/test';

const PORT = 4173;

process.env.ORACLE_BASE_URL = `http://localhost:${PORT}/`;
// localhost is not an Oracle pod, so the production guard needs to be told it is acceptable here.
process.env.ALLOWED_ENV_TOKENS = 'dev,test,uat,stage,stg,qa,sandbox,localhost';
process.env.REPORTS_DIR = 'reports/selftest';
// The self test is entirely self contained: its blueprints and data live under selftest/.
process.env.BLUEPRINT_WORKSPACE = 'selftest';

/**
 * A synthetic captured session, standing in for the one `npm run auth` writes.
 *
 * It holds a single local storage entry that makes the fake Oracle skip its sign in page, exactly
 * as a real cookie makes Oracle skip its own. Nothing in it is secret, which is why it is the one
 * session file in the project that is not gitignored: without it the self test could not exercise
 * the storageState path at all, and that path is now the only way any run gets a session.
 */
process.env.STORAGE_STATE = 'selftest/fake-session.json';

/**
 * Assisted mode off by default here, on in the one test that exercises it.
 *
 * It is on by default everywhere else, because it is the product: a step that cannot resolve waits
 * for a human rather than failing. A suite that is meant to run unattended has to say so, or the
 * first wrong label hangs it forever, which is the correct behaviour and a terrible test result.
 */
process.env.ASSIST = 'false';

export default defineConfig({
  testDir: './selftest',
  workers: 1,
  retries: 0,
  timeout: 3 * 60 * 1000,
  reporter: [['list']],
  use: { screenshot: 'on', trace: 'off', headless: process.env.HEADED !== 'true' },
  outputDir: 'reports/selftest/test-results',
  webServer: {
    command: 'node selftest/server.mjs',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 30 * 1000,
  },
});
