import * as React from "react";
import { createLogger, LogLevel } from "../../../common/utils/logger";

const { useMemo } = React;

const isProd = import.meta.env.VITE_ENV == "production";

const useLog = (scope = "default") => {
  const logger = useMemo(() => createLogger(scope, isProd ? LogLevel.WARN : LogLevel.DEBUG), [scope]);

  return { log: logger };
};

export default useLog;
