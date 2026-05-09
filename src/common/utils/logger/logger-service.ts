import log from "loglevel";
import { useMemo } from "react";

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

/**
 * Creates a logger instance without using React hooks.
 * Use this for classes, services, and non-React contexts.
 * Otherwise expect react 321
 * ref: https://react.dev/errors/321
 *
 * @param scope - The scope/context for the logger (e.g., "OllamaService")
 * @returns Object with logger and setLogLevel function
 */
export const createLogger = (scope = "default") => {
  const _logger = log.getLogger("base");
  _logger.setLevel(isProd ? LogLevel.WARN : LogLevel.DEBUG);

  const logger: Logger = {
    debug: (msg: string, ...meta: any[]) => _logger.debug(`[${scope}] ${msg}`, ...meta),
    info: (msg: string, ...meta: any[]) => _logger.info(`[${scope}] ${msg}`, ...meta),
    warn: (msg: string, ...meta: any[]) => _logger.warn(`[${scope}] ${msg}`, ...meta),
    error: (msg: string, ...meta: any[]) => _logger.error(`[${scope}] ${msg}`, ...meta),
  };

  const setLogLevel = (level: LogLevel) => {
    _logger.setLevel(level);
  };

  return { log: logger, setLogLevel };
};

const useLog = (scope = "default") => {
  const _logger = useMemo(() => {
    const _logger = log.getLogger("base");
    _logger.setLevel(isProd ? LogLevel.WARN : LogLevel.DEBUG);
    return _logger;
  }, []);

  const logger: Logger = useMemo(
    () => ({
      debug: (msg: string, ...meta: any[]) => _logger.debug(`[${scope}] ${msg}`, ...meta),
      info: (msg: string, ...meta: any[]) => _logger.info(`[${scope}] ${msg}`, ...meta),
      warn: (msg: string, ...meta: any[]) => _logger.warn(`[${scope}] ${msg}`, ...meta),
      error: (msg: string, ...meta: any[]) => _logger.error(`[${scope}] ${msg}`, ...meta),
    }),
    [scope],
  );

  const setLogLevel = (level: LogLevel) => {
    _logger.setLevel(level);
  };

  return { log: logger, setLogLevel };
};

export default useLog;
