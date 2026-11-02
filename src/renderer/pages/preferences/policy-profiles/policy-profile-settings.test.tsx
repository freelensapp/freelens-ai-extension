// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOOR_ENTRIES } from "../../../../common/invocation-policy/floor";
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
    // Only the test box takes input.
    expect(
      details()
        .getAllByRole("textbox")
        .map((field) => field.getAttribute("aria-label")),
    ).toEqual(["Command line"]);
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

describe("Test box", () => {
  const testBox = () => within(details().getByRole("region", { name: "Test a command line" }));

  const typeCommandLine = (line: string) =>
    fireEvent.change(testBox().getByRole("textbox", { name: "Command line" }), { target: { value: line } });

  const result = () => within(testBox().getByRole("status"));

  const targetRows = () =>
    result()
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      );

  it("shows the canonical form, the rule that matched it and the level Allow", () => {
    render(<PolicyProfileSettings />);

    typeCommandLine("kubectl get pods -n web");

    expect(result().getByText("Policy level:").parentElement?.textContent).toBe("Policy level: Allow");
    expect(targetRows()).toEqual([["kubectl get pods * -n web", "kubectl get *", "Allow"]]);
  });

  it("shows the Ask of a specific rule over the Allow of a broad one", () => {
    store.userProfiles = [
      {
        id: "production",
        name: "Production",
        rules: [
          { pattern: "kubectl delete *", level: "allow" },
          { pattern: "kubectl delete pods * -n prod", level: "ask" },
        ],
        fallbackLevel: "deny",
      },
    ];
    render(<PolicyProfileSettings />);
    openProfile("Production");

    typeCommandLine("kubectl delete pod web -n prod");

    expect(result().getByText("Policy level:").parentElement?.textContent).toBe("Policy level: Ask");
    expect(targetRows()).toEqual([["kubectl delete pods web -n prod", "kubectl delete pods * -n prod", "Ask"]]);
  });

  it("shows the fallback level for a form that no rule matches", () => {
    render(<PolicyProfileSettings />);

    typeCommandLine("kubectl scale deployment api --replicas=2");

    expect(result().getByText("Policy level:").parentElement?.textContent).toBe("Policy level: Ask");
    expect(targetRows()).toEqual([["kubectl scale deployments api -n default", "None, fallback level", "Ask"]]);
  });

  it("shows each target of a multi-target invocation with its rule, and the most restrictive level", () => {
    render(<PolicyProfileSettings />);
    openProfile("Nightly");

    typeCommandLine("kubectl delete pod/web deployment/api -n dev");

    expect(result().getByText("Policy level:").parentElement?.textContent).toBe("Policy level: Ask");
    expect(targetRows()).toEqual([
      ["kubectl delete pods web -n dev", "kubectl delete pods * -n dev", "Allow"],
      ["kubectl delete deployments api -n dev", "None, fallback level", "Ask"],
    ]);
  });

  it("shows the floor entry that rejects an invocation, what it rejected and why no profile lifts it", () => {
    render(<PolicyProfileSettings />);
    openProfile("Permissive");

    typeCommandLine("kubectl get pods --kubeconfig /tmp/other");

    expect(result().getByText("Rejected by the floor")).toBeDefined();
    expect(
      result().getByText("Flags that change the cluster or the identity: --kubeconfig is never allowed."),
    ).toBeDefined();
    expect(
      result().getByText(
        "An invocation stays on the chat's cluster, with the connection and the user Freelens has for it.",
      ),
    ).toBeDefined();
    expect(result().queryByText("Policy level:")).toBeNull();
    expect(result().queryByRole("table")).toBeNull();
  });

  it("splits the command line as a shell would, quotes included", () => {
    render(<PolicyProfileSettings />);

    typeCommandLine("kubectl get pods -l 'app in (web, api)' -n web");

    expect(targetRows()).toEqual([["kubectl get pods * -n web", "kubectl get *", "Allow"]]);
  });

  it("says why a command line cannot be tested", () => {
    render(<PolicyProfileSettings />);

    typeCommandLine("kubectl get pods -l 'app=web");
    expect(result().getByText("The single quote is not closed.")).toBeDefined();

    typeCommandLine("oc get pods");
    expect(result().getByText("Start the command line with kubectl.")).toBeDefined();
  });

  it("keeps the command line when another profile is chosen, and shows how that profile treats it", () => {
    render(<PolicyProfileSettings />);
    typeCommandLine("kubectl scale deployment api --replicas=2");

    openProfile("Read only");

    expect((testBox().getByRole("textbox", { name: "Command line" }) as HTMLInputElement).value).toBe(
      "kubectl scale deployment api --replicas=2",
    );
    expect(targetRows()).toEqual([["kubectl scale deployments api -n default", "None, fallback level", "Deny"]]);
  });

  it("shows nothing for an empty command line", () => {
    render(<PolicyProfileSettings />);

    typeCommandLine("   ");

    expect(testBox().getByRole("status").textContent).toBe("");
  });
});

describe("Floor", () => {
  const floor = () => within(screen.getByRole("region", { name: "Floor" }));

  it("lists every entry of the policy's floor, read-only", () => {
    render(<PolicyProfileSettings />);

    const entries = floor().getByRole("list", { name: "Floor entries" });
    expect([...entries.children].map((item) => item.firstElementChild?.textContent)).toEqual(
      Object.values(FLOOR_ENTRIES).map((entry) => entry.title),
    );
    expect(floor().queryByRole("textbox")).toBeNull();
    expect(floor().queryByRole("button")).toBeNull();
  });

  it("shows the reason of each entry and what it rejects", () => {
    render(<PolicyProfileSettings />);

    const entry = within(floor().getByText("Flags that change the cluster or the identity").parentElement!);
    expect(
      entry.getByText(
        "An invocation stays on the chat's cluster, with the connection and the user Freelens has for it.",
      ),
    ).toBeDefined();
    expect(entry.getByText("--kubeconfig")).toBeDefined();
    expect(entry.getByText("--server, -s")).toBeDefined();
  });
});
