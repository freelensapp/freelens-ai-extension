import { Renderer } from "@freelensapp/extensions";
import * as React from "react";

const { useState } = React;

import { atomOneDark, atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";

const {
  Component: { createTerminalTab, terminalStore },
} = Renderer;

const { Theme } = Renderer;

type useCodeBlockHookProps = {
  children: React.ReactNode;
};

export const useCodeBlockHook = ({ children }: useCodeBlockHookProps) => {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const hasMultipleLines = text.split("\n").length > 1;
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

  const getTheme = () => {
    const themeInfo = Theme.activeTheme.get();
    return themeInfo.name.toLowerCase() === "dark" ? atomOneDark : atomOneLight;
  };

  return {
    copied,
    text,
    hasMultipleLines,
    handleCopy,
    executeCommand,
    isExecutable,
    getTheme,
  };
};
