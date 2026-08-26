import log from "loglevel";
import * as React from "react";
import { redactSecrets } from "../redact";

const { useMemo } = React;

const isProd = import.meta.env.VITE_ENV == "production";

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

const useLog = (scope = "default") => {
  const _logger = useMemo(() => {
    const _logger = log.getLogger("base");
    _logger.setLevel(isProd ? LogLevel.WARN : LogLevel.DEBUG);
    return _logger;
  }, []);

  // Redact here rather than at each call site: the objects most often logged
  // (the agent input, the graph state) carry the user's API key, and a new log
  // line must not be able to reintroduce the leak.
  const logger: Logger = useMemo(
    () => ({
      debug: (msg: string, ...meta: any[]) => _logger.debug(`[${scope}] ${msg}`, ...redact(meta)),
      info: (msg: string, ...meta: any[]) => _logger.info(`[${scope}] ${msg}`, ...redact(meta)),
      warn: (msg: string, ...meta: any[]) => _logger.warn(`[${scope}] ${msg}`, ...redact(meta)),
      error: (msg: string, ...meta: any[]) => _logger.error(`[${scope}] ${msg}`, ...redact(meta)),
    }),
    [scope],
  );

  const setLogLevel = (level: LogLevel) => {
    _logger.setLevel(level);
  };

  return { log: logger, setLogLevel };
};

export default useLog;
