import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This installation's device id for pi's logins, kept in a file so every call
 * returns the same one. Created on first use.
 */
export function loadDeviceId(path: string): string {
  if (existsSync(path)) {
    const saved = readFileSync(path, "utf8").trim();
    if (UUID.test(saved)) {
      return saved;
    }
  }
  const id = randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${id}\n`);
  return id;
}
