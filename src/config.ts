/**
 * Runtime configuration, the production guard and the session file.
 *
 * Everything in this file is meant to be edited without touching the engine. The Oracle specific
 * lists (error indicators, list of values markup) are first drafts written before any contact with
 * a live environment; expect to refine them during the first real run. That is why they live here
 * and not scattered through the keyword modules.
 *
 * There are no credentials here and no login settings. Authentication is infrastructure (D13):
 * a human signs in once, the session is captured to a gitignored file, and every run reuses it.
 */

import path from 'node:path';
import 'dotenv/config';

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Target environment. Never a production pod. Checked by assertNotProduction below. */
  baseUrl: env('ORACLE_BASE_URL', '') as string,

  /** Total budget for resolving one element across all strategies and all frames. */
  resolveTimeoutMs: envInt('RESOLVE_TIMEOUT_MS', 15000),

  /** Poll interval while waiting for an element to appear. */
  resolvePollMs: 300,

  /** Screenshot every step. Turning this off defeats the purpose of the tool. */
  screenshotEveryStep: env('SCREENSHOT_EVERY_STEP', 'true') !== 'false',

  /** Where the run journal and generated summaries go. Gitignored. */
  reportsDir: env('REPORTS_DIR', 'reports') as string,

  /**
   * The captured browser session, produced by `npm run auth`.
   *
   * Cookies and local storage of a signed in user: as sensitive as the password itself, so it is
   * gitignored and never leaves the machine. Relative paths are resolved from the repository root.
   */
  defaultStorageStatePath: '.auth/storageState.json',

  /**
   * How the engine notices that the captured session has expired, which it will, silently, every
   * few days. Without this check the first step fails with a confusing "label not found" against
   * a sign in page. Checked once, right after the opening navigation, never again.
   */
  session: {
    /** Anything matching these on the landing page means we are signed out, not signed in. */
    signedOutIndicators: [
      'input[type="password"]',
      '#userid',
      '[name="userid"]',
      '[name="pswd"]',
    ],
    /**
     * How long to keep looking for a sign in page after the document has finished loading.
     *
     * Every run pays this, once, and finds nothing in the normal case, so it is deliberately short:
     * a sign in form is present the moment its page loads, unlike an application shell that renders
     * progressively. Being wrong here is cheap in one direction only. Too short and an expired
     * session shows up as a paused step with a confusing message, which is recoverable; too long
     * and every scenario is slower for no benefit at all.
     */
    checkTimeoutMs: envInt('SESSION_CHECK_TIMEOUT_MS', 1500),
  },

  /**
   * List of values behaviour. This is the number one breakage point on Fusion and the main tuning
   * point after the first live run. The option containers below are a first draft covering Oracle
   * JET (Redwood) and classic ADF autosuggest markup.
   */
  lov: {
    optionContainers: [
      '[role="listbox"] [role="option"]',
      '[role="option"]',
      '.oj-listbox-result-label',
      '.oj-listbox-results li',
      '.oj-combobox-results li',
      'ul[role="listbox"] li',
      '.af_autoSuggest tr',
      'table.af_selectManyChoice td',
    ],
    /** How long to wait for the suggestion list to render before falling back to a key press. */
    optionTimeoutMs: envInt('LOV_OPTION_TIMEOUT_MS', 8000),
    /** How long to wait for the field to settle on the selected value. */
    confirmTimeoutMs: envInt('LOV_CONFIRM_TIMEOUT_MS', 5000),
    /** Per character typing delay. Fusion type ahead needs real key events, not a bulk fill. */
    typeDelayMs: envInt('LOV_TYPE_DELAY_MS', 40),
    pollMs: 250,
  },

  /**
   * Oracle error indicators, checked after every step. Detection only: the engine stops and
   * reports, it never tries to recover. Seeded with the common Fusion patterns, both Redwood
   * (Oracle JET messages) and classic ADF. Refine on first contact with the DEV environment.
   */
  errorIndicators: [
    '[role="alertdialog"]',
    '[role="alert"]',
    '.oj-messages .oj-message-summary',
    '.oj-message-summary',
    '.oj-form-control-message-error',
    '.AFErrorText',
    '.af_messages_error',
    '.p_AFError',
    'div[id$="::msgDlg"] .af_messages',
  ],

  /**
   * Text that appears inside an error container but does not mean an error. Matched case
   * insensitively as a substring. Keeps informational and confirmation banners from failing a run.
   */
  errorIgnorePatterns: [
    'confirmation',
    'information',
    'successfully',
    'saved',
    'warning',
    'your changes were saved',
  ],

  /**
   * Production guard. Oracle Fusion pod hostnames are a trap: a DEV pod is legitimately named
   * something like `fa-xxxx-dev1-saasfaprod1.fa.ocs.oraclecloud.com`. A naive search for the
   * substring "prod" blocks the DEV environment. The guard therefore reads the environment token
   * from the first hostname label, where Oracle puts it, and requires it to be an approved one.
   */
  prodGuard: {
    /** The first hostname label must contain one of these tokens. */
    allowedEnvTokens: (env('ALLOWED_ENV_TOKENS', 'dev,test,uat,stage,stg,qa,sandbox') as string)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    /** Any of these in the first hostname label blocks the run outright. */
    deniedEnvTokens: ['prod', 'prd', 'production', 'live'],
    /** Escape hatch for an unusual hostname. Requires a deliberate, documented decision. */
    allowUnrecognised: env('ALLOW_UNRECOGNISED_HOST', 'false') === 'true',
  },
} as const;

/**
 * Where the client derived assets live: `blueprints/` and `data/`.
 *
 * They are deliberately kept OUTSIDE this repository. The repository is a reusable tool; the
 * scenarios and the data belong to whichever client engagement is being tested, and contain
 * usernames, real people and environment URLs that must never enter a versioned file.
 *
 * Set BLUEPRINT_WORKSPACE to that directory, absolute or relative to the repository root.
 * Unset, it falls back to the repository itself, which is what a brand new checkout does before
 * anyone has any blueprints. The offline self test points it at `selftest/`, which makes the whole
 * suite self contained.
 */
export function workspaceDir(rootDir: string): string {
  const configured = env('BLUEPRINT_WORKSPACE');
  return configured ? path.resolve(rootDir, configured) : rootDir;
}

/**
 * Absolute path of the captured session file.
 *
 * Read from the environment on every call, like workspaceDir, rather than frozen into `config` at
 * import time. That is what lets the self test point at a session that does not exist and check
 * that the engine says "run npm run auth" instead of failing on step 1 against a sign in page.
 */
export function storageStateFile(rootDir: string): string {
  const configured = env('STORAGE_STATE', config.defaultStorageStatePath) as string;
  return path.resolve(rootDir, configured);
}

/**
 * Whether a step that cannot resolve pauses for a human instead of failing (D14).
 *
 * On by default, because that is the product: a blocked test waits for the tester, keeps its
 * browser open on the failing screen, and learns from the correction. Set ASSIST=false for a run
 * nobody is watching, where the honest outcome is a red test and a report.
 *
 * Read from the environment on every call so a single test can turn it on or off around itself.
 */
export function assistEnabled(): boolean {
  return env('ASSIST', 'true') !== 'false';
}

export class ProductionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionGuardError';
  }
}

/**
 * Refuses to run against anything that is not recognisably a non production Oracle pod.
 * Called before the first navigation of every run.
 */
export function assertNotProduction(rawUrl: string): void {
  if (!rawUrl) {
    throw new ProductionGuardError(
      'ORACLE_BASE_URL is not set. Copy .env.example to .env and fill in the DEV pod URL.',
    );
  }

  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    throw new ProductionGuardError(`ORACLE_BASE_URL is not a valid URL: ${rawUrl}`);
  }

  // Oracle encodes the environment in the first label, for example: fa-xxxx-dev1-saasfaprod1
  const firstLabel = host.split('.')[0] ?? '';
  const { allowedEnvTokens, deniedEnvTokens, allowUnrecognised } = config.prodGuard;

  for (const denied of deniedEnvTokens) {
    // Match the token as its own dash separated segment, so `saasfaprod1` in the pod suffix does
    // not trip the guard while a real `-prod-` segment does.
    const segments = firstLabel.split('-');
    if (segments.some((s) => s === denied || s.replace(/\d+$/, '') === denied)) {
      throw new ProductionGuardError(
        `Refusing to run: host "${host}" looks like a production environment ` +
          `(segment "${denied}" in "${firstLabel}"). This engine never runs against production.`,
      );
    }
  }

  const looksAllowed = allowedEnvTokens.some((tok) =>
    firstLabel.split('-').some((s) => s === tok || s.replace(/\d+$/, '') === tok),
  );

  if (!looksAllowed && !allowUnrecognised) {
    throw new ProductionGuardError(
      `Refusing to run: host "${host}" does not carry a recognised non production token ` +
        `(${allowedEnvTokens.join(', ')}) in its first label "${firstLabel}". ` +
        `If this really is a test environment, either add its token to ALLOWED_ENV_TOKENS ` +
        `or set ALLOW_UNRECOGNISED_HOST=true in .env, deliberately.`,
    );
  }
}
