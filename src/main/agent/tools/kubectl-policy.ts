// What the model hears when the invocation policy blocks a kubectl call. The
// tool card shows the same text as the reason.

import { formatCanonicalForm } from "../../../common/invocation-policy/canonical-form";
import { POLICY_LEVEL_LABELS, type PolicyProfile } from "../../../common/invocation-policy/policy-profile";

import type { FloorRejection } from "../../../common/invocation-policy/floor";
import type { PolicyDecision } from "../../../common/invocation-policy/invocation-policy";

/** The floor entry that rejected the call, what it rejected and why no profile lifts it. */
export const floorBlockReason = (rejection: FloorRejection): string =>
  `Blocked by the floor, which no policy profile lifts. ${rejection.reason} ${rejection.entry.reason}`;

/** Each target the profile denies, with the rule or the fallback level that denied it. */
export const profileDenyReason = (profile: PolicyProfile, decision: PolicyDecision): string => {
  const denied = decision.targets
    .filter((target) => target.level === "deny")
    .map(
      (target) =>
        `${formatCanonicalForm(target.form)} gets ${POLICY_LEVEL_LABELS.deny} from ${
          target.rule ? `the rule "${target.rule.pattern}"` : "the profile's fallback level"
        }`,
    );
  return `Denied by the policy profile "${profile.name}": ${denied.join("; ")}.`;
};
