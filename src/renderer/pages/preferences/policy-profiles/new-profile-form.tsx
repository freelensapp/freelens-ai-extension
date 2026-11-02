import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import { STANDARD_PROFILE } from "../../../../common/invocation-policy/shipped-profiles";
import { copyPolicyProfile } from "./policy-profile-edits";
import styles from "./policy-profiles.module.scss";

import type { SingleValue } from "react-select";

import type { PolicyProfile } from "../../../../common/invocation-policy/policy-profile";

const { useState } = React;

const {
  Component: { Button, Input, Select },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

/** The "Start from" choice of an empty profile; every other choice is the id of the profile to copy. */
const EMPTY_START = "";

/** What an empty profile starts as. */
const EMPTY_PROFILE: Omit<PolicyProfile, "id" | "name"> = { rules: [], fallbackLevel: "ask" };

interface NewProfileFormProps {
  /** The shipped and user profiles a new profile can copy. */
  profiles: readonly PolicyProfile[];
  onCreate: (profile: PolicyProfile) => void;
  onCancel: () => void;
}

/** Creates a user profile, empty or as a copy of a chosen profile, the copy of Standard preselected. */
export const NewProfileForm = ({ profiles, onCreate, onCancel }: NewProfileFormProps) => {
  const [name, setName] = useState("");
  const [startFrom, setStartFrom] = useState(STANDARD_PROFILE.id);

  const source = profiles.find((profile) => profile.id === startFrom);
  const suggestedName = source ? `Copy of ${source.name}` : "New profile";
  const startOptions: SelectOption<string>[] = [
    { value: EMPTY_START, label: "Empty, with fallback level Ask" },
    ...profiles.map((profile) => ({ value: profile.id, label: `Copy of ${profile.name}` })),
  ];

  const create = () => onCreate(copyPolicyProfile(source ?? EMPTY_PROFILE, name.trim() || suggestedName));

  return (
    <div className={styles.form}>
      <div className={styles.formTitle}>New profile</div>
      <div className={styles.formField}>
        <div className={styles.formLabel}>Name</div>
        <Input
          autoFocus
          aria-label="Name"
          placeholder={suggestedName}
          value={name}
          onChange={(next: string) => setName(next)}
          onSubmit={create}
        />
      </div>
      <div className={styles.formField}>
        <div className={styles.formLabel}>Start from</div>
        <Select
          aria-label="Start from"
          options={startOptions}
          value={startFrom}
          onChange={(option: SingleValue<SelectOption<string>>) => {
            if (option) setStartFrom(option.value);
          }}
          themeName="lens"
        />
      </div>
      <div className={styles.formActions}>
        <Button plain label="Cancel" onClick={onCancel} />
        <Button primary label="Create profile" onClick={create} />
      </div>
    </div>
  );
};
