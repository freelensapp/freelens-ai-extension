// Minimal stub of `@freelensapp/extensions` for unit tests.
//
// The published package is a shim that reads `Common`, `Main` and `Renderer`
// off `globalThis.FreelensExtensionApi`, which the Freelens host sets before it
// loads an extension. A Vitest process has no host, so importing the real
// package throws. `vitest.config.ts` aliases the import to this file instead.
// The package ships no mocks of its own to use in its place.
//
// Only the surface the tests exercise is stubbed here, and only at runtime: the
// tests are type-checked against the real declaration of the package. Extend it
// as your tests need more of the host API.
import React from "react";
import { vi } from "vitest";

// Minimal stand-in for the host `ExtensionStore` base class. The real one
// persists to disk: it loads the saved model with `fromStore()` and saves it
// whenever `toJSON()` changes. The stub keeps subclass state in memory so store
// logic (e.g. `PreferencesStore`) can be used in tests. As in the host, a store
// is a singleton per class; `resetInstance()` drops it between tests.
const instances = new Map<unknown, unknown>();

class ExtensionStore<_T> {
  constructor(_params: unknown) {}
  loadExtension(_extension: unknown): void {}
  static createInstance<T>(this: new () => T): T {
    const instance = new this();
    instances.set(this, instance);
    return instance;
  }
  static getInstance<T>(this: new () => T): T {
    return instances.get(this) as T;
  }
  static getInstanceOrCreate<T>(this: new () => T): T {
    return (
      (instances.get(this) as T | undefined) ?? (ExtensionStore.createInstance as (this: new () => T) => T).call(this)
    );
  }
  static resetInstance(this: unknown): void {
    instances.delete(this);
  }
}

export const Common = {
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  Clusters: {
    ClusterConnectionStatus: {
      CONNECTING: "connecting",
      CONNECTED: "connected",
      DISCONNECTED: "disconnected",
      DISCONNECTING: "disconnecting",
    },
  },
  Store: {
    ExtensionStore,
  },
};

// Minimal stand-in for the host's main extension base class: the lifecycle
// methods are called by the tests themselves.
class LensExtension {}

export const Main = {
  LensExtension,
  Catalog: {
    getAllClusters: vi.fn<() => unknown[]>(() => []),
    getClusterById: vi.fn<(id: string) => unknown>(() => undefined),
  },
  K8sApi: {
    KubeJsonApi: {
      forCluster: vi.fn<(clusterId: string) => unknown>(),
    },
  },
  Shell: {
    getEnvironment: vi.fn<(clusterId?: string, options?: unknown) => Promise<Record<string, string>>>(),
  },
  Util: {
    fetch: vi.fn<(url: string | URL, init?: unknown) => Promise<unknown>>(),
  },
};

// Plain DOM stand-ins for the host components the views render, with the props
// the views pass. The editor shows its value as text, so a test can find it.
interface ButtonProps {
  label?: string;
  className?: string;
  onClick?: () => void;
}

function Button({ label, className, onClick }: ButtonProps) {
  return React.createElement("button", { type: "button", className, onClick }, label);
}

function MonacoEditor({ value }: { value: string }) {
  return React.createElement("pre", { "data-testid": "monaco-editor" }, value);
}

export const Renderer = {
  Catalog: {
    getActiveCluster: vi.fn<() => { id: string } | undefined>(() => undefined),
  },
  Component: {
    Button,
    MonacoEditor,
    createTerminalTab: vi.fn(),
    terminalStore: {
      getTerminal: vi.fn(),
      sendCommand: vi.fn(),
    },
  },
};
