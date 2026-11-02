#!/usr/bin/env node
// A fake kubectl for the extension entry test, which runs it through the real
// CLI runner. What it does depends on its arguments:
//
// - `api-resources`: prints a table of pods, config maps and deployments, as
//   `kubectl api-resources -o wide` does;
// - `config`: prints no namespace, as `kubectl config view` does for a
//   kubeconfig that selects none;
// - `get pods hang`: writes its pid to the file `FAKE_KUBECTL_PID_FILE` names,
//   prints "waiting" and runs until it is killed;
// - `get pods fail`: prints an error on the standard error and exits with 3;
// - `get pods flood`: prints a line, 400 KiB of "y" and a line;
// - anything else: prints its arguments, the `FAKE_KUBECTL_CLUSTER` and
//   `FAKE_KUBECTL_LEAK` variables of its environment and its standard input,
//   as JSON.

import { writeFileSync } from "node:fs";
import { text } from "node:stream/consumers";

const args = process.argv.slice(2);

const API_RESOURCES = `NAME          SHORTNAMES   APIVERSION   NAMESPACED   KIND         VERBS                                                        CATEGORIES
configmaps    cm           v1           true         ConfigMap    create,delete,deletecollection,get,list,patch,update,watch
pods          po           v1           true         Pod          create,delete,deletecollection,get,list,patch,update,watch   all
deployments   deploy       apps/v1      true         Deployment   create,delete,deletecollection,get,list,patch,update,watch   all
`;

switch (args[0] === "get" && args[1] === "pods" ? `get pods ${args[2]}` : args[0]) {
  case "api-resources":
    process.stdout.write(API_RESOURCES);
    break;
  case "config":
    break;
  case "get pods hang":
    writeFileSync(process.env.FAKE_KUBECTL_PID_FILE ?? "", String(process.pid));
    process.stdout.write("waiting\n");
    setInterval(() => undefined, 1000);
    break;
  case "get pods fail":
    process.stderr.write("error: failed on purpose\n");
    process.exitCode = 3;
    break;
  case "get pods flood":
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
