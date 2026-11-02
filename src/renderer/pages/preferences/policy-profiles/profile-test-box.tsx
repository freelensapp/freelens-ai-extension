import { Renderer } from "@freelensapp/extensions";
import {
  CLI_PROGRAM_NAMES,
  formatCanonicalForm,
  isCliProgram,
} from "../../../../common/invocation-policy/canonical-form";
import {
  evaluateInvocationPolicy,
  type InvocationPolicyResult,
} from "../../../../common/invocation-policy/invocation-policy";
import { POLICY_LEVEL_LABELS, type PolicyProfile } from "../../../../common/invocation-policy/policy-profile";
import { BUILT_IN_RESOURCE_CATALOG } from "../../../../common/invocation-policy/resource-catalog";
import { splitCommandLine } from "../../../../common/utils/split-command-line";
import styles from "./policy-profiles.module.scss";

const {
  Component: { Input },
} = Renderer;

/** The namespace of a namespaced target without `-n`; the test box has no cluster whose kubeconfig selects one. */
const TEST_NAMESPACE = "default";

/** What the test box shows for a command line: nothing, why it cannot be tested, or the policy's result. */
type TestOutcome = { kind: "empty" } | { kind: "problem"; problem: string } | InvocationPolicyResult;

/** Evaluates a command line as main evaluates the agent's invocation, with the built-in resource catalog. */
const testCommandLine = (commandLine: string, profile: PolicyProfile): TestOutcome => {
  const split = splitCommandLine(commandLine);
  if (split.kind === "error") return { kind: "problem", problem: split.error };
  const [program, ...args] = split.words;
  if (program === undefined) return { kind: "empty" };
  if (!isCliProgram(program)) {
    return { kind: "problem", problem: `Start the command line with ${CLI_PROGRAM_NAMES.join(" or ")}.` };
  }
  return evaluateInvocationPolicy({
    program,
    args,
    revealSecrets: false,
    profile,
    catalog: BUILT_IN_RESOURCE_CATALOG,
    defaultNamespace: TEST_NAMESPACE,
  });
};

const TestResult = ({ outcome }: { outcome: TestOutcome }) => {
  switch (outcome.kind) {
    case "empty":
      return null;
    case "problem":
      return <div>{outcome.problem}</div>;
    case "floor":
      return (
        <>
          <div className={styles.resultHeadline}>Rejected by the floor</div>
          <div>{outcome.reason}</div>
          <div className={styles.hint}>{outcome.entry.reason}</div>
        </>
      );
    case "policy":
      return (
        <>
          <div className={styles.resultHeadline}>
            <span>Policy level:</span> {POLICY_LEVEL_LABELS[outcome.level]}
          </div>
          <table className={styles.rulesTable}>
            <thead>
              <tr>
                <th>Canonical form</th>
                <th>Matching rule</th>
                <th>Policy level</th>
              </tr>
            </thead>
            <tbody>
              {outcome.targets.map((target) => {
                const form = formatCanonicalForm(target.form);
                return (
                  <tr key={form}>
                    <td>
                      <code>{form}</code>
                    </td>
                    <td>
                      {target.rule ? (
                        <code>{target.rule.pattern}</code>
                      ) : (
                        <span className={styles.muted}>None, fallback level</span>
                      )}
                    </td>
                    <td className={styles.levelCell}>{POLICY_LEVEL_LABELS[target.level]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      );
  }
};

interface ProfileTestBoxProps {
  profile: PolicyProfile;
  /** Kept by the profile list, so that it stays when another profile is chosen. */
  commandLine: string;
  onCommandLineChange: (commandLine: string) => void;
}

/**
 * A command line the user types, and how a policy profile treats it: its
 * canonical forms, the rule that matched each and the level, or the floor
 * entry that rejects it.
 */
export const ProfileTestBox = ({ profile, commandLine, onCommandLineChange }: ProfileTestBoxProps) => (
  <section aria-label="Test a command line" className={styles.testBox}>
    <div className={styles.fieldLabel}>Test a command line</div>
    <div className={styles.hint}>
      Type a CLI invocation as the agent would run it to see how this profile treats it. The test knows the resources
      built into Kubernetes, not the custom resources of a cluster, and reads a namespaced resource without{" "}
      <code>-n</code> as in the namespace <code>{TEST_NAMESPACE}</code>.
    </div>
    <Input
      aria-label="Command line"
      className={styles.patternInput}
      placeholder="kubectl delete pods web -n dev"
      value={commandLine}
      onChange={(next: string) => onCommandLineChange(next)}
    />
    <output className={styles.testResult}>
      <TestResult outcome={testCommandLine(commandLine, profile)} />
    </output>
  </section>
);
