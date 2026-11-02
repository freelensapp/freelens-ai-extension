// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesStore } from "../../../common/store";
import { ClusterProfilePicker } from "./cluster-profile-picker";

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

const options = () =>
  within(screen.getByRole("group", { name: "Policy profile of kind-kind" }))
    .getAllByRole("button")
    .filter((button) => button.textContent !== "Clear");

const pressed = () =>
  options()
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);

describe("ClusterProfilePicker", () => {
  it("offers the default profile, the shipped profiles and the user profiles, without a key warning", () => {
    store.userProfiles = [{ id: "mine", name: "Night shift", rules: [], fallbackLevel: "deny" }];

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);

    expect(options().map((button) => button.textContent)).toEqual([
      "Default profile (Standard)",
      "Read only",
      "Standard",
      "Permissive",
      "Night shift",
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("selects the default profile for a cluster without an assignment, named after the current default", () => {
    store.defaultProfileId = "permissive";

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);

    expect(pressed()).toEqual(["Default profile (Permissive)"]);
  });

  it("selects the profile assigned to the cluster, and follows a change of it", () => {
    store.profileAssignments = { c1: "read-only" };

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);
    expect(pressed()).toEqual(["Read only"]);

    act(() => {
      store.profileAssignments = { c1: "permissive" };
    });
    expect(pressed()).toEqual(["Permissive"]);
  });

  it("selects the default profile for a cluster assigned to a profile that no longer exists", () => {
    store.profileAssignments = { c1: "deleted" };

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);

    expect(pressed()).toEqual(["Default profile (Standard)"]);
  });

  it("assigns the profile picked to the cluster, replacing the assignments as a whole", () => {
    const before = { c2: "permissive" };
    store.profileAssignments = before;

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);
    fireEvent.click(screen.getByRole("button", { name: "Read only" }));

    expect(store.profileAssignments).toStrictEqual({ c2: "permissive", c1: "read-only" });
    expect(before).toStrictEqual({ c2: "permissive" });
    expect(pressed()).toEqual(["Read only"]);
  });

  it("removes the cluster's assignment when the default profile is picked, so it follows the default", () => {
    const before = { c1: "read-only", c2: "permissive" };
    store.profileAssignments = before;

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);
    fireEvent.click(screen.getByRole("button", { name: "Default profile (Standard)" }));

    expect(store.profileAssignments).toStrictEqual({ c2: "permissive" });
    expect(before).toStrictEqual({ c1: "read-only", c2: "permissive" });
  });

  it("keeps the assignment when the selection is cleared", () => {
    store.profileAssignments = { c1: "read-only" };

    render(<ClusterProfilePicker clusterId="c1" clusterName="kind-kind" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(store.profileAssignments).toStrictEqual({ c1: "read-only" });
  });
});
