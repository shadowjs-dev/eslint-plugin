---
name: shadowjs-eslint-plugin
description: "Work with @shadow-js/eslint-plugin. ESLint rules for reactivity, ownership and security, and for migrating code from React or Solid. Use when a project imports it, or when asked to add, configure or debug it."
---

# @shadow-js/eslint-plugin

Version 1.0.1. ESLint rules for reactivity, ownership and security, and for migrating code from React or Solid.

## Where to read more

- @shadow-js/eslint-plugin: https://eslint.shadowjs.net
- Source and issues: https://github.com/shadowjs-dev/eslint-plugin
- The package README is the full reference for options and behavior; read it before changing a configuration.

## Install

```sh
npm install -D @shadow-js/eslint-plugin eslint
```

## Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `eslint` | `^9.0.0 || ^10.0.0` | yes |

## Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/eslint-plugin`
- `@shadow-js/eslint-plugin/parser`
- `@shadow-js/eslint-plugin/docs`

## Quick start

```js
// eslint.config.js
import shadow from "@shadow-js/eslint-plugin";

export default [
  shadow.configs.recommended, // or .dusk, .strict, .migration
  { rules: { "shadow/no-unkeyed-dynamic-list": "off" } },
];
```

## Working rules

- Run `npm run check` before proposing a change; it lints, builds, type-checks and tests.
- Keep a public change documented: TSDoc on every exported symbol, and a CHANGELOG entry.
- To change this repository rather than use the package, read AGENTS.md: the layout, the commands, the rules and how a pull request is reviewed.
