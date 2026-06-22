import * as React from "react";

import type { MessageObject } from "../../business/objects/message-object";

const { useEffect, useRef, useState } = React;

export interface MessageHookProps {
  message: MessageObject;
}

const useMessageHook = ({ message }: MessageHookProps) => {
  const sentMessageClassName = message.sent ? "message-bubble sent" : "message-bubble";
  const [visibleText, _setVisibleText] = useState("");
  const lastTextRef = useRef(message.text);
  const rafRef = useRef<number | null>(null);

  const reasoning = message.reasoning ?? "";
  // While the answer is still empty the reasoning is the only thing to read, so
  // it is shown unfolded as a live "thinking" view. Once the answer text starts
  // to arrive the reasoning folds itself away. Both transitions happen at most
  // once: after it has auto-folded it is never auto-unfolded again, so a later
  // reasoning-only delta (another block before its answer) leaves it folded and
  // the user stays in control of the `Reasoning` disclosure.
  const hasAnswerText = message.text.trim().length > 0;
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const autoFoldedRef = useRef(false);

  useEffect(() => {
    _setVisibleText(message.text);
  }, []);

  useEffect(() => {
    // Once the answer has appeared and the reasoning has folded, leave it alone.
    if (autoFoldedRef.current) return;

    if (hasAnswerText) {
      autoFoldedRef.current = true;
      setReasoningOpen(false);
      return;
    }

    if (reasoning.length > 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setReasoningOpen(true);
    }
  }, [reasoning, hasAnswerText]);

  useEffect(() => {
    if (lastTextRef.current === message.text) return;
    lastTextRef.current = message.text;

    const updateText = () => {
      _setVisibleText((prev) => {
        const current = lastTextRef.current;
        if (prev === current) return prev;
        return current.slice(0, prev.length + 3);
      });

      rafRef.current = requestAnimationFrame(updateText);
    };

    rafRef.current = requestAnimationFrame(updateText);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current!);
    };
  }, [message.text]);

  return { sentMessageClassName, visibleText, reasoning, reasoningOpen, setReasoningOpen };
};

export default useMessageHook;
