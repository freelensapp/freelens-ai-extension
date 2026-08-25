# Build guide

This guide will help you build the project, create the tgz file, and run the extension in Freelens.

## Index

- [Build guide](#build-guide)
  - [Index](#index)
    - [Prerequisites](#prerequisites)
    - [Install dependencies](#install-dependencies)
    - [Build the project](#build-the-project)
    - [Create the tgz file](#create-the-tgz-file)
    - [Run the extension](#run-the-extension)
      - [Additional Resources](#additional-resources)

---

### Prerequisites

Before you begin, make sure you have the following installed:

- [***Node.js***](https://nodejs.org/en)
- [***pnpm***](https://pnpm.io/it/installation)

---

### Install dependencies

After you have installed pnpm, you can install the dependencies by running the
following command in your terminal:

```sh
pnpm i
```

---

### Build the project

To build the project, run the following command in your terminal:
```sh
pnpm build
```

Or additionally, to build in production mode:
```sh
pnpm build:production
```

---

Now you can proceed with the following steps:

- [***Create the tgz file***](#create-the-tgz-file)
- [***Run the extension***](#run-the-extension)

---

### Create the tgz file

To create the tgz file, run the following command in your terminal:

```sh
pnpm pack:dev
```

This bumps the prerelease version, builds the project, and creates the tgz file.

After creating the tgz file, you can proceed with the extension setup guide to install the plugin in Freelens.

---

### Run the extension

This project builds a Freelens extension, not a standalone server: the code
runs inside Freelens once the tgz file is installed, as described in the
[***setup guide***](./SET_UP_EXTENSION.md). After rebuilding, reinstall the
extension or restart Freelens to pick up the new build.

---

#### Additional Resources

- [***README***](../README.md)
- [***Contribute***](CONTRIBUTING.md)
- [***Set up extension on freelens***](./SET_UP_EXTENSION.md)

If you find this project useful, please consider giving it a ⭐️ on
[***GitHub***](https://github.com/freelensapp/freelens-ai)!
