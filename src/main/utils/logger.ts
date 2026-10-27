import { createLogger, LogLevel } from "../../common/utils/logger";

const isProduction = process.env.NODE_ENV === "production";

// Named like the renderer's hook so modules read the same in both processes;
// in main it is a plain function.
const useLog = (scope = "default") => ({
  log: createLogger(scope, isProduction ? LogLevel.WARN : LogLevel.DEBUG),
});

export default useLog;
