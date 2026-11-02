// @vitest-environment jsdom

import { Common, Renderer } from "@freelensapp/extensions";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesStore } from "../../../common/store";
import { ClusterProfileTable } from "./cluster-profile-table";

let consoleError: ReturnType<typeof vi.spyOn>;
let store: PreferencesStore;

const cluster = (id: string, name: string): Common.Clusters.ClusterInfo => ({
  id,
  name,
  kubeConfigPath: "/kubeconfig",
  contextName: name,
  status: Common.Clusters.ClusterConnectionStatus.DISCONNECTED,
  labels: {},
  isActive: false,
});

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  store = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(Renderer.Catalog.getAllClusters).mockReset().mockReturnValue([]);
  PreferencesStore.resetInstance();
});

const pressedIn = (group: HTMLElement) =>
  within(group)
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);

describe("ClusterProfileTable", () => {
  it("lists every cluster Freelens knows by name, with its profile, without a key warning", () => {
    vi.mocked(Renderer.Catalog.getAllClusters).mockReturnValue([
      cluster("c2", "prod"),
      cluster("c1", "kind-kind"),
      cluster("c3", "staging"),
    ]);
    store.profileAssignments = { c2: "read-only", c3: "permissive", gone: "permissive" };

    render(<ClusterProfileTable />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
      "kind-kind",
      "prod",
      "staging",
    ]);
    expect(rows.map((row) => pressedIn(within(row).getByRole("group")))).toEqual([
      ["Default profile (Standard)"],
      ["Read only"],
      ["Permissive"],
    ]);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Cluster",
      "Policy profile",
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("assigns a profile to a cluster from its row", () => {
    vi.mocked(Renderer.Catalog.getAllClusters).mockReturnValue([cluster("c1", "kind-kind"), cluster("c2", "prod")]);

    render(<ClusterProfileTable />);
    const prod = screen.getByRole("group", { name: "Policy profile of prod" });
    fireEvent.click(within(prod).getByRole("button", { name: "Read only" }));

    expect(store.profileAssignments).toStrictEqual({ c2: "read-only" });
    expect(pressedIn(prod)).toEqual(["Read only"]);
  });

  it("says so when Freelens knows no cluster", () => {
    render(<ClusterProfileTable />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/No clusters yet/)).toBeDefined();
  });
});
