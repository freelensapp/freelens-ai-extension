import { Renderer } from "@freelensapp/extensions";
import * as React from "react";

const { useState } = React;

const {
  Component: { createTerminalTab, terminalStore },
} = Renderer;

type useCodeBlockHookProps = {
  children: React.ReactNode;
};

// The Freelens host only registers the YAML and JSON tokenizers for Monaco; any
// other language is rendered as plain text in the editor.
const MONACO_LANGUAGES = ["yaml", "json"] as const;
type MonacoLanguage = (typeof MONACO_LANGUAGES)[number];

// Monaco is sized to the content but kept within a sensible window so short
// snippets stay compact and long ones scroll instead of taking over the chat.
const LINE_HEIGHT = 18;
const MIN_LINES = 5;
const MAX_LINES = 20;

export const useCodeBlockHook = ({ children }: useCodeBlockHookProps) => {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const lineCount = text.split("\n").length;
  const hasMultipleLines = lineCount > 1;
  const shellId = "FreeLensAI-tabid";

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isExecutable = (language?: string) => {
    return (
      language && ["bash", "sh", "shell", "zsh", "cmd", "powershell", "ps1", "pwsh", "dos", "fish"].includes(language)
    );
  };

  const executeCommand = () => {
    let terminal = terminalStore.getTerminal(shellId);
    if (terminal === undefined) {
      createTerminalTab({ title: "FreeLens AI", id: shellId });
    }

    // Multiline commands are executed in reverse order by the terminal.
    // I reverse them to ensure they are executed in the correct order.
    const parts = text.split("\n");
    parts.reverse();
    const reversedCommand = parts.join("\n");

    terminalStore.sendCommand(reversedCommand, {
      enter: true,
      tabId: shellId,
    });
  };

  const getMonacoLanguage = (language?: string): MonacoLanguage | undefined =>
    MONACO_LANGUAGES.includes(language as MonacoLanguage) ? (language as MonacoLanguage) : undefined;

  const getEditorMinHeight = () => `${Math.min(Math.max(lineCount, MIN_LINES), MAX_LINES) * LINE_HEIGHT}px`;

  return {
    copied,
    text,
    hasMultipleLines,
    handleCopy,
    executeCommand,
    isExecutable,
    getMonacoLanguage,
    getEditorMinHeight,
  };
};
