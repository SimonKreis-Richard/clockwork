/**
 * Offline self test of the engine. No Oracle environment needed, no network.
 *
 * It drives the resolution chain, the Oracle error detector, the data layer and the production
 * guard against a small HTML page built in memory. Run it before touching a real environment:
 * if this is green, everything that is broken afterwards is Oracle specific, not engine specific.
 *
 *   npm run selftest
 */

import { expect, test } from '@playwright/test';
import { resolve, ResolutionError, visibleLabels } from '../src/locate';
import { detectOracleError } from '../src/errors';
import { resolveValue } from '../src/data';
import { assertNotProduction, ProductionGuardError } from '../src/config';
import runConfig from '../playwright.config';

const PAGE = `
<!doctype html><html><body>
  <form>
    <label for="title">Title</label>
    <input id="title" />

    <label for="cat">Category</label>
    <input id="cat" role="combobox" />

    <input placeholder="Enter a search term." id="search" />

    <div aria-label="Add Learners" role="button" tabindex="0">+</div>

    <button type="button">Save and Close</button>

    <!-- The same label twice, which is the situation the hints block exists for. -->
    <button type="button">Next</button>
    <button type="button">Next</button>

    <!-- No label, no accessible name: only a generated id, like Oracle's own fields.
         Nothing can find this one, and that is the point: it fails, visibly, instead of being
         propped up by a stored selector that would rot at the next patch. -->
    <span id="pt1:r1:0:sdDtInp"><input id="generated-start-date" /></span>

    <span>Course Number</span><span id="crn">CRS-00042</span>
  </form>

  <!-- A page inside the page. "Approval Note" exists only in the inner document. -->
  <iframe id="inner" srcdoc='<label for="n">Approval Note</label><input id="n" />'></iframe>

  <div id="err" role="alert" style="display:none">You must enter a value for Title.</div>
  <div id="info" role="alert" style="display:none">Your changes were saved successfully.</div>
</body></html>`;

test.describe('resolution chain', () => {
  test('finds a field by its visible label', async ({ page }) => {
    await page.setContent(PAGE);
    const found = await resolve(page, { label: 'Title', kind: 'input' });
    expect(found.method).toBe('label');
    await found.locator.fill('hello');
    expect(await page.locator('#title').inputValue()).toBe('hello');
  });

  test('finds a button by its accessible name', async ({ page }) => {
    await page.setContent(PAGE);
    const found = await resolve(page, { label: 'Save and Close', kind: 'control' });
    expect(['label', 'role', 'adjacent']).toContain(found.method);
    expect(found.ambiguous).toBe(false);
  });

  test('finds a control by aria-label', async ({ page }) => {
    await page.setContent(PAGE);
    const found = await resolve(page, { label: 'Add Learners', kind: 'control' });
    expect(await found.locator.getAttribute('aria-label')).toBe('Add Learners');
  });

  test('finds a search box by its placeholder', async ({ page }) => {
    await page.setContent(PAGE);
    const found = await resolve(page, { label: 'Enter a search term.', kind: 'input' });
    expect(['placeholder', 'role', 'label']).toContain(found.method);
    await found.locator.fill('agile');
    expect(await page.locator('#search').inputValue()).toBe('agile');
  });

  test('flags an ambiguous label instead of silently guessing', async ({ page }) => {
    await page.setContent(PAGE);
    const found = await resolve(page, { label: 'Next', kind: 'control' });
    expect(found.matchCount).toBeGreaterThan(1);
    expect(found.ambiguous).toBe(true);
  });

  test('an index hint resolves the ambiguity', async ({ page }) => {
    await page.setContent(PAGE);
    const found = await resolve(page, { label: 'Next', kind: 'control', hints: { index: 1 } });
    expect(found.ambiguous).toBe(false);
  });

  test('finds a field that lives inside an iframe, with no help from the blueprint', async ({
    page,
  }) => {
    await page.setContent(PAGE);
    // The label is not in the outer document at all, so no search of it could ever succeed.
    // The chain runs over every frame in turn, which is why a blueprint never mentions one.
    const found = await resolve(page, { label: 'Approval Note', kind: 'input' });
    expect(found.frame).toBeTruthy();
    await found.locator.fill('looks good');
    expect(await page.frameLocator('#inner').locator('#n').inputValue()).toBe('looks good');
  });

  test('a field with no accessible name fails, instead of being propped up by a selector', async ({
    page,
  }) => {
    await page.setContent(PAGE);
    const error = await resolve(page, {
      label: 'Publish Start Date', // exists on the page, but carries only a generated id
      kind: 'input',
      timeoutMs: 2000,
    }).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(ResolutionError);
    expect((error as ResolutionError).label).toBe('Publish Start Date');
  });

  test('a failure names the label and suggests what the page actually shows', async ({ page }) => {
    await page.setContent(PAGE);
    const error = await resolve(page, {
      label: 'Category Course',
      kind: 'input',
      timeoutMs: 2000,
    }).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(ResolutionError);
    const message = (error as Error).message;
    expect(message).toContain('Category Course');
    expect(message).toContain('a field to type into');
    // The page does have a "Category" field, so the message should point at it.
    expect(message).toContain('Category');
    // The tester is told what IS on the page, not just what is not.
    expect(message).toContain('Everything actionable on this page right now');
    expect(message).toContain('Save and Close');
  });

  test('lists every actionable label, across the page and its frames', async ({ page }) => {
    await page.setContent(PAGE);
    const labels = await visibleLabels(page);
    expect(labels).toContain('Save and Close');
    expect(labels).toContain('Add Learners');
    // From inside the iframe: assisted mode has to offer these too, or the tester cannot
    // repair a step whose element lives there.
    expect(labels).toContain('Approval Note');
  });
});

/**
 * C3 has no observable symptom inside a three minute suite: it only bites after ten minutes of a
 * human thinking. It is asserted as a setting instead, because getting it wrong looks exactly like
 * a random flake and would cost a day to diagnose. See SPEC-v3-mvp.md section 1b.
 */
test.describe('hard constraints', () => {
  test('the per test timeout is disabled, so a paused test can wait for a person (C3)', () => {
    expect(runConfig.timeout).toBe(0);
  });

  test('a run is headed by default, because assisted mode needs a window to act in (C1)', () => {
    // Only meaningful when nobody has asked for headless: HEADLESS=true is a deliberate choice,
    // and this suite must not fail because someone made it.
    test.skip(process.env.HEADLESS === 'true', 'HEADLESS was set on purpose for this run.');
    expect(runConfig.use?.headless).toBe(false);
  });
});

test.describe('Oracle error detection', () => {
  test('sees a real error banner', async ({ page }) => {
    await page.setContent(PAGE);
    await page.locator('#err').evaluate((el) => ((el as HTMLElement).style.display = 'block'));
    const found = await detectOracleError(page);
    expect(found?.text).toContain('You must enter a value for Title');
  });

  test('ignores a confirmation banner', async ({ page }) => {
    await page.setContent(PAGE);
    await page.locator('#info').evaluate((el) => ((el as HTMLElement).style.display = 'block'));
    expect(await detectOracleError(page)).toBeNull();
  });

  test('says nothing when the page is clean', async ({ page }) => {
    await page.setContent(PAGE);
    expect(await detectOracleError(page)).toBeNull();
  });
});

test.describe('data layer', () => {
  const profile = { title: 'Test course', category: 'HR' };

  test('resolves a data reference', () => {
    expect(resolveValue('{{title}}', profile, {})).toBe('Test course');
  });

  test('resolves a captured variable, which wins over the profile', () => {
    expect(resolveValue('{{title}}', profile, { title: 'captured' })).toBe('captured');
  });

  test('runs a generator, replacing the IQP custom code hook', () => {
    expect(resolveValue('{{random_string(5)}}', profile, {})).toMatch(/^[a-z]{5}$/);
    expect(resolveValue('{{today()}}', profile, {})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolveValue('course-{{random_number(4)}}', profile, {})).toMatch(/^course-\d{4}$/);
  });

  test('refuses an unknown reference instead of typing "undefined" into Oracle', () => {
    expect(() => resolveValue('{{nope}}', profile, {})).toThrow(/Unknown data reference/);
  });
});

test.describe('production guard', () => {
  test('accepts a DEV pod even though its hostname contains "saasfaprod1"', () => {
    expect(() =>
      assertNotProduction('https://fa-xxxx-dev1-saasfaprod1.fa.ocs.oraclecloud.com/'),
    ).not.toThrow();
  });

  test('accepts a TEST pod', () => {
    expect(() =>
      assertNotProduction('https://fa-xxxx-test-saasfaprod1.fa.ocs.oraclecloud.com/'),
    ).not.toThrow();
  });

  test('refuses a production pod', () => {
    expect(() =>
      assertNotProduction('https://fa-xxxx-prod-saasfaprod1.fa.ocs.oraclecloud.com/'),
    ).toThrow(ProductionGuardError);
  });

  test('refuses a hostname it does not recognise', () => {
    expect(() => assertNotProduction('https://hcm.acme.com/')).toThrow(ProductionGuardError);
  });
});
