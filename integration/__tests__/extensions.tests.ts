/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Installs this checkout in place in Freelens dev, uninstalling whatever
// installation of the extension the app had, and opens its preferences.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appReady, connectApp, installExtension, openExtensionPreferences } from "./extension-helpers";

import type { AppSession } from "./extension-helpers";

describe.skipIf(!(await appReady({ cluster: false })))("extensions page tests", () => {
  let session: AppSession | undefined;

  beforeAll(async () => {
    session = await connectApp();
    await installExtension(session, { reinstall: true });
  }, 120 * 1000);

  afterAll(async () => {
    expect((await session?.close()) ?? []).toEqual([]);
  });

  it("installs the extension", () => {
    expect(session?.errors()).toEqual([]);
  });

  it("opens the extension's preferences", async () => {
    if (!session) {
      throw new Error("The app is not connected");
    }

    await openExtensionPreferences(session);
  });
});
