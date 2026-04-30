/**
 * E2E: drive the Shield flow end-to-end through the real MetaMask fork.
 *
 * Strategy:
 * 1. Launch Chromium with --load-extension pointing at metamask-fork/dist/chrome.
 * 2. Persist the user-data-dir so MetaMask onboarding only happens once.
 * 3. On first run: import the test seed via the onboarding flow.
 *    On subsequent runs: just unlock with the password.
 * 4. Open the side panel, switch to Tokens tab, click USDC → Shield.
 * 5. Type an amount, click Continue.
 * 6. Confirm the two popups (approve + wrap).
 * 7. Assert: cTokens tab shows the wrapped balance.
 *
 * Run: pnpm exec playwright test e2e/shield-flow.spec.ts --headed
 *
 * Why headed: MetaMask doesn't run reliably in headless Chromium because
 * it depends on chrome.* APIs that are stubbed in headless mode.
 */
import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FORK_DIST = path.resolve(__dirname, '../metamask-fork/dist/chrome');
const TEST_PROFILE_DIR = path.resolve(os.tmpdir(), 'nox-mm-test-profile');

// Same testnet seed as the contract scripts (already burned in chat history).
// Account 1 of this seed = 0x91591a0cA1EAB188689f5DD9e4d2A4741FBD720D
// Funded with USDC + RLC on Arbitrum Sepolia.
const TEST_SEED =
  process.env.NOX_TEST_SEED ??
  // 12-word mnemonic for the test account. Replace via env if needed.
  '';
const TEST_PASSWORD = 'PlaywrightTest1!';

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string }> {
  fs.mkdirSync(TEST_PROFILE_DIR, { recursive: true });
  if (!fs.existsSync(FORK_DIST)) {
    throw new Error(`Fork dist not found at ${FORK_DIST}. Run 'yarn start' in metamask-fork first.`);
  }

  const context = await chromium.launchPersistentContext(TEST_PROFILE_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${FORK_DIST}`,
      `--load-extension=${FORK_DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Give the extension time to register its background worker.
  let extensionId: string | undefined;
  for (let i = 0; i < 30; i++) {
    const workers = context.serviceWorkers();
    const pages = context.pages();
    console.log(`[e2e] poll ${i}: ${workers.length} workers, ${pages.length} pages`);
    for (const w of workers) console.log(`  worker: ${w.url()}`);
    for (const p of pages) console.log(`  page: ${p.url()}`);

    // Try service worker first
    const ext = workers.find((w) => w.url().startsWith('chrome-extension://'));
    if (ext) {
      extensionId = ext.url().split('/')[2];
      break;
    }
    // Fallback: any extension page (e.g. onboarding home.html)
    const extPage = pages.find((p) => p.url().startsWith('chrome-extension://'));
    if (extPage) {
      extensionId = extPage.url().split('/')[2];
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!extensionId) throw new Error('Could not detect extension ID after 15s');
  console.log(`[e2e] extension ID: ${extensionId}`);

  return { context, extensionId };
}

async function isOnboarded(page: Page): Promise<boolean> {
  // Onboarded MetaMask shows the unlock prompt or the home page.
  // Unboarded shows the welcome screen with "Get started".
  const html = await page.content();
  return !html.includes('Welcome to MetaMask') && !html.includes('Get started');
}

async function unlockOrOnboard(page: Page) {
  // Try unlock first (if onboarded). If welcome screen visible, do onboarding.
  await page.waitForTimeout(2000); // let things settle

  const passwordField = page.locator('input[type="password"]').first();
  if (await passwordField.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('[e2e] Unlock prompt detected; entering password');
    await passwordField.fill(TEST_PASSWORD);
    await page.locator('button[data-testid="unlock-submit"]').click();
    await page.waitForTimeout(3000);
    return;
  }

  // Onboarding flow
  console.log('[e2e] No unlock prompt; running onboarding');
  if (!TEST_SEED) {
    throw new Error(
      'Onboarding required but NOX_TEST_SEED env var not set. ' +
        'Set it to a 12-word mnemonic, or pre-onboard the test profile manually.',
    );
  }

  // Click "I agree to the terms" or similar
  const termsCheckbox = page.locator('input[data-testid="onboarding-terms-checkbox"]').first();
  if (await termsCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
    await termsCheckbox.check();
  }

  await page.locator('button:has-text("Import an existing wallet")').click();
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("No thanks")').click().catch(() => {});

  // Fill seed words (12 inputs)
  const words = TEST_SEED.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    await page.locator(`input[data-testid="import-srp__srp-word-${i}"]`).fill(words[i]);
  }
  await page.locator('button:has-text("Confirm Secret Recovery Phrase")').click();

  // Set password
  await page.locator('input[data-testid="create-password-new"]').fill(TEST_PASSWORD);
  await page.locator('input[data-testid="create-password-confirm"]').fill(TEST_PASSWORD);
  await page.locator('input[data-testid="create-password-terms"]').check();
  await page.locator('button[data-testid="create-password-import"]').click();

  // Wait for onboarding completion
  await page.locator('button:has-text("Done")').click({ timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

test('extension loads and home page renders', async () => {
  const { context, extensionId } = await launchExtension();

  const home = await context.newPage();
  await home.goto(`chrome-extension://${extensionId}/home.html`);

  const screenshotsDir = path.resolve(__dirname, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await home.screenshot({ path: path.join(screenshotsDir, '01-home.png') });
  console.log('[e2e] Saved 01-home.png');

  await expect(home).toHaveURL(/home\.html/);
  await context.close();
});

// TODO: Full Shield flow test. Requires:
//  - NOX_TEST_SEED env var set to a 12-word mnemonic of an account funded
//    with USDC on Arbitrum Sepolia
//  - First run does onboarding (imports seed, sets password, adds Arb Sepolia
//    network if not already there, adds USDC token)
//  - Subsequent runs reuse TEST_PROFILE_DIR and just unlock
// The unlockOrOnboard() helper above is the start of this; the rest of the
// Shield navigation + popup confirmation is unimplemented.
test.skip('Shield button on USDC asset page leads to popups and successful wrap', async () => {
  const { context, extensionId } = await launchExtension();
  const home = await context.newPage();
  await home.goto(`chrome-extension://${extensionId}/home.html`);
  await unlockOrOnboard(home);
  // ... TODO ...
  await context.close();
});
