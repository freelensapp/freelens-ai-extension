# 04: Port, step 2: Vite build

**What to build:** the v2 build. Two Vite runs, one per entry, copied from the
`main` branch with its plugins:

- the host-provided modules resolve to `globalThis.FreelensExtensionApi`;
- the renderer run targets the browser and fails on any Node or Electron
  import;
- the main run targets Rolldown's `node` platform with the builtins external;
- standard decorators are lowered;
- the renderer emits exactly one stylesheet;
- the build plugin writes the CSS module declarations, which are committed.

The main bundle is one file with no code splitting, so that a development
reload re-evaluates all of pi (pi loads its providers with dynamic `import()`).
`dist/` holds only the main entry, the renderer entry and the stylesheet.
pi's OAuth login modules stay registered statically at startup.

Add the checks of the built output from the skill, run after every build from
now on: the main bundle loads in plain Node with a stand-in
`FreelensExtensionApi` and exports the extension class; no `global.` host
references; no bare imports of host modules; no Node builtin in the renderer;
no unlowered decorator; one stylesheet.

The renderer build may still fail on source that ticket 06 migrates; the main
bundle should build and load already.

**Blocked by:** 03 (port, steps 0 and 1).

**Status:** ready-for-agent

- [x] The build configuration and plugins match the `main` branch, apart from
      what the pi agent needs (one-file main bundle).
- [x] The main bundle builds as one ES module file and loads in plain Node with
      the stand-in host API, exporting the extension class.
- [x] The checks of the built output exist and run; the report says which fail
      and why.
- [x] One commit.
