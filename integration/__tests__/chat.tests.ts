/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The cluster session: a namespace with a Warning event
// (`integration/fixtures`). The chat page of the cluster opens with its
// composer and lists the agent's tools, "Configure agent" opens the
// preferences while no API key is set, and the row of the event carries the
// extension's "Explain" item. The session disconnects the kind cluster, sets
// up the objects, connects the cluster again, and leaves it disconnected; it
// does not depend on another test file having run.
//
// With a model endpoint (LLM_API_URL, LLM_API_KEY and LLM_API_MODEL, from the
// environment or a local `.env`), the session sets it in the preferences, one
// prompt gets an answer that needs a tool call, and "Explain" of the event
// gets an explanation. Without one, as in CI, the prompts are skipped and the
// API key stays cleared.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appReady,
  askAgent,
  clearChat,
  clickMenuItem,
  configureAgentButton,
  connectApp,
  disconnectKindCluster,
  hideTools,
  installExtension,
  modelEndpoint,
  openChat,
  openEventsPage,
  openKindCluster,
  openRowMenu,
  selectModel,
  sentMessage,
  setModelPreferences,
  setUpCluster,
  showTools,
  tearDownCluster,
  testEventMessage,
  waitForAnswer,
  waitForExtensionPreferences,
  waitForMenuItem,
} from "./extension-helpers";

import type { Frame } from "playwright";

import type { AppSession } from "./extension-helpers";

// A prompt and an answer may take a few minutes each.
const promptTimeout = 10 * 60 * 1000;

describe.skipIf(!(await appReady({ cluster: true })))("chat and menu items", () => {
  let session: AppSession | undefined;
  let frame: Frame;

  const app = () => {
    if (!session) {
      throw new Error("The app is not connected");
    }

    return session;
  };

  beforeAll(
    async () => {
      session = await connectApp();
      await disconnectKindCluster(session);
      setUpCluster();
      await installExtension(session);
      frame = await openKindCluster(session);
    },
    10 * 60 * 1000,
  );

  afterAll(
    async () => {
      let errors: string[] = [];

      try {
        // The errors first: the app refreshes the cluster while it disconnects,
        // and logs errors of its own when the refresh loses the race.
        errors = (await session?.stopCollecting()) ?? [];

        // The cluster then: the Events page watches the test event, which is
        // deleted next.
        if (session) {
          await disconnectKindCluster(session);
        }

        await session?.close();
      } finally {
        tearDownCluster();
      }

      expect(errors).toEqual([]);
    },
    10 * 60 * 1000,
  );

  // The first view of the cluster, so that the chat page loads its transcript,
  // its pricing and its tools itself, under React.StrictMode in Freelens dev.
  it("opens the chat page with its composer", async () => {
    await openChat(frame);
  });

  it("lists the tools of the agent", async () => {
    await openChat(frame);

    const tools = await showTools(frame);

    await tools.getByText(/^getNamespaces - /).waitFor();
    await hideTools(frame);
  });

  // The preferences render in the root frame, over the cluster frame, so a
  // test that opens them shows the cluster again also when it fails.
  it('opens the preferences with "Configure agent" while no API key is set', async () => {
    try {
      await setModelPreferences(app(), undefined);
      frame = await openKindCluster(app());
      await openChat(frame);
      await configureAgentButton(frame).click();
      await waitForExtensionPreferences(app());
    } finally {
      frame = await openKindCluster(app());
    }
  });

  it.skipIf(!modelEndpoint)(
    "answers a prompt with a tool call",
    async () => {
      if (!modelEndpoint) {
        return;
      }

      try {
        await setModelPreferences(app(), modelEndpoint);
      } finally {
        frame = await openKindCluster(app());
      }

      await openChat(frame);
      await selectModel(frame, modelEndpoint.model);
      await clearChat(frame);

      const answer = await askAgent(
        frame,
        "List the names of the namespaces of this cluster, one per line, with the getNamespaces tool.",
        "integration-tests",
      );

      expect(answer).toContain("integration-tests");
    },
    promptTimeout,
  );

  it('shows "Explain" in the menu of the row of a Warning event', async () => {
    const row = await openEventsPage(frame);
    const menu = await openRowMenu(frame, row);

    await waitForMenuItem(frame, menu, "Explain");
  });

  it.skipIf(!modelEndpoint)(
    'explains the event with "Explain"',
    async () => {
      await openChat(frame);
      await clearChat(frame);

      const row = await openEventsPage(frame);
      const menu = await openRowMenu(frame, row);

      await clickMenuItem(menu, "Explain");
      await sentMessage(frame, testEventMessage).waitFor();

      const answer = await waitForAnswer(frame);

      expect(answer.trim()).not.toBe("");
    },
    promptTimeout,
  );
});
