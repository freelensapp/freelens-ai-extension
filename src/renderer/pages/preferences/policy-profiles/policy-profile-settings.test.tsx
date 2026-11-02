// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STANDARD_PROFILE } from "../../../../common/invocation-policy/shipped-profiles";
import { PreferencesStore } from "../../../../common/store";
import { PolicyProfileSettings } from "./policy-profile-settings";

import type { PolicyProfile } from "../../../../common/invocation-policy/policy-profile";

let consoleError: ReturnType<typeof vi.spyOn>;
let store: PreferencesStore;

const NIGHTLY: PolicyProfile = {
  id: "nightly",
  name: "Nightly",
  rules: [
    { pattern: "kubectl delete pods * -n dev", level: "allow" },
    { pattern: "kubectl exec *", level: "deny" },
  ],
  fallbackLevel: "ask",
};

beforeEach(() => {
  // React reports a list child without a key or a prop the DOM does not take on the console.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  store = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  store.userProfiles = [NIGHTLY];
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  cleanup();
  vi.restoreAllMocks();
  PreferencesStore.resetInstance();
});

const profileList = () => within(screen.getByRole("list", { name: "Policy profiles" }));

const openProfile = (name: string) =>
  fireEvent.click(profileList().getByRole("button", { name: new RegExp(`^${name}`) }));

const details = () => within(screen.getByRole("region", { name: /profile$/ }));

describe("PolicyProfileSettings", () => {
  it("lists the shipped profiles, marked read-only, and then the user profiles", () => {
    render(<PolicyProfileSettings />);

    expect(
      profileList()
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Read onlyShipped", "StandardShippedDefault", "PermissiveShipped", "Nightly"]);
  });

  it("shows a shipped profile's rules and fallback level as text, with nothing to edit", () => {
    render(<PolicyProfileSettings />);

    openProfile("Read only");

    expect(details().getByText(/cannot be changed/)).toBeDefined();
    expect(details().getByText("kubectl get *")).toBeDefined();
    expect(details().getByText("Fallback level").parentElement?.textContent).toContain("Deny");
    expect(details().queryByRole("textbox")).toBeNull();
    expect(details().queryByRole("button", { name: "Rename" })).toBeNull();
    expect(details().queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("selects the default profile when it opens", () => {
    store.defaultProfileId = NIGHTLY.id;
    render(<PolicyProfileSettings />);

    expect(profileList().getByRole("button", { current: true }).textContent).toBe("NightlyDefault");
    expect(screen.getByRole("region", { name: "Nightly profile" })).toBeDefined();
  });
});

describe("New profile", () => {
  const startFrom = () => within(screen.getByRole("group", { name: "Start from" }));

  it("preselects the copy of Standard and creates it as a user profile with Standard's rules and fallback level", () => {
    const saved = store.userProfiles;
    render(<PolicyProfileSettings />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    expect(startFrom().getByRole("button", { pressed: true }).textContent).toBe("Copy of Standard");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Staging" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    expect(store.userProfiles).toHaveLength(2);
    const created = store.userProfiles[1]!;
    expect(created).toEqual({
      id: expect.any(String),
      name: "Staging",
      rules: STANDARD_PROFILE.rules,
      fallbackLevel: "ask",
    });
    expect([NIGHTLY.id, ...["read-only", "standard", "permissive", "standard-migrated"]]).not.toContain(created.id);
    expect(saved).toEqual([NIGHTLY]);
    expect(screen.getByRole("region", { name: "Staging profile" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Create profile" })).toBeNull();
  });

  it("creates an empty profile with fallback level Ask, named after its start when no name is given", () => {
    render(<PolicyProfileSettings />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.click(startFrom().getByRole("button", { name: "Empty, with fallback level Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    expect(store.userProfiles[1]).toEqual({
      id: expect.any(String),
      name: "New profile",
      rules: [],
      fallbackLevel: "ask",
    });
  });

  it("copies a chosen user profile", () => {
    render(<PolicyProfileSettings />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.click(startFrom().getByRole("button", { name: "Copy of Nightly" }));
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    expect(store.userProfiles[1]).toEqual({ ...NIGHTLY, id: expect.any(String), name: "Copy of Nightly" });
  });

  it("creates nothing when cancelled", () => {
    render(<PolicyProfileSettings />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(store.userProfiles).toEqual([NIGHTLY]);
    expect(screen.queryByRole("button", { name: "Create profile" })).toBeNull();
  });
});

describe("Duplicate, Rename and Delete", () => {
  it("duplicates a shipped profile into a user profile and opens it", () => {
    render(<PolicyProfileSettings />);

    openProfile("Permissive");
    fireEvent.click(details().getByRole("button", { name: "Duplicate" }));

    const copy = store.userProfiles[1]!;
    expect(copy.name).toBe("Copy of Permissive");
    expect(copy.id).not.toBe("permissive");
    expect(screen.getByRole("region", { name: "Copy of Permissive profile" })).toBeDefined();
    expect(details().getByRole("button", { name: "Rename" })).toBeDefined();
  });

  it("duplicates a user profile with its rules and fallback level", () => {
    render(<PolicyProfileSettings />);

    openProfile("Nightly");
    fireEvent.click(details().getByRole("button", { name: "Duplicate" }));

    expect(store.userProfiles[1]).toEqual({ ...NIGHTLY, id: expect.any(String), name: "Copy of Nightly" });
  });

  it("renames a user profile", () => {
    const saved = store.userProfiles;
    render(<PolicyProfileSettings />);

    openProfile("Nightly");
    fireEvent.click(details().getByRole("button", { name: "Rename" }));
    fireEvent.change(details().getByRole("textbox", { name: "Profile name" }), { target: { value: " Dev " } });
    fireEvent.click(details().getByRole("button", { name: "Save" }));

    expect(store.userProfiles).toEqual([{ ...NIGHTLY, name: "Dev" }]);
    expect(saved).toEqual([NIGHTLY]);
    expect(profileList().getByRole("button", { current: true }).textContent).toBe("Dev");
  });

  it("does not save an empty name", () => {
    render(<PolicyProfileSettings />);

    openProfile("Nightly");
    fireEvent.click(details().getByRole("button", { name: "Rename" }));
    fireEvent.change(details().getByRole("textbox", { name: "Profile name" }), { target: { value: " " } });

    expect((details().getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(details().getByRole("button", { name: "Cancel" }));
    expect(store.userProfiles).toEqual([NIGHTLY]);
  });

  it("deletes a user profile after asking, and its clusters lose their assignment for the default profile", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    store.profileAssignments = { "cluster-a": NIGHTLY.id, "cluster-b": "permissive" };
    render(<PolicyProfileSettings />);

    openProfile("Nightly");
    fireEvent.click(details().getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledWith(
      'Delete the policy profile "Nightly"? Every cluster that uses it gets the default profile.',
    );
    expect(store.userProfiles).toEqual([]);
    expect(store.profileAssignments).toEqual({ "cluster-b": "permissive" });
    expect(store.defaultProfileId).toBe("standard");
    expect(screen.getByRole("region", { name: "Standard profile" })).toBeDefined();
  });

  it("makes Standard the default profile when the default profile is deleted", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    store.defaultProfileId = NIGHTLY.id;
    render(<PolicyProfileSettings />);

    fireEvent.click(details().getByRole("button", { name: "Delete" }));

    expect(store.defaultProfileId).toBe("standard");
    expect(profileList().getByRole("button", { name: /^Standard/ }).textContent).toBe("StandardShippedDefault");
  });

  it("keeps the profile when the deletion is not confirmed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PolicyProfileSettings />);

    openProfile("Nightly");
    fireEvent.click(details().getByRole("button", { name: "Delete" }));

    expect(store.userProfiles).toEqual([NIGHTLY]);
  });
});

describe("Rules and fallback level of a user profile", () => {
  const ruleRows = () => details().getAllByRole("row").slice(1, -1);

  it("shows the rules as rows of command pattern and policy level", () => {
    render(<PolicyProfileSettings />);

    openProfile("Nightly");

    expect(
      ruleRows().map((row) => [
        (within(row).getByRole("textbox", { name: "Command pattern" }) as HTMLInputElement).value,
        within(within(row).getByRole("group", { name: "Policy level" })).getByRole("button", { pressed: true })
          .textContent,
      ]),
    ).toEqual([
      ["kubectl delete pods * -n dev", "Allow"],
      ["kubectl exec *", "Deny"],
    ]);
  });

  it("saves an edited pattern when the field loses focus", () => {
    const saved = store.userProfiles;
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    const pattern = within(ruleRows()[0]!).getByRole("textbox", { name: "Command pattern" });
    fireEvent.focus(pattern);
    fireEvent.change(pattern, { target: { value: "kubectl delete pods web-* -n dev " } });
    expect(store.userProfiles[0]!.rules[0]!.pattern).toBe("kubectl delete pods * -n dev");
    fireEvent.blur(pattern);

    expect(store.userProfiles[0]!.rules).toEqual([
      { pattern: "kubectl delete pods web-* -n dev", level: "allow" },
      { pattern: "kubectl exec *", level: "deny" },
    ]);
    expect(saved).toEqual([NIGHTLY]);
  });

  it("changes the level of a rule", () => {
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    fireEvent.click(
      within(within(ruleRows()[1]!).getByRole("group", { name: "Policy level" })).getByRole("button", {
        name: "Always ask",
      }),
    );

    expect(store.userProfiles[0]!.rules[1]).toEqual({ pattern: "kubectl exec *", level: "alwaysAsk" });
  });

  it("removes a rule", () => {
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    fireEvent.click(within(ruleRows()[0]!).getByRole("button", { name: "Remove rule" }));

    expect(store.userProfiles[0]!.rules).toEqual([{ pattern: "kubectl exec *", level: "deny" }]);
    expect(ruleRows()).toHaveLength(1);
  });

  it("adds a rule with its pattern and level", () => {
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    const add = details().getByRole("button", { name: "Add rule" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(details().getByRole("textbox", { name: "New rule's command pattern" }), {
      target: { value: " kubectl scale * -n dev " },
    });
    fireEvent.click(
      within(details().getByRole("group", { name: "New rule's policy level" })).getByRole("button", { name: "Allow" }),
    );
    fireEvent.click(add);

    expect(store.userProfiles[0]!.rules).toEqual([
      ...NIGHTLY.rules,
      { pattern: "kubectl scale * -n dev", level: "allow" },
    ]);
    expect((details().getByRole("textbox", { name: "New rule's command pattern" }) as HTMLInputElement).value).toBe("");
  });

  it("tells an empty profile that every invocation gets the fallback level", () => {
    store.userProfiles = [{ ...NIGHTLY, rules: [] }];
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    expect(details().getByText(/No rules yet/)).toBeDefined();
    expect(ruleRows()).toHaveLength(0);
  });

  it("changes the fallback level", () => {
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    fireEvent.click(
      within(details().getByRole("group", { name: "Fallback level" })).getByRole("button", { name: "Deny" }),
    );

    expect(store.userProfiles).toEqual([{ ...NIGHTLY, fallbackLevel: "deny" }]);
  });
});

describe("Default profile", () => {
  it("sets the default profile from the picker", () => {
    render(<PolicyProfileSettings />);
    const picker = within(screen.getByRole("group", { name: "Default profile" }));
    expect(picker.getByRole("button", { pressed: true }).textContent).toBe("Standard");

    fireEvent.click(picker.getByRole("button", { name: "Nightly" }));

    expect(store.defaultProfileId).toBe(NIGHTLY.id);
    expect(profileList().getByRole("button", { name: /^Nightly/ }).textContent).toBe("NightlyDefault");
  });

  it("ignores a cleared picker", () => {
    render(<PolicyProfileSettings />);

    fireEvent.click(
      within(screen.getByRole("group", { name: "Default profile" })).getByRole("button", { name: "Clear" }),
    );

    expect(store.defaultProfileId).toBe("standard");
  });
});
