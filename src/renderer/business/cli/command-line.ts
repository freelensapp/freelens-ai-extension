// An argument as a shell would read it back: quoted unless it holds only
// characters a shell leaves alone. The line is only shown; no shell runs it.
const quoteArg = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/** A CLI invocation as the command line the user would type: `kubectl get pods -n web`. */
export const formatCommandLine = (program: string, args: readonly string[]): string =>
  [program, ...args].map(quoteArg).join(" ");
