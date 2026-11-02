import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import {
  POLICY_LEVEL_LABELS,
  type PolicyLevel,
  type PolicyProfile,
} from "../../../../common/invocation-policy/policy-profile";
import { POLICY_LEVEL_OPTIONS } from "./policy-level-options";
import styles from "./policy-profiles.module.scss";
import { ProfileRules } from "./profile-rules";

import type { SingleValue } from "react-select";

const { useState } = React;

const {
  Component: { Button, Input, Select },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

interface ProfileDetailsProps {
  profile: PolicyProfile;
  /** A shipped profile is shown read-only and can only be duplicated. */
  shipped: boolean;
  onChange: (profile: PolicyProfile) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** The name, fallback level and rules of one policy profile, editable for a user profile. */
export const ProfileDetails = ({ profile, shipped, onChange, onDuplicate, onDelete }: ProfileDetailsProps) => {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(profile.name);

  const startRenaming = () => {
    setName(profile.name);
    setRenaming(true);
  };
  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    onChange({ ...profile, name: trimmed });
    setRenaming(false);
  };

  return (
    <section aria-label={`${profile.name} profile`} className={styles.details}>
      <div className={styles.detailsHeader}>
        {renaming ? (
          <div className={styles.renameField}>
            <Input
              autoFocus
              aria-label="Profile name"
              value={name}
              onChange={(next: string) => setName(next)}
              onSubmit={saveName}
            />
            <Button primary label="Save" disabled={name.trim() === ""} onClick={saveName} />
            <Button plain label="Cancel" onClick={() => setRenaming(false)} />
          </div>
        ) : (
          <div className={styles.detailsTitle}>{profile.name}</div>
        )}
        {!renaming && (
          <div className={styles.actions}>
            <Button plain label="Duplicate" onClick={onDuplicate} />
            {!shipped && <Button plain label="Rename" onClick={startRenaming} />}
            {!shipped && <Button plain label="Delete" onClick={onDelete} />}
          </div>
        )}
      </div>
      {shipped && (
        <div className={styles.hint}>
          Shipped with Freelens AI, read-only: it cannot be changed. Duplicate it to make a variant.
        </div>
      )}

      <div className={styles.fallbackLevel}>
        <div className={styles.fieldLabel}>Fallback level</div>
        <div className={styles.hint}>The policy level of a CLI invocation that no rule matches.</div>
        {shipped ? (
          <div>{POLICY_LEVEL_LABELS[profile.fallbackLevel]}</div>
        ) : (
          <div className={styles.levelPicker}>
            <Select
              aria-label="Fallback level"
              options={POLICY_LEVEL_OPTIONS}
              value={profile.fallbackLevel}
              onChange={(option: SingleValue<SelectOption<PolicyLevel>>) => {
                if (option) onChange({ ...profile, fallbackLevel: option.value });
              }}
              themeName="lens"
            />
          </div>
        )}
      </div>

      <ProfileRules rules={profile.rules} editable={!shipped} onChange={(rules) => onChange({ ...profile, rules })} />
    </section>
  );
};
