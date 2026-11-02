import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import {
  POLICY_LEVEL_LABELS,
  type PolicyLevel,
  type PolicyRule,
} from "../../../../common/invocation-policy/policy-profile";
import { useStoreValueOnBlur } from "../use-store-value-on-blur";
import { POLICY_LEVEL_OPTIONS } from "./policy-level-options";
import styles from "./policy-profiles.module.scss";

import type { SingleValue } from "react-select";

const { useState } = React;

const {
  Component: { Button, Icon, Input, Select },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

const PATTERN_EXAMPLE = "kubectl delete pods * -n dev";

interface EditableRuleProps {
  rule: PolicyRule;
  onChange: (rule: PolicyRule) => void;
  onRemove: () => void;
}

/** One rule of a user profile; its pattern is saved when the field loses focus. */
const EditableRule = ({ rule, onChange, onRemove }: EditableRuleProps) => {
  const patternField = useStoreValueOnBlur(rule.pattern, (pattern) => onChange({ ...rule, pattern: pattern.trim() }));
  return (
    <tr>
      <td>
        <Input
          aria-label="Command pattern"
          className={styles.patternInput}
          value={patternField.value}
          onChange={patternField.onChange}
          onFocus={patternField.onFocus}
          onBlur={patternField.onBlur}
        />
      </td>
      <td className={styles.levelCell}>
        <Select
          aria-label="Policy level"
          options={POLICY_LEVEL_OPTIONS}
          value={rule.level}
          onChange={(option: SingleValue<SelectOption<PolicyLevel>>) => {
            if (option) onChange({ ...rule, level: option.value });
          }}
          themeName="lens"
        />
      </td>
      <td className={styles.removeCell}>
        <Icon material="delete" small interactive tooltip="Remove rule" onClick={onRemove} />
      </td>
    </tr>
  );
};

/** The row that adds a rule to a user profile, once its pattern is filled in. */
const NewRule = ({ onAdd }: { onAdd: (rule: PolicyRule) => void }) => {
  const [pattern, setPattern] = useState("");
  const [level, setLevel] = useState<PolicyLevel>("ask");
  const add = () => {
    if (pattern.trim() === "") return;
    onAdd({ pattern: pattern.trim(), level });
    setPattern("");
  };
  return (
    <tr>
      <td>
        <Input
          aria-label="New rule's command pattern"
          className={styles.patternInput}
          placeholder={PATTERN_EXAMPLE}
          value={pattern}
          onChange={(next: string) => setPattern(next)}
          onSubmit={add}
        />
      </td>
      <td className={styles.levelCell}>
        <Select
          aria-label="New rule's policy level"
          options={POLICY_LEVEL_OPTIONS}
          value={level}
          onChange={(option: SingleValue<SelectOption<PolicyLevel>>) => {
            if (option) setLevel(option.value);
          }}
          themeName="lens"
        />
      </td>
      <td className={styles.removeCell}>
        <Button plain label="Add rule" disabled={pattern.trim() === ""} onClick={add} />
      </td>
    </tr>
  );
};

interface ProfileRulesProps {
  rules: readonly PolicyRule[];
  /** False for a shipped profile, whose rules are shown as text. */
  editable: boolean;
  onChange: (rules: PolicyRule[]) => void;
}

/** The rules of a policy profile as rows of command pattern and policy level. */
export const ProfileRules = ({ rules, editable, onChange }: ProfileRulesProps) => (
  <div>
    <div className={styles.fieldLabel}>Rules</div>
    <div className={styles.hint}>
      A command pattern has the shape of{" "}
      <code>kubectl &lt;verb&gt; &lt;resource&gt; &lt;name&gt; -n &lt;namespace&gt;</code>, or of{" "}
      <code>helm &lt;verb&gt; releases &lt;release&gt; -n &lt;namespace&gt;</code> for helm. Each part is a word, a glob
      such as <code>web-*</code> or <code>*</code>, and the parts left off at the end match anything; without{" "}
      <code>-n</code> a rule matches every namespace.
    </div>
    {editable && rules.length === 0 && (
      <div className={styles.hint}>No rules yet: every CLI invocation gets the fallback level.</div>
    )}
    <table className={styles.rulesTable}>
      <thead>
        <tr>
          <th>Command pattern</th>
          <th>Policy level</th>
          {editable && <th aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {editable
          ? rules.map((rule, index) => (
              <EditableRule
                // A rule has no id and two rules may share a pattern, so a row is keyed by its place.
                key={index}
                rule={rule}
                onChange={(next) => onChange(rules.map((saved, at) => (at === index ? next : saved)))}
                onRemove={() => onChange(rules.filter((_, at) => at !== index))}
              />
            ))
          : rules.map((rule) => (
              <tr key={rule.pattern}>
                <td>
                  <code>{rule.pattern}</code>
                </td>
                <td className={styles.levelCell}>{POLICY_LEVEL_LABELS[rule.level]}</td>
              </tr>
            ))}
        {editable && <NewRule onAdd={(rule) => onChange([...rules, rule])} />}
      </tbody>
    </table>
  </div>
);
