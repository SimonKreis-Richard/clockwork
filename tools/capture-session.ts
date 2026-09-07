/**
 * npm run auth
 *
 * Opens a browser, lets a human sign in by hand, and saves the resulting session to a gitignored
 * file that every later run reuses. This is the whole of authentication (D13, SPEC-v3-mvp.md 8).
 *
 * Why it works this way:
 *
 *   - No password ever reaches this tool, this repository or a configuration file. The human types
 *     it into Oracle's own page, exactly as they would any other day.
 *   - Multi factor authentication stops being a risk. Whatever the identity provider asks for,
 *     a person answers it. That was open question Q1, and this closes it.
 *   - A blueprint therefore starts at its first functional action, with no sign in steps to
 *     maintain and no persona credentials to store.
 *
 * The file it writes contains live session cookies. It is exactly as sensitive as the password:
 * gitignored, never copied, never shared. Refreshing it is one command, and the engine tells you
 * when it is time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { config, assertNotProduction, storageStateFile } from '../src/config';

const rootDir = path.resolve(__dirname, '..');

/** True while the sign in page is still on screen. Same indicators the interpreter checks. */
async function looksSignedOut(page: import('@playwright/test').Page): Promise<boolean> {
  for (const selector of config.session.signedOutIndicators) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function main(): Promise<void> {
  // The guard applies here too. Capturing a production session would be worse than running one
  // test against production, because the file would then be reused by every run afterwards.
  assertNotProduction(config.baseUrl);

  const target = storageStateFile(rootDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  console.log('');
  console.log(`Opening ${config.baseUrl}`);
  console.log('');
  console.log('  Sign in by hand in the window that opens, including any second factor.');
  console.log('  When the application home page is up, come back here and press Enter.');
  console.log('  (If you get there and forget, the session is saved automatically.)');
  console.log('');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });

  await Promise.race([waitForEnter(), waitUntilSignedIn(page)]);

  // Read the state before anything is closed, so a browser the user shut themselves still counts.
  const state = await context.storageState().catch(() => null);
  if (!state || (state.cookies.length === 0 && state.origins.length === 0)) {
    console.error('');
    console.error('Nothing to save: the browser held no cookies and no local storage.');
    console.error('That normally means the sign in never completed. Try again.');
    await browser.close().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(target, JSON.stringify(state, null, 2), 'utf8');
  await browser.close().catch(() => undefined);

  console.log('');
  console.log(`Session saved to ${target}`);
  console.log(`  ${state.cookies.length} cookie(s), ${state.origins.length} origin(s).`);
  console.log('');
  console.log('  Every run reuses it from now on. When it expires, the engine says so by name');
  console.log('  and tells you to run this command again. Never copy this file anywhere.');
  console.log('');
}

/** Resolves when the operator presses Enter. */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

/**
 * Resolves when the sign in page has been gone for a few consecutive checks.
 *
 * Consecutive, not one, on purpose: an identity provider bounces through several pages and there
 * are moments in between when no password field exists yet the user is not signed in either.
 */
async function waitUntilSignedIn(page: import('@playwright/test').Page): Promise<void> {
  let clean = 0;
  for (;;) {
    if (page.isClosed()) return;
    const out = await looksSignedOut(page).catch(() => true);
    clean = out ? 0 : clean + 1;
    if (clean >= 4) return;
    await page.waitForTimeout(1000).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error('');
  console.error((error as Error).message);
  process.exitCode = 1;
});
