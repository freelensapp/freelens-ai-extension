/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Checks the bundles in `dist/` for what the build and the type check do not
// catch, and what only Freelens would reject at runtime:
//
// - `dist/` holds the main entry, the renderer entry and the one stylesheet the
//   host links, with their source maps, and nothing else (C10; the main bundle
//   is one file, see `vite.config.mjs`);
// - `dist/main.js` loads in plain Node with a stand-in
//   `globalThis.FreelensExtensionApi`, and its default export is the extension
//   class;
// - neither bundle reads a v1 host global (`global.LensExtensions`, ...);
// - neither bundle imports a host module by its bare id, and neither carries a
//   copy of one (C3);
// - the renderer bundle imports no Node builtin or Electron module and has no
//   `require(`; the main bundle imports nothing but Node builtins and Electron,
//   and calls only the `__require` that Rolldown creates;
// - no decorator and no `accessor` field is left unlowered.
//
// Run after `pnpm build`. Exits with 1 and lists every failure.

import { readdir, readFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAst } from "vite";

const distDir = resolve(import.meta.dirname, "..", "dist");

const expectedFiles = ["main.js", "renderer.js", "renderer.css"];
const optionalFiles = ["main.js.map", "renderer.js.map", "renderer.css.map"];

/** The packages the host provides (C3), which a bundle must neither import by id nor inline. */
const hostPackages = ["react", "react-dom", "mobx", "mobx-react", "mobx-react-lite", "monaco-editor"];

/** The globals of the v1 host. */
const v1HostGlobals = new Set([
  "LensExtensions",
  "Mobx",
  "MobxReact",
  "React",
  "ReactDom",
  "ReactRouterDom",
  "ReactJsxRuntime",
]);

/** @param {string} source */
function packageName(source) {
  const segments = source.split("/");
  return source.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/** @param {string} source */
function isNodeOrElectron(source) {
  return isBuiltin(source) || source === "electron" || source.startsWith("electron/");
}

/**
 * The fields of the ESTree nodes that the checks read.
 *
 * @typedef {object} AstNode
 * @property {string} type
 * @property {string} [name]
 * @property {unknown} [value]
 * @property {AstNode | null} [source]
 * @property {AstNode} [callee]
 * @property {AstNode} [object]
 * @property {AstNode} [property]
 */

/**
 * Calls the visitor on every node of the tree.
 *
 * @param {unknown} root
 * @param {(node: AstNode) => void} visit
 */
function walk(root, visit) {
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if (value !== null && typeof value === "object") {
      if ("type" in value && typeof value.type === "string") {
        visit(/** @type {AstNode} */ (value));
      }
      for (const child of Object.values(value)) {
        if (child !== null && typeof child === "object") {
          stack.push(child);
        }
      }
    }
  }
}

/**
 * The module ids the bundle imports, its calls of `require`, its reads of v1
 * host globals and its unlowered decorators.
 *
 * @param {string} code
 */
function scanBundle(code) {
  /** @type {Set<string>} */
  const imports = new Set();
  let requireCalls = 0;
  /** @type {Set<string>} */
  const v1Globals = new Set();
  let decorators = 0;
  let accessors = 0;

  walk(parseAst(code), (node) => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "ExportNamedDeclaration":
      case "ImportExpression":
        if (node.source?.type === "Literal" && typeof node.source.value === "string") {
          imports.add(node.source.value);
        }
        break;
      case "CallExpression":
        if (node.callee?.type === "Identifier" && node.callee.name === "require") {
          requireCalls++;
        }
        break;
      case "MemberExpression":
        if (
          node.object?.type === "Identifier" &&
          node.object.name === "global" &&
          node.property?.type === "Identifier" &&
          node.property.name !== undefined &&
          v1HostGlobals.has(node.property.name)
        ) {
          v1Globals.add(`global.${node.property.name}`);
        }
        break;
      case "Decorator":
        decorators++;
        break;
      case "AccessorProperty":
        accessors++;
        break;
    }
  });

  return { imports: [...imports], requireCalls, v1Globals: [...v1Globals], decorators, accessors };
}

/**
 * The host packages the source map lists among the bundled sources.
 *
 * @param {string} mapPath
 */
async function inlinedHostPackages(mapPath) {
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  /** @type {Set<string>} */
  const found = new Set();
  for (const source of map.sources ?? []) {
    for (const name of hostPackages) {
      if (source.includes(`/node_modules/${name}/`)) {
        found.add(name);
      }
    }
  }
  return [...found];
}

/** Loads the main bundle as the host would, with the members of the host API it reads at load time. */
async function loadMainBundle() {
  class LensExtension {}
  class Ipc {}
  class ExtensionStore {}

  Object.assign(globalThis, {
    FreelensExtensionApi: {
      Common: { Store: { ExtensionStore } },
      Main: { LensExtension, Ipc },
      Renderer: {},
      Mobx: await import("mobx"),
    },
  });

  const bundle = await import(pathToFileURL(join(distDir, "main.js")).href);
  const extensionClass = bundle.default;

  if (typeof extensionClass !== "function" || !(extensionClass.prototype instanceof LensExtension)) {
    return "the default export of dist/main.js is not a subclass of Main.LensExtension";
  }
  return undefined;
}

/** @type {string[]} */
const failures = [];

const files = await readdir(distDir).catch(() => /** @type {string[]} */ ([]));

for (const file of expectedFiles) {
  if (!files.includes(file)) {
    failures.push(`dist/${file} is missing`);
  }
}
for (const file of files) {
  if (!expectedFiles.includes(file) && !optionalFiles.includes(file)) {
    failures.push(`dist/${file} is neither an entry, the stylesheet nor one of their source maps`);
  }
}

for (const name of /** @type {const} */ (["main", "renderer"])) {
  const bundleFile = `${name}.js`;
  if (!files.includes(bundleFile)) {
    continue;
  }

  const bundle = scanBundle(await readFile(join(distDir, bundleFile), "utf8"));

  for (const reference of bundle.v1Globals) {
    failures.push(`dist/${bundleFile} reads the v1 host global ${reference}`);
  }
  for (const source of bundle.imports) {
    if (hostPackages.includes(packageName(source)) || packageName(source) === "@freelensapp/extensions") {
      failures.push(`dist/${bundleFile} imports the host module "${source}" by its id`);
    } else if (name === "renderer" && isNodeOrElectron(source)) {
      failures.push(`dist/${bundleFile} imports "${source}", but renderer code gets no Node or Electron`);
    } else if (name === "main" && !isNodeOrElectron(source)) {
      failures.push(`dist/${bundleFile} imports "${source}", which Freelens does not install for an extension`);
    }
  }
  if (bundle.requireCalls > 0) {
    failures.push(`dist/${bundleFile} calls require() ${bundle.requireCalls} times`);
  }
  if (bundle.decorators > 0) {
    failures.push(`dist/${bundleFile} has ${bundle.decorators} unlowered decorators`);
  }
  if (bundle.accessors > 0) {
    failures.push(`dist/${bundleFile} has ${bundle.accessors} unlowered accessor fields`);
  }

  if (files.includes(`${bundleFile}.map`)) {
    for (const hostPackage of await inlinedHostPackages(join(distDir, `${bundleFile}.map`))) {
      failures.push(`dist/${bundleFile} inlines a copy of the host module "${hostPackage}"`);
    }
  } else {
    failures.push(`dist/${bundleFile}.map is missing, so the inlined packages cannot be checked`);
  }
}

if (files.includes("main.js")) {
  try {
    const failure = await loadMainBundle();
    if (failure) {
      failures.push(failure);
    }
  } catch (error) {
    failures.push(`dist/main.js does not load in Node: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error(`The built output fails ${failures.length} checks:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}

console.log("The built output passes its checks.");
