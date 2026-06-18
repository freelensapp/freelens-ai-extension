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
  // Open while the model is still reasoning, then auto-fold once the answer
  // text starts arriving. The user can re-open it afterwards; `autoFoldedRef`
  // ensures we only force-fold once so manual re-opening is not undone.
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const autoFoldedRef = useRef(false);

  useEffect(() => {
    _setVisibleText(message.text);
  }, []);

  useEffect(() => {
    if (!autoFoldedRef.current && message.text.length > 0) {
      autoFoldedRef.current = true;
      setReasoningOpen(false);
    }
  }, [message.text]);

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
