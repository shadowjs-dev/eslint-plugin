<p align="center"><img src="https://raw.githubusercontent.com/shadowjs-dev/eslint-plugin/main/.github/banner.png" alt="ShadowJS" width="100%"></p>

# @shadow-js/eslint-plugin

[![npm](https://img.shields.io/npm/v/@shadow-js/eslint-plugin.svg)](https://www.npmjs.com/package/@shadow-js/eslint-plugin)
[![CI](https://github.com/shadowjs-dev/eslint-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowjs-dev/eslint-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/shadowjs-dev/eslint-plugin/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

ESLint rules for ShadowJS 1.0.0: reactivity, ownership, security, and a migration helper for code
ported from React or Solid. Works with ESLint 9 and 10 (flat config) and ships eslintrc-shaped
configs for ESLint 8.

## Install

```sh
npm install --save-dev eslint @shadow-js/eslint-plugin
```

Requires Node 22.12 or later and ESLint 9 or 10 (flat config). The package has no runtime dependency
on TypeScript.

## Quick start

```js
// eslint.config.js
import shadow from "@shadow-js/eslint-plugin";

export default [
  shadow.configs.recommended, // or .dusk, .strict, .migration
  { rules: { "shadow/no-unkeyed-dynamic-list": "off" } },
];
```

That is the whole setup: every config carries the plugin's own parser, so TypeScript, TSX and JSX files
are linted with no other package. It works on **TypeScript 7** and on any older TypeScript, because the
parser does not use the TypeScript compiler API (see [Parser](#parser)).

| Config | Use it for |
| --- | --- |
| `recommended` | ShadowJS code: reactivity errors are errors, style findings are warnings. |
| `dusk` | A Dusk project: `recommended`, with `shadow/server-only-import-in-client` pinned to the Dusk build's client/server boundary, and generated or built files (`dist`, `routeTree.gen.ts`) ignored. |
| `strict` | Everything on: unconditional hooks, every timer and frame needs a cleanup, `class` only, logical direction classes. |
| `migration` | Code being ported from React or Solid: `shadow/no-react-patterns` with autofixes. |
| `legacy-recommended`, `legacy-dusk`, `legacy-strict`, `legacy-migration` | The same sets for eslintrc (`plugins: ["@shadow-js"]`, parser `@shadow-js/eslint-plugin/parser`). `legacy-dusk` ignores the same files as `dusk` through `ignorePatterns`. |

## Parser

`@shadow-js/eslint-plugin/parser` (also `shadow.parser`) is an ESLint parser for JavaScript, JSX,
TypeScript and TSX. It parses with [`oxc-parser`](https://oxc.rs), whose syntax tree has the shape of
typescript-estree; builds the tokens, comments and locations ESLint wants; and analyzes scopes (value and
type scopes) with `@typescript-eslint/scope-manager`, which needs no TypeScript either. Nothing in the
package depends on `typescript` or `typescript-eslint`, so `npm install eslint @shadow-js/eslint-plugin`
next to TypeScript 7 resolves without `--legacy-peer-deps` or overrides. Core ESLint rules that read
tokens or scopes work on it too.

`typescript-eslint` itself cannot run on TypeScript 7: it reads TypeScript through the compiler's
JavaScript API, which TypeScript 7 (the native compiler) does not have, and it refuses TypeScript 6.1 and
later. If you need its rules, keep TypeScript 6.0 for the linter only.

### Type information

The parser builds no TypeScript program, so there is no type checker. One rule can use types when a
parser provides them; its docs page marks it "uses types when available". Without types it judges by syntax and
reports less, never differently:

- `signal-must-be-called` finds accessors from `useStore(0)` cells (and `useSignal`), `useMemo`, `useResource`, `useSelector` and
  `children` declarations (and aliases) in the file; with types it also suggests calling any value typed as
  a zero-argument function.

Rules of other plugins that need types (`@typescript-eslint/no-floating-promises`, ...) stop with
typescript-eslint's own error "You have used a rule which requires type information", because
`parserServices.program` is `null`.

### Using typescript-eslint instead

On TypeScript 6.0 or older, put typescript-eslint's parser **after** the config, so it wins:

```js
import shadow from "@shadow-js/eslint-plugin";
import tseslint from "typescript-eslint";

export default [
  shadow.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true } },
  },
];
```

Both parsers are tested against every rule (the rule tests run twice), and the typed rule is tested
with real type information.

### Your own parser setup

```js
import { parser } from "@shadow-js/eslint-plugin/parser";

export default [{ files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"], languageOptions: { parser } }];
```

The language comes from the file extension (`.ts`, `.mts`, `.cts`, `.d.ts`: TypeScript; `.tsx`: TSX; `.jsx`
or `.js` with `ecmaFeatures.jsx`: JSX; anything else, such as stdin: TSX). `sourceType` is read from the
config. The one thing it is not is a validator of TypeScript semantics: it reports syntax errors only.

A source nested more than 1,000 levels deep (brackets, chained operators or member accesses, elements) is a
parse error. Brackets are counted before the native parser runs, and the other nesting on the tree it builds.
The native parser (`oxc-parser`) itself can still overflow its stack on very deep JSX or conditional nesting
(around 10,000 levels); that limit belongs to the parser and is outside this package. Real code nests a few
dozen levels.

## Changing a rule in a preset

`configure(config, rules)` returns a copy of a shipped config (flat or `legacy-*`) with rule changes applied, so a
shared preset can turn a rule off, or on with options, in one place. A severity word keeps the preset's options,
`{ severity, options }` changes either or both (options are merged over the preset's), and the ESLint array form
replaces the entry. It throws a `TypeError` for an unknown rule, a bad severity or bad options. The
[guide](https://shadowjs.net/guides/eslint-plugin/#changing-a-rule-in-a-preset) has the full rules.

```js
import shadow, { configure } from "@shadow-js/eslint-plugin";

export default [
  configure(shadow.configs.strict, {
    "no-async-effect": "warn",
    "effect-cleanup-registered": { options: { checkTimeouts: false } },
    "no-react-patterns": { severity: "warn", options: { frameworks: ["react"] } },
  }),
];
```

## Dusk

```js
// eslint.config.js
import shadow from "@shadow-js/eslint-plugin";

export default [{ ignores: ["dist"] }, shadow.configs.dusk];
```

`shadow/server-only-import-in-client` follows the build's rule. Dusk replaces every server function
(`serverFn(...)`, `"use server"`) by a stub in the browser bundle, drops the imports only that code used,
and fails the build with `[IMPORT_PROTECTED]` for a server-only import that is left. So the rule reports
exactly that and nothing else:

- a route may import a module of server functions from `src/server`, and a `.server` import used inside a
  `serverFn` handler, its `input` schema or its `middleware` is fine;
- a `.server` import used in a component, at the top level of a module, or in a `loader`, `beforeLoad` or
  `head` is reported: those run in the browser too (a loader is isomorphic);
- Node built-ins and `@shadow-js/dusk/server|node|static|testing` are reported in code that reaches the
  browser;
- server code is not checked: `*.server.*`, `entry-server.*`, API routes, tests, `*.config.*`, `scripts/`,
  and Node entry files (`*.mjs`/`*.cjs` outside `src/`, such as `serve.mjs`). Add more with the
  `serverFiles` option (regular expressions on the path inside the project).

The rule works on one file at a time. It cannot see who imports a module: a plain `src/server/db.ts`
(no server function in it) is assumed to be server code, and a component that imports it is not reported
by this rule, although the build would fail with the import chain.

## Rules

| Rule | What it checks |
| --- | --- |
| [`shadow/no-destructure-props-outside-forgiving`](docs/rules/no-destructure-props-outside-forgiving.md) | Disallow destructuring props where the compiler does not keep them reactive (autoReactive off, or an unsupported form). |
| [`shadow/signal-must-be-called`](docs/rules/signal-must-be-called.md) | Require signal and memo accessors to be called when a value is needed. |
| [`shadow/no-write-in-memo`](docs/rules/no-write-in-memo.md) | Disallow writing signals or stores inside a `useMemo` computation. |
| [`shadow/no-signal-write-in-render-body`](docs/rules/no-signal-write-in-render-body.md) | Disallow writing external signals or stores while a component renders. |
| [`shadow/effect-cleanup-registered`](docs/rules/effect-cleanup-registered.md) | Require event listeners, intervals and subscriptions made in an effect to be cleaned up. |
| [`shadow/no-async-effect`](docs/rules/no-async-effect.md) | Disallow async functions as effect or memo callbacks. |
| [`shadow/hooks-in-owner`](docs/rules/hooks-in-owner.md) | Require `use*` hooks to be created in a component or hook, not in loops, after early returns, or later. |
| [`shadow/prefer-show-for-early-return`](docs/rules/prefer-show-for-early-return.md) | Prefer `<Show>` over an early `return` guarded by a reactive condition. |
| [`shadow/no-react-patterns`](docs/rules/no-react-patterns.md) | Flag React (and optionally Solid) APIs and JSX habits that ShadowJS does differently. |
| [`shadow/jsx-no-script-url`](docs/rules/jsx-no-script-url.md) | Disallow `javascript:` (and similar) URLs in URL attributes. |
| [`shadow/jsx-no-unsafe-inner-html`](docs/rules/jsx-no-unsafe-inner-html.md) | Disallow `innerHTML` (and similar HTML sinks) with values that are not literals. |
| [`shadow/no-unsafe-spread-user-input`](docs/rules/no-unsafe-spread-user-input.md) | Disallow spreading untrusted data onto DOM elements. |
| [`shadow/for-key-required-for-reorder`](docs/rules/for-key-required-for-reorder.md) | Require a `key` on `<For>` when items have an identity or the list is rebuilt. |
| [`shadow/no-unkeyed-dynamic-list`](docs/rules/no-unkeyed-dynamic-list.md) | Prefer `<For>` over `.map()` for lists rendered in JSX. |
| [`shadow/server-only-import-in-client`](docs/rules/server-only-import-in-client.md) | Disallow importing server-only modules from code that reaches the browser. |
| [`shadow/valid-event-names`](docs/rules/valid-event-names.md) | Require JSX event attributes to name real DOM events and take functions. |
| [`shadow/no-lowercase-dom-attrs-casing`](docs/rules/no-lowercase-dom-attrs-casing.md) | Keep DOM attribute spelling consistent: do not mix `class` / `className` (or `for` / `htmlFor`). |
| [`shadow/no-physical-direction-classes`](docs/rules/no-physical-direction-classes.md) | Prefer logical direction classes so application layouts work in both LTR and RTL. |

Each page in [docs/rules](docs/rules/README.md) is generated from the rule's `meta`
(`npm run docs -w @shadow-js/eslint-plugin`), and a test fails when a page is stale.

## Porting React or Solid code

```sh
npx eslint --fix --config eslint.migrate.config.js src
```

with `export default [shadow.configs.migration]`. ESLint applies the fixes over several passes:
`useState` becomes `useSignal` with reads turned into calls, dependency arrays disappear (`[]` becomes
`onMount`; if the effect also writes a signal it reads, only a suggestion offers the removal, because the effect would loop), a lazy
`useState(() => value)` initializer is unwrapped, `useCallback`/`memo` are unwrapped, `className` becomes `class`, imports move to
`@shadow-js/core` / `@shadow-js/web` and the old import is removed once unused. What cannot be translated
mechanically (`useRef`, `forwardRef`, `useCallback` without a dependency array, ...) stays reported with the alternative. Renamed and same-name hooks (`useSyncExternalStore`, `useEffectEvent`, `useActionState`, `useLayoutEffect`, `useReducer`, `createReaction`) are rewritten.

Solid's `onChange` on a text input fires when the value is committed; ShadowJS's `onChange` on a text input
fires on every edit (as in React). Solid code that uses `onChange` on a text input or a textarea is reported
by `shadow/no-react-patterns` (with `frameworks` including `"solid"`) and renamed to `onchange`, the native
change event. Use `onInput` when you want per-edit updates.

## Dependencies

- Runtime `oxc-parser` `0.153.0`: parses files for the rules (`src/parser/deps.ts`).
- Runtime `@typescript-eslint/scope-manager` `8.71.1`: scope analysis for the rules (`src/parser/deps.ts`).
- Runtime `@typescript-eslint/visitor-keys` `8.71.1`: child-node traversal (`src/parser/deps.ts`).
- Peers: `eslint` `^9.0.0 || ^10.0.0`: the host that runs the rules (`src/rule.ts`).

## Types

- Names from the root: `ShadowParser`, `ParseOptions`, `ParseResult`, `RuleSpec`, `ShadowRule`, `ShadowRuleDocs`, `ConfigName`, `LegacyConfig`, `RuleSetting`, `RuleChange`, `RuleOverride`, `RuleOverrides`, `Severity`.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: not applicable; the package has no browser target.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

## Using, changing and contributing

- **Use the package** (a person or a coding agent that builds with it): this README, and [SKILL.md](SKILL.md), the short page an agent reads first.
- **Change the package** (fix a bug, add a feature): [AGENTS.md](AGENTS.md) says how the repository is laid out, how to implement and test a change, and how a pull request is reviewed. It is written for people and coding agents alike.
- **Take part**: [CONTRIBUTING.md](CONTRIBUTING.md) is the short guide; [SECURITY.md](SECURITY.md) is for vulnerabilities.
