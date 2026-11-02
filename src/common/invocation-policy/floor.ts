/** The checks every CLI invocation must pass, whatever the policy profile says. */
export type FloorEntryId =
  | "cluster-or-identity"
  | "credentials-or-configuration"
  | "local-disk-or-code"
  | "never-ends-or-terminal"
  | "secret-output"
  | "manifest"
  | "unparseable"
  | "unknown-resource";

export interface FloorEntry {
  id: FloorEntryId;
  title: string;
  /** Why no profile can lift it. */
  reason: string;
  /** The flags, verbs and cases it rejects. */
  covers: readonly string[];
}

export const FLOOR_ENTRIES: Readonly<Record<FloorEntryId, FloorEntry>> = {
  "cluster-or-identity": {
    id: "cluster-or-identity",
    title: "Flags that change the cluster or the identity",
    reason: "An invocation stays on the chat's cluster, with the connection and the user Freelens has for it.",
    covers: [
      "--kubeconfig",
      "--context",
      "--cluster",
      "--server, -s",
      "--token",
      "--user",
      "--username",
      "--password",
      "--as",
      "--as-group",
      "--as-uid",
      "--as-user-extra",
      "--certificate-authority",
      "--client-certificate",
      "--client-key",
      "--insecure-skip-tls-verify",
      "--tls-server-name",
      "--cache-dir",
    ],
  },
  "credentials-or-configuration": {
    id: "credentials-or-configuration",
    title: "Credentials and configuration",
    reason:
      "Credentials never reach the model, and the configuration of kubectl stays as the user set it. Verbose logging prints request headers, the bearer token included, and response bodies, Secret values included.",
    covers: ["config", "kuberc", "create token", "certificate", "-v, --v at 6 or higher", "--vmodule"],
  },
  "local-disk-or-code": {
    id: "local-disk-or-code",
    title: "The user's disk and local code",
    reason: "A cluster chat never reads or writes files on the user's computer, nor runs programs there.",
    covers: [
      "-f, --filename (a manifest goes in the manifest parameter)",
      "-k, --kustomize",
      "cp",
      "--from-file, --from-env-file",
      "--patch-file",
      "--cert, --key of create secret tls",
      "--output-directory",
      "--profile, --profile-output, --kuberc",
      "output formats read from a file (go-template-file, templatefile, jsonpath-file, custom-columns-file)",
      "kustomize",
      "plugin",
      "verbs that are not kubectl verbs, which kubectl would run as plugins",
    ],
  },
  "never-ends-or-terminal": {
    id: "never-ends-or-terminal",
    title: "Invocations that never end or need a terminal",
    reason: "Every invocation ends on its own and nobody types into it.",
    covers: [
      "proxy",
      "port-forward",
      "attach",
      "edit, --edit",
      "-i, --stdin, --interactive",
      "-t, --tty",
      "-w, --watch, --watch-only",
      "-f, --follow of logs",
    ],
  },
  "secret-output": {
    id: "secret-output",
    title: "Output that prints Secret values around the redaction",
    reason:
      "Secret values reach the model only when the agent asks to reveal them and the profile allows it. Without revealSecrets, a get of Secrets takes no jsonpath, go-template, template or custom-columns output, and any other verb on Secrets prints at most their names.",
    covers: [
      "-o jsonpath, jsonpath-as-json, go-template, template, custom-columns and --template on a get of Secrets",
      "-o other than name, --template and --show-secrets on any other verb that targets Secrets",
    ],
  },
  manifest: {
    id: "manifest",
    title: "Manifests that do not parse or do not belong",
    reason: "The targets of a manifest must be known before it is sent.",
    covers: [
      "a manifest that does not parse",
      "an object without apiVersion or kind",
      "a manifest with a verb other than apply, create, replace, delete or diff",
    ],
  },
  unparseable: {
    id: "unparseable",
    title: "Arguments the parser cannot place",
    reason:
      "An invocation is checked as kubectl would run it, so an argument that cannot be placed is rejected, not guessed.",
    covers: ["unknown or unsupported flags", "a flag without its value", "arguments a verb does not take"],
  },
  "unknown-resource": {
    id: "unknown-resource",
    title: "Resources the cluster does not serve",
    reason: "A target's resource must be known to match the rules of the profile.",
    covers: ["a resource name, kind or category that the resource catalog does not have"],
  },
};

/** An invocation the floor rejects, with the entry that rejected it and why. */
export interface FloorRejection {
  kind: "floor";
  entry: FloorEntry;
  /** The entry's title and what in the invocation it rejected. */
  reason: string;
}

export const rejectByFloor = (id: FloorEntryId, detail: string): FloorRejection => ({
  kind: "floor",
  entry: FLOOR_ENTRIES[id],
  reason: `${FLOOR_ENTRIES[id].title}: ${detail}.`,
});
