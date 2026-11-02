import * as React from "react";

const { useCallback, useEffect, useRef, useState } = React;

export interface DraftFieldProps {
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Binds a controlled text field to a store value, committing only on blur.
 *
 * Writing to the persisted store on every keystroke is expensive and, because
 * the store value flows back into the controlled element, repositions the caret
 * to the end mid-typing. Instead the draft updates locally while editing and the
 * `commit` callback fires once when the field loses focus. A focus guard keeps
 * external store updates from clobbering an in-progress edit, and any pending
 * draft is flushed on unmount so the last edit is never lost.
 */
export function useStoreValueOnBlur(value: string, commit: (next: string) => void): DraftFieldProps {
  const [draft, setDraft] = useState<string>(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const valueRef = useRef(value);
  valueRef.current = value;
  const focusedRef = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Reflect external changes (store load/reset) only while not editing, so a
  // blur commit (which updates the store) never moves the caret.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  // Flush a pending draft on unmount in case the field never blurred.
  useEffect(
    () => () => {
      if (draftRef.current !== valueRef.current) commitRef.current(draftRef.current);
    },
    [],
  );

  const onChange = useCallback((next: string) => setDraft(next), []);
  const onFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);
  const onBlur = useCallback(() => {
    focusedRef.current = false;
    if (draftRef.current !== valueRef.current) commitRef.current(draftRef.current);
  }, []);

  return { value: draft, onChange, onFocus, onBlur };
}
