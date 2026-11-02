import { Renderer } from "@freelensapp/extensions";
import {
  POLICY_LEVEL_LABELS,
  POLICY_LEVELS,
  type PolicyLevel,
} from "../../../../common/invocation-policy/policy-profile";

/** The policy levels as options of the host's `Select`, from the least to the most restrictive. */
export const POLICY_LEVEL_OPTIONS: Renderer.Component.SelectOption<PolicyLevel>[] = POLICY_LEVELS.map((level) => ({
  value: level,
  label: POLICY_LEVEL_LABELS[level],
}));
