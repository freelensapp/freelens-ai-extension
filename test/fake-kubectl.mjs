#!/usr/bin/env node
// A fake kubectl for the extension entry test, which runs it through the real
// CLI runner. What it does depends on its first argument:
//
// - `hang`: writes its pid to the file `FAKE_KUBECTL_PID_FILE` names, prints
//   "waiting" and runs until it is killed;
// - `fail`: prints an error on the standard error and exits with 3;
// - `flood`: prints a line, 400 KiB of "y" and a line;
// - anything else: prints its arguments, the `FAKE_KUBECTL_CLUSTER` and
//   `FAKE_KUBECTL_LEAK` variables of its environment and its standard input,
//   as JSON.

import { writeFileSync } from "node:fs";
import { text } from "node:stream/consumers";

const args = process.argv.slice(2);

switch (args[0]) {
  case "hang":
    writeFileSync(process.env.FAKE_KUBECTL_PID_FILE ?? "", String(process.pid));
    process.stdout.write("waiting\n");
    setInterval(() => undefined, 1000);
    break;
  case "fail":
    process.stderr.write("error: failed on purpose\n");
    process.exitCode = 3;
    break;
  case "flood":
    process.stdout.write(`head\n${"y".repeat(400 * 1024)}\ntail\n`);
    break;
  default:
    process.stdout.write(
      `${JSON.stringify({
        args,
        cluster: process.env.FAKE_KUBECTL_CLUSTER,
        leak: process.env.FAKE_KUBECTL_LEAK,
        stdin: await text(process.stdin),
      })}\n`,
    );
}
