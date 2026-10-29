/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The code the integration test sessions share. The sessions attach to
// Freelens started with `pnpm dev` from a freelensapp/freelens checkout, over
// the Chrome DevTools Protocol port that script opens, and drive its renderer
// with Playwright. Its name does not match `*.tests.ts`, so Vitest does not
// collect it as a test file.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";

import type { Browser, ConsoleMessage, Frame, Locator, Page } from "playwright";

export const extensionName = "@freelensapp/ai-extension";

// The root of this checkout, installed in place and read for the fixtures.
const extensionDir = path.resolve(import.meta.dirname, "..", "..");

// The test objects: a namespace, and a Warning event in it.
const fixturesDir = path.join(extensionDir, "integration", "fixtures");

// The CDP endpoint of Freelens dev: `pnpm dev` of Freelens starts Electron
// with `--remoteDebuggingPort 9223`.
const cdpUrl = process.env.FREELENS_CDP_URL || "http://127.0.0.1:9223";

// The log of the main process, which CDP does not carry: the output of
// `pnpm dev` of Freelens, or its `lens.log`. Without it only the renderer's
// errors are checked.
const mainLogFile = process.env.FREELENS_MAIN_LOG;

// The kind cluster the sessions run against.
export const kindClusterName = process.env.TEST_KIND_CLUSTER_NAME || "kind";

// The namespace of the test objects, created by the fixtures.
const testNamespace = "integration-tests";

// The message of the test event, which its row on the Events page shows.
export const testEventMessage = "The integration tests of the extension created this event.";

// The package name with `@` dropped and `/` turned into `--`
// (`sanitizeExtensionName` in Freelens's `lens-extension.ts`).
const sanitizedExtensionId = extensionName.replace("@", "").replace("/", "--");

// The route of the chat page: the `id` of its `clusterPages` registration
// (`MAIN_PAGE_ID`), after the sanitized package name.
const chatPageUrl = `/extension/${sanitizedExtensionId}/ai-extension-main-page`;

// The title and the label of the first input of the extension's
// `appPreferences` entry.
const preferencesTitle = "Freelens AI Settings";
const preferencesInputLabel = "API key";

// The placeholder of the chat's composer.
const composerPlaceholder = "Write a message...";

const viewTimeout = { timeout: 60 * 1000 };

const ansiEscapePattern = /\u001b\[[0-9;]*m/g;

// The Kubernetes proxy of Freelens logs a request that the renderer aborts as
// an error. Freelens dev renders in React.StrictMode, which mounts every view
// twice and aborts the requests of the first mount, so the line comes and goes
// with the timing of a run. It names no request, and says nothing about the
// extension.
const abortedProxyRequestPattern = /proxy_server\.go:\d+\] Error while proxying request: context canceled$/;

// A cluster frame opens on the host's Cluster Overview, which asks for the
// metrics of the nodes, as the Pods and Nodes pages ask for theirs. kind serves
// no `metrics.k8s.io`, and Chromium logs the 404, or a 503 while the cluster
// connects, as a console error, depending on how long the Overview stays open.
// It says nothing about the extension.
const missingMetricsPattern =
  /^Failed to load resource: the server responded with a status of (?:404|503) \(\) \(https:\/\/[^/]+\/api-kube\/apis\/metrics\.k8s\.io\//;

/**
 * A connection to Freelens dev, with the errors that either process logs.
 */
export interface AppSession {
  browser: Browser;
  /** The root frame's page, where the catalog, the extensions and the preferences render. */
  window: Page;
  /** The errors logged so far. */
  errors(): string[];
  /** Stops collecting errors; returns every error logged until then. */
  stopCollecting(): Promise<string[]>;
  /** Stops collecting errors, unless stopped already, and closes the connection; returns every error collected. */
  close(): Promise<string[]>;
}

/**
 * Whether Freelens dev answers on its CDP endpoint and the kind cluster is
 * reachable. Outside CI a session skips with a warning otherwise; in CI the
 * run fails, so that a mistake in the workflow does not turn into a silent
 * skip.
 */
export async function appReady({ cluster }: { cluster: boolean }): Promise<boolean> {
  let reason: string | undefined;

  try {
    const response = await fetch(new URL("/json/version", cdpUrl), { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      reason = `${cdpUrl} answered ${response.status}`;
    }
  } catch (error) {
    reason = `Freelens dev does not answer on ${cdpUrl}: ${error instanceof Error ? error.message : error}`;
  }

  if (!reason && cluster) {
    if (spawnSync("kubectl", ["--context", `kind-${kindClusterName}`, "get", "--raw", "/readyz"]).status !== 0) {
      reason = `the kind cluster ${kindClusterName} is not reachable`;
    }
  }

  if (!reason) {
    return true;
  }

  if (process.env.CI) {
    throw new Error(`Cannot run the integration tests: ${reason}`);
  }

  console.warn(`Skipping the integration tests: ${reason}`);

  return false;
}

/**
 * Describes the arguments of a console message, read in the page: an `Error`
 * by its stack, an `ErrorEvent` by its message, location and error, another
 * `Event` by its type and target, anything else as JSON.
 */
async function describeConsoleArgs(msg: ConsoleMessage): Promise<string> {
  const descriptions = await Promise.all(
    msg.args().map((arg) =>
      arg
        .evaluate((value) => {
          if (value instanceof Error) {
            return value.stack ?? `${value.name}: ${value.message}`;
          }

          if (value instanceof ErrorEvent) {
            const stack = value.error instanceof Error ? ` ${value.error.stack}` : "";

            return `${value.type} event: ${value.message} (${value.filename}:${value.lineno}:${value.colno})${stack}`;
          }

          if (value instanceof Event) {
            return `${value.type} event of ${value.target?.constructor.name ?? "no target"}`;
          }

          try {
            return JSON.stringify(value) ?? String(value);
          } catch {
            return String(value);
          }
        })
        .catch((error) => `<argument not readable: ${error instanceof Error ? error.message : error}>`),
    ),
  );

  // A message of the browser itself, such as a resource or a worker that
  // failed to load, has no arguments; its time ties it to the main log.
  return descriptions.length
    ? descriptions.join(" ")
    : `<empty message without arguments, at ${new Date(msg.timestamp()).toISOString()}>`;
}

/**
 * Collects the errors of the renderer's console, of every frame, and the
 * lines of the main log written after the session started.
 */
function collectErrors(window: Page) {
  const errorLogs: string[] = [];
  const pendingDescriptions: Promise<void>[] = [];
  let mainLogOffset = mainLogFile && fs.existsSync(mainLogFile) ? fs.statSync(mainLogFile).size : 0;

  // Chromium logs every response that is not a success as "Failed to load
  // resource", whose text has no URL, so the location of the message is added.
  // The text of a message is the preview of its arguments: the class name of
  // an object, such as `ErrorEvent`, or nothing at all. Such a message is
  // described from its arguments, read from the page after the event, and
  // `settle()` waits for that. A message of a worker names the worker.
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const { url, lineNumber, columnNumber } = msg.location();
      const worker = msg.worker();
      const location = `${url ? ` (${url}:${lineNumber}:${columnNumber})` : ""}${worker ? ` (worker ${worker.url()})` : ""}`;
      const text = msg.text().replaceAll(ansiEscapePattern, "");

      if (missingMetricsPattern.test(`${text}${location}`)) {
        return;
      }

      const index = errorLogs.push(`[renderer] ${text}${location}`) - 1;

      if (!text.trim() || /^[A-Z]\w*$/.test(text)) {
        pendingDescriptions.push(
          describeConsoleArgs(msg).then((description) => {
            errorLogs[index] = `[renderer] ${description}${location}`;
          }),
        );
      }
    }
  };

  const onPageError = (error: Error) => {
    errorLogs.push(`[renderer] ${error.stack ?? error.message}`);
  };

  // A line of the main log starts with its level, in the file and on the
  // console alike, after the task prefix that turbo adds to the output of
  // `pnpm dev` when it streams it (`freelens:dev: `). Electron writes a message
  // that IPC cannot send to stderr, outside the logger, as `Error sending from
  // webContents:` or `webFrameMain:`; it is on the console only.
  const readMainLog = () => {
    if (!mainLogFile || !fs.existsSync(mainLogFile)) {
      return;
    }

    const size = fs.statSync(mainLogFile).size;

    // A rotated log starts again from the beginning.
    if (size < mainLogOffset) {
      mainLogOffset = 0;
    }

    if (size === mainLogOffset) {
      return;
    }

    const fd = fs.openSync(mainLogFile, "r");

    try {
      const buffer = Buffer.alloc(size - mainLogOffset);

      fs.readSync(fd, buffer, 0, buffer.length, mainLogOffset);
      mainLogOffset = size;

      for (const line of buffer.toString("utf8").split("\n")) {
        const text = line.replaceAll(ansiEscapePattern, "");

        if (
          /^(?:[\w@/.-]+:[\w:-]+: )?\s*(?:error:|Error sending from \w+:)/.test(text) &&
          !abortedProxyRequestPattern.test(text.trim())
        ) {
          errorLogs.push(`[main] ${text.trim()}`);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  window.on("console", onConsole);
  window.on("pageerror", onPageError);

  return {
    errors: () => {
      readMainLog();

      return [...errorLogs];
    },
    settle: async () => {
      await Promise.all(pendingDescriptions);
    },
    stop: () => {
      window.off("console", onConsole);
      window.off("pageerror", onPageError);
    },
  };
}

/**
 * Connects to Freelens dev and collects the errors either process logs until
 * the session stops collecting or is closed. Closing a browser connected over
 * CDP closes only the connection; the app keeps running.
 */
export async function connectApp(): Promise<AppSession> {
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const window = await rootPage(browser);
    const collector = collectErrors(window);
    let collected: Promise<string[]> | undefined;

    const stopCollecting = () => {
      collected ??= (async () => {
        await collector.settle();

        const errors = collector.errors();

        collector.stop();

        return errors;
      })();

      return collected;
    };

    return {
      browser,
      window,
      errors: collector.errors,
      stopCollecting,
      close: async () => {
        const errors = await stopCollecting();

        await browser.close();

        return errors;
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * The page of the root frame: `https://renderer.freelens.app`, on the port of
 * the app's proxy. A cluster renders in an iframe of it, on
 * `<clusterId>.renderer.freelens.app`.
 */
async function rootPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + viewTimeout.timeout;

  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => URL.canParse(page.url()) && new URL(page.url()).hostname === "renderer.freelens.app");

    if (page) {
      await page.waitForFunction(() => globalThis.FreelensExtensionApi?.Renderer !== undefined, null, viewTimeout);

      return page;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No Freelens window on ${cdpUrl}`);
}

/**
 * Navigates the root frame with `Renderer.Navigation.navigate` of the
 * extension API: the application menu, which the packaged-app tests click,
 * belongs to the main process, which CDP does not reach.
 */
async function navigate(window: Page, url: string) {
  console.log(`navigate to ${url}`);
  await window.evaluate((url) => {
    const renderer = globalThis.FreelensExtensionApi.Renderer;

    if (!renderer) {
      throw new Error("The page has no Renderer API");
    }

    renderer.Navigation.navigate(url);
  }, url);
}

/**
 * Dismisses the notifications, so that one still in its enter animation does
 * not intercept pointer events on the elements behind it.
 */
async function dismissNotifications(window: Page) {
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
 * Uninstalls the extension from the Extensions page, from wherever it was
 * installed. An extension installed in place is forgotten, its directory
 * stays.
 */
async function uninstallExtension(window: Page, row: Locator) {
  console.log(`uninstall ${extensionName}`);
  await row.locator('[id^="menu-actions-for-installed-extensions-for-"]').click();
  await window.locator(".MenuActions .MenuItem").getByText("Uninstall", { exact: true }).click();
  await window.getByTestId("confirmation-dialog").getByTestId("confirm").click();
  await row.waitFor({ state: "detached", ...viewTimeout });
}

/**
 * Installs this checkout in place from the Extensions page and waits until it
 * is enabled. An installation of the checkout that is already enabled is
 * kept, unless `reinstall` is set; any other installation of the extension is
 * uninstalled first.
 */
export async function installExtension({ window }: AppSession, { reinstall = false } = {}) {
  await navigate(window, "/extensions");

  const table = window.getByTestId("extensions-table");
  const row = table.locator("tbody tr", { hasText: extensionName });
  const enabled = row.locator("td").nth(2).getByText("Enabled", { exact: true });

  // Once the extensions are discovered, the page shows the table, or a notice
  // in its place when no extension is installed, as in a fresh profile.
  await table.or(window.getByText("There are no extensions installed.", { exact: true })).waitFor(viewTimeout);

  if (await row.count()) {
    // An extension loaded in place reads "development" in the version column,
    // with the directory in its title.
    const inPlace = await row.locator(`[title="Loaded from ${extensionDir}"]`).count();

    if (!reinstall && inPlace && (await enabled.count())) {
      console.log(`${extensionName} is installed from ${extensionDir}`);

      return;
    }

    await uninstallExtension(window, row);
  }

  console.log(`install ${extensionDir}`);
  await window.getByPlaceholder("Name, URL, or path to a package or directory").fill(extensionDir);
  await window.getByRole("button", { name: "Install", exact: true }).click();

  // A directory is loaded in place only after a confirmation.
  await window.getByTestId("confirmation-dialog").getByTestId("confirm").click(viewTimeout);

  // The status column reads "Incompatible" if the host refuses
  // `engines.freelens`.
  await enabled.waitFor(viewTimeout);
  await dismissNotifications(window);
}

/**
 * Opens the extension's tab in the "Extensions" tab group of the preferences,
 * and waits for the title and the input label of the extension's block. The
 * entry sets no `showInPreferencesTab`, so it is on the page of that tab
 * (`registrator-for-preference-items.injectable.tsx` in Freelens). It does not
 * change the preference.
 */
export async function openExtensionPreferences({ window }: AppSession) {
  await navigate(window, `/preferences/extension/${sanitizedExtensionId}`);

  const page = window.locator(
    `[data-preference-page-test="preference-item-for-extension-${sanitizedExtensionId}-page"]`,
  );

  await page.getByText(preferencesTitle, { exact: true }).waitFor(viewTimeout);
  await page.getByText(preferencesInputLabel, { exact: true }).waitFor(viewTimeout);
}

/**
 * The catalog id of the kind cluster, looked up by its name.
 */
async function kindClusterId(window: Page): Promise<string> {
  const id = await window.waitForFunction(
    (name) =>
      globalThis.FreelensExtensionApi.Renderer?.Catalog.catalogEntities
        .getItemsForApiKind("entity.k8slens.dev/v1alpha1", "KubernetesCluster")
        .find((entity) => entity.getName() === name)
        ?.getId(),
    `kind-${kindClusterName}`,
    viewTimeout,
  );

  return id.jsonValue() as Promise<string>;
}

/**
 * The phase of the kind cluster in the catalog: `connected`, `connecting`,
 * `disconnected`.
 */
async function kindClusterPhase(window: Page, id: string): Promise<string | undefined> {
  return window.evaluate(
    (id) => globalThis.FreelensExtensionApi.Renderer?.Catalog.catalogEntities.getById(id)?.status.phase,
    id,
  );
}

/**
 * Disconnects the kind cluster if it is connected, and waits until it is
 * disconnected. A session starts with a disconnected cluster, so that its
 * frame, and the chat page in it, load anew, and ends with one, so that no
 * view watches the test objects while they are deleted. Only the kind cluster
 * is touched; the app may have others.
 */
export async function disconnectKindCluster({ window }: AppSession) {
  const id = await kindClusterId(window);

  if ((await kindClusterPhase(window, id)) === "disconnected") {
    return;
  }

  console.log(`disconnect kind-${kindClusterName}`);
  await navigate(window, "/catalog");
  await window.evaluate(async (id) => {
    const entity = globalThis.FreelensExtensionApi.Renderer?.Catalog.catalogEntities.getById(id);

    if (!entity || !("disconnect" in entity) || typeof entity.disconnect !== "function") {
      throw new Error(`The catalog has no cluster ${id}`);
    }

    await entity.disconnect();
  }, id);
  await window.waitForFunction(
    (id) =>
      globalThis.FreelensExtensionApi.Renderer?.Catalog.catalogEntities.getById(id)?.status.phase === "disconnected",
    id,
    viewTimeout,
  );
}

/**
 * Connects the kind cluster and returns the cluster's frame, where the chat
 * page and the menus render. It opens no page of the cluster, so that the chat
 * page, which loads its own data, can be the first view.
 */
export async function openKindCluster({ window }: AppSession): Promise<Frame> {
  const id = await kindClusterId(window);

  await navigate(window, `/cluster/${id}`);

  const element = await window.waitForSelector(`#cluster-frame-${id}`, viewTimeout);
  const frame = await element.contentFrame();

  if (!frame) {
    throw new Error(`No iframe for kind-${kindClusterName}`);
  }

  await frame.waitForSelector("[data-testid=cluster-sidebar]", viewTimeout);

  return frame;
}

/**
 * Navigates the cluster frame with `Renderer.Navigation.navigate` of the
 * extension API, to a page of the host or of the extension. The sidebar
 * entries of the host's kinds are nested under groups that the sidebar renders
 * collapsed.
 */
async function navigateFrame(frame: Frame, url: string) {
  console.log(`navigate the cluster frame to ${url}`);
  await frame.evaluate((url) => {
    const renderer = globalThis.FreelensExtensionApi.Renderer;

    if (!renderer) {
      throw new Error("The cluster frame has no Renderer API");
    }

    renderer.Navigation.navigate(url);
  }, url);
}

/**
 * Selects the namespace of the test objects in the namespace filter of a list
 * page of the host. The selection holds for every namespaced list of the
 * cluster, and the app keeps it, so it is made only when the filter shows
 * another one.
 */
async function selectTestNamespace(frame: Frame) {
  const label = frame.locator(".NamespaceSelect").getByText(`Namespace: ${testNamespace}`, { exact: true });
  const namespaceSelect = await frame.waitForSelector(".NamespaceSelect", viewTimeout);

  if (await label.count()) {
    return;
  }

  console.log(`select namespace ${testNamespace}`);
  await namespaceSelect.click();
  await namespaceSelect.type(testNamespace);
  await namespaceSelect.press("Enter");
  await namespaceSelect.click();
  await label.waitFor(viewTimeout);
}

/**
 * Runs kubectl against the kind cluster, never the current context, and fails
 * with its stderr when it exits non-zero.
 */
function kubectl(...args: string[]): string {
  const argv = ["--context", `kind-${kindClusterName}`, ...args];
  const command = `kubectl ${argv.join(" ")}`;

  console.log(command);

  const { error, status, signal, stdout, stderr } = spawnSync("kubectl", argv, {
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
  });

  if (error) {
    throw new Error(`${command} failed: ${error.message}`);
  }

  if (status !== 0) {
    throw new Error(`${command} exited with ${status ?? signal}: ${stderr.trim()}`);
  }

  if (stdout.trim()) {
    console.log(stdout.trim());
  }

  return stdout;
}

/**
 * Removes what an earlier run left, then applies the test objects.
 */
export function setUpCluster() {
  kubectl("delete", "namespace", testNamespace, "--ignore-not-found", "--wait");
  kubectl("apply", "-k", fixturesDir);
}

/**
 * Deletes the test objects.
 */
export function tearDownCluster() {
  kubectl("delete", "-k", fixturesDir, "--ignore-not-found", "--wait");
}

/**
 * Opens the host's Events page, selects the namespace of the test objects,
 * and returns the row of the test event. The page does not show the name of
 * an event, so the row is found by its message.
 */
export async function openEventsPage(frame: Frame): Promise<Locator> {
  await navigateFrame(frame, "/events");
  await selectTestNamespace(frame);

  const row = frame.locator(".TableRow").filter({ hasText: testEventMessage }).first();

  await row.waitFor(viewTimeout);

  return row;
}

/**
 * Opens the context menu of the row and returns the menu, which the host
 * renders outside the row.
 */
export async function openRowMenu(frame: Frame, row: Locator): Promise<Locator> {
  const trigger = row.locator('.TableCell.menu [data-testid^="icon-for-menu-actions-for-kube-object-menu-for-"]');
  const triggerTestId = await trigger.getAttribute("data-testid", viewTimeout);

  if (!triggerTestId) {
    throw new Error("The row has no menu");
  }

  await trigger.click();

  const menu = frame.getByTestId(triggerTestId.replace(/^icon-for-/, ""));

  await menu.waitFor(viewTimeout);

  return menu;
}

/**
 * Waits for the item of the menu with the title, and closes the menu without
 * clicking the item.
 */
export async function waitForMenuItem(frame: Frame, menu: Locator, title: string) {
  await menu.locator(".MenuItem .title").getByText(title, { exact: true }).waitFor(viewTimeout);
  await frame.locator("body").press("Escape");
  await menu.waitFor({ state: "hidden", ...viewTimeout });
}

/**
 * Clicks the item of the menu with the title.
 */
export async function clickMenuItem(menu: Locator, title: string) {
  console.log(`click ${title}`);
  await menu.locator(".MenuItem").filter({ hasText: title }).click(viewTimeout);
}

/**
 * The model endpoint of the prompts: an OpenAI-compatible API, its key and
 * the name of a model. They come from LLM_API_URL, LLM_API_KEY and
 * LLM_API_MODEL; without any of them there is no endpoint, and the prompts are
 * skipped.
 */
export interface ModelEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const modelEndpoint: ModelEndpoint | undefined =
  process.env.LLM_API_URL && process.env.LLM_API_KEY && process.env.LLM_API_MODEL
    ? { baseUrl: process.env.LLM_API_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_API_MODEL }
    : undefined;

// The placeholders of the inputs of the extension's preferences.
const apiKeyPlaceholder = "Put here your OpenAI API key";
const baseUrlPlaceholder = "https://api.openai.com/v1";
const modelNamePlaceholder = "Model name, e.g. gpt-6.1-sol";

/**
 * Opens the extension's preferences and sets the API key, and with an
 * endpoint its base URL and the model, which is added to the list of models
 * unless it is there. Without an endpoint, the key is cleared. The key is
 * never logged. The other preferences are left as they are.
 */
export async function setModelPreferences(session: AppSession, endpoint: ModelEndpoint | undefined) {
  await openExtensionPreferences(session);

  const { window } = session;

  console.log(endpoint ? `set the endpoint ${endpoint.baseUrl} and the model ${endpoint.model}` : "clear the API key");
  await window.getByPlaceholder(apiKeyPlaceholder, { exact: true }).fill(endpoint?.apiKey ?? "");

  if (!endpoint) {
    return;
  }

  await window.getByPlaceholder(baseUrlPlaceholder, { exact: true }).fill(endpoint.baseUrl);

  // The list of models is a row per model, before the input of a new one. The
  // stylesheet of the preferences names its classes in camel case.
  const modelRow = window.locator('[class*="_modelRow_"]').filter({
    has: window.getByText(endpoint.model, { exact: true }),
  });

  if (!(await modelRow.count())) {
    await window.getByPlaceholder(modelNamePlaceholder, { exact: true }).fill(endpoint.model);
    await window.getByRole("button", { name: "Add", exact: true }).click();
    await modelRow.waitFor(viewTimeout);
  }
}

// How long a run of the agent may take, from the prompt to the end of its
// answer.
const runTimeout = { timeout: 3 * 60 * 1000 };

// The elements of the chat page, by the class names that CSS modules give
// them in the bundle. The transcript renders a message of the user as a
// bubble, an answer of the agent as a plain `div`, and an error with its Retry
// button.
const errorPageSelector = '[class*="_errorPage_"]';
const transcriptSelector = '[class*="_messages-container_"]';
const sentMessageSelector = `${transcriptSelector} > [class*="_message-bubble_"]`;
const answerSelector = `${transcriptSelector} > div:not([class])`;
const chatErrorSelector = `${transcriptSelector} > [class*="_error-message_"]`;
const runningSelector = '[class*="_chat-loading-spinner_"]';
const modelSelectSelector = '[class*="_text-input-select-box_"]';

/**
 * Opens the chat page of the extension in the cluster frame, and waits for its
 * composer. Without it, fails with the error page that the extension's error
 * boundary shows in its place.
 */
export async function openChat(frame: Frame): Promise<Locator> {
  await navigateFrame(frame, chatPageUrl);

  const composer = frame.getByPlaceholder(composerPlaceholder, { exact: true });

  try {
    await composer.waitFor(viewTimeout);
  } catch (error) {
    const shown = await frame.locator(errorPageSelector).allInnerTexts();

    throw new Error(`The chat page shows no composer: ${shown.join("; ").replaceAll("\n", " ") || "nothing"}`, {
      cause: error,
    });
  }

  return composer;
}

/**
 * Toggles the list of the agent's tools under the composer, and returns the
 * list once shown. The list comes from main, over the bridge. The button's
 * content is an emoji, which is its accessible name, so it is found by its
 * title.
 */
export async function showTools(frame: Frame): Promise<Locator> {
  await frame.locator('button[title="Show Tools"]').click();

  const list = frame.locator(".text-input-vertical-list");

  await list.waitFor(viewTimeout);

  return list;
}

/**
 * Hides the list of the agent's tools.
 */
export async function hideTools(frame: Frame) {
  await frame.locator('button[title="Hide Tools"]').click();
  await frame.locator(".text-input-vertical-list").waitFor({ state: "detached", ...viewTimeout });
}

/**
 * The "Configure agent" button, which the composer shows in place of the model
 * selection when no model or no API key is set.
 */
export function configureAgentButton(frame: Frame): Locator {
  return frame.getByRole("button", { name: "Configure agent", exact: true });
}

/**
 * Waits until the preferences of the extension are shown in the root frame,
 * where "Configure agent" of a cluster frame leads.
 */
export async function waitForExtensionPreferences({ window }: AppSession) {
  const page = window.locator(
    `[data-preference-page-test="preference-item-for-extension-${sanitizedExtensionId}-page"]`,
  );

  await page.getByText(preferencesTitle, { exact: true }).waitFor(viewTimeout);
}

/**
 * Selects the model in the composer, unless it is selected already.
 */
export async function selectModel(frame: Frame, model: string) {
  const select = frame.locator(modelSelectSelector);
  const selected = select.locator(".Select__single-value").getByText(model, { exact: true });

  await select.waitFor(viewTimeout);

  if (await selected.count()) {
    return;
  }

  console.log(`select the model ${model}`);
  await select.locator(".Select__control").click();
  await frame.locator(".Select__option").getByText(model, { exact: true }).click(viewTimeout);
  await selected.waitFor(viewTimeout);
}

/**
 * Clears the chat with "Clear chat", which also clears the conversation of
 * the agents in main, and waits until the transcript is empty. The button is
 * disabled while the transcript is empty already.
 */
export async function clearChat(frame: Frame) {
  const button = frame.getByRole("button", { name: "Clear chat", exact: true });

  if (await button.isDisabled()) {
    return;
  }

  console.log("clear the chat");
  await button.click();
  await frame
    .locator(`${sentMessageSelector}, ${answerSelector}, ${chatErrorSelector}`)
    .first()
    .waitFor({ state: "detached", ...viewTimeout });
}

/**
 * Waits for the end of a run: for an answer of the agent that contains the
 * expected text, or for any answer without it, and then for the spinner to go.
 * Fails with the text of the chat's error, if the run ends with one. Returns
 * the text of the last answer.
 */
export async function waitForAnswer(frame: Frame, expected?: string): Promise<string> {
  const answers = frame.locator(answerSelector);
  const answer = (expected ? answers.filter({ hasText: expected }) : answers).last();
  const failure = frame.locator(chatErrorSelector);

  await answer.or(failure).first().waitFor(runTimeout);
  await frame.locator(runningSelector).waitFor({ state: "detached", ...runTimeout });

  if (await failure.count()) {
    throw new Error(`The chat shows an error: ${(await failure.allInnerTexts()).join("; ")}`);
  }

  return answer.innerText();
}

/**
 * Sends the prompt and returns the answer of the agent that contains the
 * expected text, once the run ends.
 */
export async function askAgent(frame: Frame, prompt: string, expected: string): Promise<string> {
  console.log(`ask the agent: ${prompt}`);
  await frame.getByPlaceholder(composerPlaceholder, { exact: true }).fill(prompt);
  await frame.getByRole("button", { name: "Send", exact: true }).click();

  return waitForAnswer(frame, expected);
}

/**
 * The message of the user that the chat shows for a prompt that contains the
 * text, such as the one "Explain" sends.
 */
export function sentMessage(frame: Frame, text: string): Locator {
  return frame.locator(sentMessageSelector).filter({ hasText: text });
}
