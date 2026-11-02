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

/** Each program once; the type check fails here until a program added to `CliProgram` is listed. */
const KNOWN_CLI_PROGRAMS = { kubectl: true } satisfies Record<CliProgram, true>;

/** The names of the CLIs the agent runs, for messages: `kubectl`. */
export const CLI_PROGRAM_NAMES: readonly string[] = Object.keys(KNOWN_CLI_PROGRAMS);

/** Whether a word, such as the first of a typed command line, names a CLI the agent runs. */
export const isCliProgram = (word: string): word is CliProgram => Object.hasOwn(KNOWN_CLI_PROGRAMS, word);
