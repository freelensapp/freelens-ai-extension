/**
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Runs inside a Freelens checkout, copied into `freelens/integration/__tests__/`
// by the integration tests workflow, and imports the helpers found there.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installExtension, openExtensionPreferences, startApp } from "./extension-helpers";

import type { AppSession } from "./extension-helpers";

describe("extensions page tests", () => {
  let session: AppSession | undefined;

  beforeAll(async () => {
    session = await startApp();
    await installExtension(session);
  }, 120 * 1000);

  afterAll(
    async () => {
      expect((await session?.close()) ?? []).toEqual([]);
    },
    10 * 60 * 1000,
  );

  it(
    "installs an extension",
    async () => {
      expect(session?.errors()).toEqual([]);
    },
    100 * 60 * 1000,
  );

  it("opens the extension's preferences", async () => {
    if (!session) {
      throw new Error("The app did not start");
    }

    await openExtensionPreferences(session);
  });
});
