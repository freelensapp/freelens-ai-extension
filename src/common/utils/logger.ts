import log from "loglevel";
import { redactSecrets } from "./redact";

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface Logger {
  debug: (message: string, ...meta: any[]) => void;
  info: (message: string, ...meta: any[]) => void;
  warn: (message: string, ...meta: any[]) => void;
  error: (message: string, ...meta: any[]) => void;
}

const redact = (meta: any[]) => meta.map((entry) => redactSecrets(entry));

/**
 * A logger whose lines are prefixed with `scope`. Both processes log through
 * it: the renderer to DevTools, main to the terminal Freelens runs in.
 */
export const createLogger = (scope: string, level: LogLevel): Logger => {
  const base = log.getLogger("base");
  base.setLevel(level);

  // Redact here rather than at each call site: the objects most often logged
  // (the agent input, the graph state) carry the user's API key, and a new log
  // line must not be able to reintroduce the leak.
  return {
    debug: (msg: string, ...meta: any[]) => base.debug(`[${scope}] ${msg}`, ...redact(meta)),
    info: (msg: string, ...meta: any[]) => base.info(`[${scope}] ${msg}`, ...redact(meta)),
    warn: (msg: string, ...meta: any[]) => base.warn(`[${scope}] ${msg}`, ...redact(meta)),
    error: (msg: string, ...meta: any[]) => base.error(`[${scope}] ${msg}`, ...redact(meta)),
  };
};
