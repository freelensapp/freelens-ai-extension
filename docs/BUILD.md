# Build guide

This guide builds the extension from the source, packs it into a tarball, and
runs it in Freelens.

## Index

- [Build guide](#build-guide)
  - [Index](#index)
    - [Prerequisites](#prerequisites)
    - [Install dependencies](#install-dependencies)
    - [Build the project](#build-the-project)
    - [Create the tgz file](#create-the-tgz-file)
    - [Run the extension](#run-the-extension)
    - [Development loop](#development-loop)
      - [Additional Resources](#additional-resources)

---

### Prerequisites

- [**_Freelens_**](https://freelens.app) 2.0.0 or newer
- [**_Node.js_**](https://nodejs.org/en), the version in `.nvmrc` (installed
  with `nvm install` or `mise install` from the root of this repository)
- [**_pnpm_**](https://pnpm.io/installation), the version of `packageManager`
  in `package.json` (installed with `corepack install`)

---

### Install dependencies

From the root of this repository:

```sh
pnpm install
```

---

### Build the project

```sh
pnpm build
```

The extension is built into `dist/`: `dist/main.js`, `dist/renderer.js` and
`dist/renderer.css`. The build does not type-check; run `pnpm type:check` for
that.

---

Now you can proceed with the following steps:

- [**_Create the tgz file_**](#create-the-tgz-file)
- [**_Run the extension_**](#run-the-extension)

---

### Create the tgz file

```sh
pnpm pack:dev
```

This bumps the prerelease version, builds the project, and creates the tgz
file in the root of the repository. `pnpm pack` packs the current build
without changing the version.

---

### Run the extension

This project builds a Freelens extension, not a standalone application: the
code runs inside Freelens once it is installed, as described in the
[**_setup guide_**](./SET_UP_EXTENSION.md). Install either the tgz file, or
the checkout itself as a directory.

---

### Development loop

Install the extension from the directory of your checkout once, as the
[**_setup guide_**](./SET_UP_EXTENSION.md) describes, then run:

```sh
pnpm dev
```

It rebuilds the extension whenever a source file changes, and Freelens
reloads the extension after each rebuild, without a restart and without
packing. Stop it with `ctrl`+`C`. A change to `main` or `renderer` in
`package.json` needs Freelens restarted once.

---

#### Additional Resources

- [**_README_**](../README.md)
- [**_Contribute_**](../CONTRIBUTING.md)
- [**_Set up extension on freelens_**](./SET_UP_EXTENSION.md)

If you find this project useful, please consider giving it a star on
[**_GitHub_**](https://github.com/freelensapp/freelens-ai-extension)!
