# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

> **Tip**: If you find yourself correcting the agent during interactive work, suggest adding a new rule to this file so the lesson is captured for future sessions.

## Project Overview

This repository serves as an example how to build and publish extensions for
Freelens application.

- **Language**: TypeScript 5.9.3
- **Runtime**: Node.js >= 22.0.0, Freelens >= 1.8.0
- **Package manager**: pnpm 10.x (locked)
- **License**: MIT

## Common Commands

```bash
# Type checking
pnpm type:check

# Linting & formatting
pnpm biome:check          # TypeScript/TSX (biome) — prefer this for TS/TSX
pnpm biome:fix            # Auto-fix TypeScript/TSX
pnpm trunk:check          # SCSS, Markdown, and other formats not covered by biome
pnpm trunk:fix            # Auto-fix SCSS, Markdown, etc.
pnpm lint:check           # biome + prettier check (all formats)
pnpm lint:fix             # biome + prettier fix (all formats)

# Tests
pnpm test:unit            # vitest

# Build
pnpm build                # Full build (type-check + electron-vite)
pnpm build:production     # Production build (no preserveModules)

# Pack for testing
pnpm pack:dev             # Bump prerelease version, build, and create .tgz for install in Freelens app

# Clean
pnpm clean                # Clean out/
pnpm clean:dts            # Remove generated *.d.scss.ts files
pnpm clean:all            # Clean everything (dts, node_modules, out, tgz)
```

## Architecture

```text
src/
  main/index.ts            # Extension entry point (main process, CJS)
  renderer/index.tsx       # Extension entry point (renderer process, CJS)
  renderer/k8s/gateway-api/ # K8s object model classes (one file per CRD)
  renderer/details/gateway-api/ # Detail view components for CRDs
  renderer/pages/gateway-api/  # Cluster page components
  renderer/components/      # Shared components
  renderer/icons/           # SVG icons
  renderer/observer.ts      # MobX observer helper
  renderer/utils.ts         # Utility functions (e.g., createHash)
  common/utils.ts           # Common utilities (e.g., maybe)
```

Build output goes to `out/`.

## CRD KubeObject Pattern

K8s object classes MUST use `static readonly` properties for metadata. **Instance methods do NOT work and MUST NOT be used.** The Freelens host reads properties from the class constructor statically — instance methods are not available at runtime because the host creates plain object copies of the K8s resource data, not instances of the extension's class. This means:

- **Allowed**: `object.spec?.someField`, `object.status?.conditions` — direct property access on typed `spec`/`status` interfaces
- **Allowed**: helper functions like `hasTrueCondition(conditions, "Accepted")` from `types.ts`
- **Forbidden**: `object.someMethod()` — instance methods will never exist at runtime
- **Forbidden**: `typeof (object as any).someMethod === "function" ? ...` — anti-pattern that always falls through to the fallback path
- **Forbidden**: `as any` — use the existing typed `spec`/`status` interfaces directly; all CRD models already define proper `Spec`/`Status` interfaces

Always access `spec` and `status` properties directly via their typed interfaces. Do not define instance methods on KubeObject subclasses — they will not be callable at runtime.

```typescript
export class Gateway extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  GatewayStatus,
  GatewaySpec
> {
  static readonly kind = "Gateway";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/gateways";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "gateways",
    singular: "gateway",
    shortNames: ["gtw"],
    title: "Gateways",
  };
}

// Also export Api and Store classes (always needed):
export class GatewayApi extends Renderer.K8sApi.KubeApi<Gateway> {}
export class GatewayStore extends Renderer.K8sApi.KubeObjectStore<Gateway, GatewayApi> {}
```

Each CRD file exports three classes: the KubeObject, the KubeApi, and the KubeObjectStore. They are registered in `src/renderer/index.tsx` via `kubeObjectDetailItems`, `clusterPages`, and `clusterPageMenus`.

## Renderer Components

- Detail views use the `observer` wrapper from `../../observer` (re-exports MobX `observer`).
- SCSS modules generate TypeScript type files (`*.module.d.scss.ts`) via `vite-plugin-sass-dts`. These are auto-generated and should be cleaned with `pnpm clean:dts` when SCSS changes.
- Common detail view styles are in `src/renderer/details/gateway-api/common.module.scss`.

## Key Dependencies (provided by Freelens host at runtime)

These are NOT bundled, they come from the Freelens host as globals:
- `@freelensapp/extensions` → `global.LensExtensions`
- `mobx` → `global.Mobx`
- `react` → `global.React`
- `react-dom` → `global.ReactDom`
- `mobx-react` → `global.MobxReact`
- `react-router-dom` → `global.ReactRouterDom`

Other dependencies ARE bundled into the extension output.

## AI Model & Provider System

The list of chat models is user-editable and persisted in the preferences
store; there is no hardcoded model enum. Key files live in
`src/renderer/business/provider/`:

- `ai-models.tsx` — `AIProviders` enum (only `OPEN_AI` active), the
  `CustomModel` type (`{ provider, name }`), the seed list `DEFAULT_MODELS`
  (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`), and `DEFAULT_OPENAI_BASE_URL`.
- `model-capabilities.ts` — name heuristics (regex) deciding model behavior.
  Add new model families here rather than hardcoding ids. Reasoning models
  (`o<n>`, `gpt-5.x`) take a reasoning effort and reject `temperature`.
- `model-list.ts` — pure helpers for the editable list (trim, dedupe, remove,
  `resolveSelectedModel` selection fallback). No host/MobX deps so they are
  unit-tested directly.
- `openai-fields.ts` — pure `buildOpenAIChatFields` builder (proxy routing
  header + reasoning-effort/temperature heuristic), unit-tested in isolation.
- `model-provider.ts` — `getModel()` resolves the selected model's provider and
  builds the LangChain client; throws when no model is selected.

A custom base URL is routed to the local proxy (`src/main/ai-proxy-server.ts`)
via the `x-upstream-base-url` header rather than being passed straight to the
client. When changing the heuristics or list logic, prefer extending the pure
helpers and add/adjust the matching `*.test.ts` (run with `pnpm test:unit`).

## Code Style

- **Biome** formats **TypeScript/TSX**: double quotes, semicolons, trailing commas, 2-space indent, 120 char line width
- **Trunk** formats **SCSS, Markdown**, and other non-TS formats — use `pnpm trunk:fix`
- Import order (enforced by biome organizeImports): built-in modules → `@freelensapp/**` → packages → relative paths
- React 17 (no `react/jsx-runtime` in tsconfig needed, but handled by build)
- **No emoji** in Markdown files (`.md`), comments, or any source code

## Security

Never read, display, reference, or include the contents of the following files in any response or context, even if they are open in the editor:

- `.env`
- `.env.*`
- `.npmrc`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.pfx`
- `*.pem`
- `*.key`

## Electron Multi-Process

Extensions run in the same multi-process model as the Freelens host:

- **Main process** (`src/main/`) — Node.js environment, extension lifecycle, cluster connectivity
- **Renderer process** (`src/renderer/`) — Chromium browser, UI components

Code in `src/common/` is shared between both processes.

## Troubleshooting

### Changes Not Appearing

1. Check that files are not in ignored output directories (`out/`, `dist/`, `node_modules/`)
2. Full clean and rebuild: `pnpm clean:all && pnpm build`
3. Reinstall the extension in Freelens (or restart the app in dev mode)

### Build Failures

1. Check for TypeScript errors: `pnpm type:check`
2. Check for linting errors: `pnpm lint:check`
3. Verify dependencies: `pnpm install`
4. Check Node.js version matches the `engines` field in `package.json`

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors
2. Check the terminal where Freelens was launched for main process errors
3. Look for stack traces with file:line numbers
4. Verify all CRD objects have proper `static readonly` properties (kind, apiBase, crd)
5. Validate both with `pnpm type:check` **and** `pnpm build` — runtime failures can appear only in bundled `out/` code

## Best Practices

1. **Use semantic search** to find examples and patterns in the codebase
2. **Follow existing patterns** — grep for similar implementations before creating new ones
3. **Test changes** before committing
4. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
5. **For TypeScript/TSX files:** run `pnpm biome:fix` (or `biome check` directly if `biome` is installed locally)
6. **For SCSS, Markdown, and other formats:** run `pnpm trunk:fix` (or `trunk check` directly if `trunk` is installed locally)
7. **Full build** when in doubt about cached state: `pnpm clean:all && pnpm build`
8. **Do not use Anthropic Fable for coding tasks** — Fable may be used only for planning,
   analysis, and thinking through problems. When writing or editing code,
   use standard editing tools instead.

## GitHub Actions (Claude Code Action) Rules

This project has a Claude Code workflow (`.github/workflows/claude.yaml`) triggered
via `@claude` comments on issues, PR comments, and reviews. When operating via that
workflow, follow these rules:

### Code Review

When reviewing code and proposing fixes:

1. **Show the diff first** — present every proposed change as a unified diff
   block using the `diff` language tag:

   ```diff
   --- a/path/to/file.ts
   +++ b/path/to/file.ts
   @@ -10,7 +10,7 @@
    const oldLine = "before";
   -const changedLine = "after";
   +const changedLine = "the fix";
    const unchangedLine = "same";
   ```

   You can generate this from the terminal with:
   ```bash
   git diff -u -- path/to/file
   ```

   If the change spans multiple files, group them under a single commit
   subject and show each file's diff sequentially.

2. **Propose a commit subject first** — before any code change, output a
   single line with the proposed commit subject:

   ```text
   **Proposed commit:** <short description>
   ```

   Do **not** use Conventional Commits prefixes (e.g. `fix:`, `feat:`,
   `chore:`, `refactor:`, `docs:`, `test:`, `ci:`). This project prefers
   plain, descriptive commit messages and PR titles without any prefix.

   Wait for the user to confirm (or adjust) the subject before applying the
   change.

3. **Comment style:**
   - Keep review comments concise and actionable
   - Reference specific lines (file + line number) when pointing out issues
   - Offer a concrete fix suggestion rather than just flagging a problem
   - Do **not** use emoji in any Markdown, comments, commit messages, or
     PR descriptions. The only exception is emoji that already appears
     inside code strings (e.g. application logs, user-facing messages).
   - Use GitHub's `suggestion` block for small targeted fixes so the PR
     author can accept the change with a single click:

     ````suggestion
     <same unified-diff format as shown above>
     ````

   - For larger multi-file changes, use `diff -u` blocks in a regular
     comment instead, with the proposed commit subject shown first

### Making Changes to a PR

When asked to implement a change on a PR:

1. Propose the commit subject (as above)
2. Describe what will change and why
3. After confirmation, apply the changes with commits on the PR branch
4. **One commit per fix** — when a review surfaces more than one issue or
   the plan includes more than one fix, apply and commit each fix
   separately. Do not batch multiple independent fixes into a single
   commit. This keeps the history bisectable and makes each change easy
   to revert individually.

### Branch Naming Conventions

When creating a branch from an issue, use a human-readable name that includes
the issue number and a short slug derived from the issue title:

```text
claude/issue-<number>-<short-slug>
```

- `<number>` is the GitHub issue number
- `<short-slug>` is a kebab-case summary of the issue title, kept short
  (3–6 words maximum, omit articles and filler words)

Do **not** use auto-generated timestamp suffixes (e.g.
`claude/issue-1957-20260612-2108`) — these are not human-readable and make
branch lists hard to scan.
