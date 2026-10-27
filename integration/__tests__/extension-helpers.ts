/**
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The code the integration tests share. Copied with them into
// `freelens/integration/__tests__/` by the integration tests workflow, and
// imports the helpers found there. Its name does not match `*.tests.ts`, so
// Freelens's Vitest does not collect it as a test file.

import * as utils from "../helpers/utils";

import type { ConsoleMessage, ElectronApplication, Page } from "playwright";

export const extensionName = "@freelensapp/ai-extension";

// The package name with `@` dropped and `/` turned into `--`
// (`sanitizeExtensionName` in Freelens's `lens-extension.ts`).
const sanitizedExtensionId = extensionName.replace("@", "").replace("/", "--");

// The title of the extension's `appPreferences` entry and a label on its page.
const preferencesTitle = "Freelens AI Settings";
const preferencesInputLabel = "Thinking level";

const viewTimeout = { timeout: 60 * 1000 };

/**
 * An app started by `startApp`, with the errors that either process logs.
 */
export interface AppSession {
  app: ElectronApplication;
  window: Page;
  /** The errors logged so far. */
  errors(): string[];
  /** Closes the app and stops collecting errors; returns every error logged. */
  close(): Promise<string[]>;
}

/**
 * Collects the errors of the renderer's console and of the output of the test
 * process, which carries the output of the app.
 */
function collectErrors() {
  const errorLogs: string[] = [];
  const processErrorLogs: string[] = [];
  const outputErrorPattern = /\[out\]\s*error:/i;
  const ansiEscapePattern = /\u001b\[[0-9;]*m/g;
  let processOutputBuffer = "";

  const collectOutputErrors = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    processOutputBuffer += text;

    // Keep buffer bounded while preserving enough tail to match split patterns across chunks.
    if (processOutputBuffer.length > 200_000) {
      processOutputBuffer = processOutputBuffer.slice(-20_000);
    }

    const normalizedOutput = processOutputBuffer.replaceAll(ansiEscapePattern, "");

    if (outputErrorPattern.test(normalizedOutput)) {
      processErrorLogs.push(normalizedOutput.trim());
      processOutputBuffer = "";
    }
  };

  const logger = (msg: ConsoleMessage) => {
    const text = msg.text();
    const normalizedText = text.replaceAll(ansiEscapePattern, "");

    console.log(text);

    // Some app logs are emitted as "log" messages, so inspect both console type and message content.
    if (msg.type() === "error" || outputErrorPattern.test(normalizedText)) {
      errorLogs.push(`[${msg.type()}] ${normalizedText}`);
    }
  };

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk, encoding, cb) => {
    collectOutputErrors(chunk);

    return originalStdoutWrite(chunk, encoding as never, cb as never);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk, encoding, cb) => {
    collectOutputErrors(chunk);

    return originalStderrWrite(chunk, encoding as never, cb as never);
  }) as typeof process.stderr.write;

  return {
    logger,
    errors: () => [...errorLogs, ...processErrorLogs],
    stop: () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

/**
 * Starts the app, with a fresh `FREELENS_INTEGRATION_TESTING_DIR`, and collects
 * the errors either process logs until it is closed.
 */
export async function startApp(): Promise<AppSession> {
  const collector = collectErrors();
  let started: Awaited<ReturnType<typeof utils.start>> | undefined;

  try {
    started = await utils.start();
    started.window.on("console", collector.logger);
    console.log("await utils.clickWelcomeButton");
    await utils.clickWelcomeButton(started.window);
  } catch (error) {
    await started?.cleanup();
    collector.stop();
    throw error;
  }

  const { app, window, cleanup } = started;

  return {
    app,
    window,
    errors: collector.errors,
    close: async () => {
      // Keep listeners active through cleanup to catch late shutdown errors in CI logs.
      await cleanup();
      window.off("console", collector.logger);
      collector.stop();

      return collector.errors();
    },
  };
}

async function clickApplicationMenuItem(app: ElectronApplication, parentId: string, id: string) {
  await app.evaluate(
    async ({ app }, { parentId, id }) => {
      await app.applicationMenu?.getMenuItemById(parentId)?.submenu?.getMenuItemById(id)?.click();
    },
    { parentId, id },
  );
}

/**
 * Installs the extension from the Extensions page and waits until it is
 * enabled.
 */
export async function installExtension({ app, window }: AppSession) {
  // Navigate to extensions page
  console.log("navigate to extensions");
  await clickApplicationMenuItem(app, process.platform === "darwin" ? "mac" : "file", "navigate-to-extensions");

  // Trigger extension install: the packed tarball from the workflow, or the
  // published package when the test runs without one.
  console.log("await textbox.fill");
  await window
    .getByPlaceholder("Name, URL, or path to a package or directory")
    .fill(process.env.EXTENSION_PATH || extensionName);
  console.log("await install button click");
  await window.getByRole("button", { name: "Install", exact: true }).click();

  // Expect extension to be listed in installed list and enabled. The status
  // column reads "Incompatible" if the host refuses `engines.freelens`.
  console.log("await extensions table row");
  const row = window.getByTestId("extensions-table").locator("tbody tr", { hasText: extensionName });
  await row.locator("td").nth(2).getByText("Enabled", { exact: true }).waitFor();

  // Dismiss any notifications so a notification still in its enter animation
  // does not intercept pointer events on the elements behind it.
  console.log("dismiss notifications");
  const notificationCloseSelector =
    'i[data-testid*="close-notification-for-notification_"], div[class*="close-button-module__closeButton--"][aria-label="Close"]';
  for (let attempt = 0; attempt < 10; attempt++) {
    const closeButtons = await window.$$(notificationCloseSelector);
    if (closeButtons.length === 0) break;
    for (const closeButton of closeButtons) {
      await closeButton.click({ force: true }).catch(() => {});
    }
    await window.waitForTimeout(200);
  }
}

/**
 * Opens the preferences from the application menu, then the extension's tab in
 * the "Extensions" tab group, and waits for the title and a label of the
 * extension's block. The entry sets no `showInPreferencesTab`, so it is on the
 * page of that tab (`registrator-for-preference-items.injectable.tsx` in
 * Freelens). It does not change any preference.
 */
export async function openExtensionPreferences({ app, window }: AppSession) {
  console.log("navigate to preferences");
  await clickApplicationMenuItem(app, process.platform === "darwin" ? "mac" : "file", "navigate-to-preferences");

  console.log(`open the preferences tab of ${extensionName}`);
  await window
    .locator('[data-preference-tab-group-test="extensions-tab-group"]')
    .getByRole("tab", { name: extensionName, exact: true })
    .click(viewTimeout);

  const page = window.locator(
    `[data-preference-page-test="preference-item-for-extension-${sanitizedExtensionId}-page"]`,
  );

  await page.getByText(preferencesTitle, { exact: true }).waitFor(viewTimeout);
  await page.getByText(preferencesInputLabel, { exact: true }).waitFor(viewTimeout);
}
