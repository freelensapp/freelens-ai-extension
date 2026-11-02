/** The CLIs the agent runs. Helm joins kubectl with the helm tool. */
export type CliProgram = "kubectl";

/**
 * One target of a CLI invocation, `<program> <verb> <resource> <name> -n
 * <namespace>`, however the arguments were spelled.
 */
export interface CanonicalForm {
  program: CliProgram;
  /** The verb, of one or two words: `get`, `rollout restart`, `reveal`. */
  verb: string;
  /** The plural resource name; absent for a verb without a resource, such as `version`. */
  resource?: string;
  /** The object's name, or `*` for whatever a selector, `--all` or a missing name targets; absent without a resource. */
  name?: string;
  /** The namespace, or `*` for every namespace; absent for a cluster-scoped resource. */
  namespace?: string;
}

/** The form as text: `kubectl delete pods web -n dev`. */
export const formatCanonicalForm = (form: CanonicalForm): string =>
  [form.program, form.verb, form.resource, form.name, ...(form.namespace === undefined ? [] : ["-n", form.namespace])]
    .filter((part) => part !== undefined)
    .join(" ");
