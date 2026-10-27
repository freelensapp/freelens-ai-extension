import * as React from "react";
import { createLogger, LogLevel } from "../../../common/utils/logger";

const { useMemo } = React;

const isProd = import.meta.env.VITE_ENV == "production";

/** The level of the renderer's loggers, for `createLogger` outside a component. */
export const RENDERER_LOG_LEVEL = isProd ? LogLevel.WARN : LogLevel.DEBUG;

const useLog = (scope = "default") => {
  const logger = useMemo(() => createLogger(scope, RENDERER_LOG_LEVEL), [scope]);

  return { log: logger };
};

export default useLog;
