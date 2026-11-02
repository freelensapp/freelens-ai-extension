// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesStore } from "../../../common/store";
import { ClusterProfileBadge } from "./cluster-profile-badge";

let consoleError: ReturnType<typeof vi.spyOn>;
let store: PreferencesStore;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  store = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  PreferencesStore.resetInstance();
});

describe("ClusterProfileBadge", () => {
  it("shows the default profile of a cluster without an assignment", () => {
    render(<ClusterProfileBadge clusterId="c1" />);

    expect(screen.getByText("Standard")).toBeDefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows the profile assigned to the cluster", () => {
    store.profileAssignments = { c1: "read-only", c2: "permissive" };

    render(<ClusterProfileBadge clusterId="c1" />);

    expect(screen.getByText("Read only")).toBeDefined();
  });

  it("follows a change of the assignment, of the default profile and of a user profile's name at once", () => {
    render(<ClusterProfileBadge clusterId="c1" />);

    act(() => {
      store.profileAssignments = { c1: "permissive" };
    });
    expect(screen.getByText("Permissive")).toBeDefined();

    act(() => {
      store.userProfiles = [{ id: "mine", name: "Night shift", rules: [], fallbackLevel: "deny" }];
      store.profileAssignments = {};
      store.defaultProfileId = "mine";
    });
    expect(screen.getByText("Night shift")).toBeDefined();

    act(() => {
      store.userProfiles = [{ id: "mine", name: "Weekend", rules: [], fallbackLevel: "deny" }];
    });
    expect(screen.getByText("Weekend")).toBeDefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("says in its tooltip what the profile decides and where to change it", () => {
    store.profileAssignments = { c1: "read-only" };

    render(<ClusterProfileBadge clusterId="c1" />);

    expect(screen.getByTitle(/^Policy profile of this cluster: Read only\./).textContent).toBe("Read only");
    expect(screen.getByTitle(/Freelens AI tab/)).toBeDefined();
  });
});
