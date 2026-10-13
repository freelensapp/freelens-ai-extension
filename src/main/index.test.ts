import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_TOKEN_HEADER, BridgeRoute } from "../common/bridge/protocol";
import { PreferencesStore } from "../common/store";
import LensExtensionAiMain from "./index";

// The lifecycle methods are protected in the host's declaration; the host
// calls them, and so does this test.
interface Lifecycle {
  onActivate(): Promise<void>;
  onDeactivate(): Promise<void>;
}

const preferences = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

const callTools = (port: number | null, token: string | null) =>
  fetch(`http://127.0.0.1:${port}${BridgeRoute.tools}?clusterId=cluster-a`, {
    headers: token ? { [BRIDGE_TOKEN_HEADER]: token } : {},
  });

let extensions: Lifecycle[] = [];

const activate = async () => {
  // The stubbed base class reads nothing of the installed extension.
  const installed = {} as ConstructorParameters<typeof LensExtensionAiMain>[0];
  const extension = new LensExtensionAiMain(installed) as unknown as Lifecycle;
  extensions.push(extension);
  await extension.onActivate();
  return extension;
};

beforeEach(() => {
  PreferencesStore.resetInstance();
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(async () => {
  for (const extension of extensions) {
    await extension.onDeactivate();
  }
  extensions = [];
  vi.unstubAllEnvs();
});

describe("LensExtensionAiMain", () => {
  it("starts the bridge on activation and writes its port and token into the store", async () => {
    await activate();
    const { aiProxyPort, aiProxyToken } = preferences();

    expect(aiProxyPort).toEqual(expect.any(Number));
    expect(aiProxyToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await callTools(aiProxyPort, null)).status).toBe(401);
    expect((await callTools(aiProxyPort, aiProxyToken)).status).toBe(200);
  });

  it("closes the bridge on deactivation", async () => {
    const extension = await activate();
    const { aiProxyPort, aiProxyToken } = preferences();

    await extension.onDeactivate();

    expect(preferences().aiProxyPort).toBeNull();
    await expect(callTools(aiProxyPort, aiProxyToken)).rejects.toThrow();
  });

  it("leaves exactly one bridge bound after a reload, with a new port and token", async () => {
    const first = await activate();
    const old = { port: preferences().aiProxyPort, token: preferences().aiProxyToken };
    await first.onDeactivate();

    await activate();

    const current = { port: preferences().aiProxyPort, token: preferences().aiProxyToken };
    expect(current.token).not.toBe(old.token);
    expect((await callTools(current.port, current.token)).status).toBe(200);
    expect((await callTools(current.port, old.token)).status).toBe(401);
    // The system may hand the old port out again; only when it did not, nothing
    // listens there any more.
    if (current.port !== old.port) {
      await expect(callTools(old.port, old.token)).rejects.toThrow();
    }
  });

  it("tells the renderer whether OPENAI_API_KEY is set, never the key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-from-environment");

    await activate();

    expect(preferences().openAIKeyFromEnvironment).toBe(true);
    expect(JSON.stringify(preferences().toJSON())).not.toContain("sk-from-environment");
  });
});
