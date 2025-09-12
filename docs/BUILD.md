# Build guide

This guide will help you build the project to create the tgz file or run the server localy.

## Index

- [Build guide](#build-guide)
  - [Index](#index)
    - [Prerequisites](#prerequisites)
    - [Install dependencies](#install-dependencies)
    - [Build the project](#build-the-project)
    - [Run the server](#run-the-server)
    - [Create the tgz file](#create-the-tgz-file)
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

Or additionally, to build il dev mode:
```sh
pnpm build:dev
```

---

Now you can choose between the following options:

- [***Run the server***](#run-the-server)
- [***Create the tgz file***](#create-the-tgz-file)

---

### Run the server

To run the server, run the following command in your terminal:

```sh
pnpm start
```
---

### Create the tgz file

To create the tgz file, run the following command in your terminal:

```sh
pnpm pack
```

After creating the tgz file, you can proceed with the extension setup guide to install the plugin in Freelens.

---

#### Additional Resources

- [***README***](../README.md)
- [***Contribute***](CONTRIBUTING.md)
- [***Set up extension on freelens***](./SET_UP_EXTENSION.md)

If you find this project useful, please consider giving it a ⭐️ on
[***GitHub***](https://github.com/freelensapp/freelens-ai)!
