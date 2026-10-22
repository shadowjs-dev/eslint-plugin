import { builtinModules } from "node:module";
import { relative } from "node:path";
import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, asAst, at, identName, list, str, unwrap } from "../utils/ast";
import {
  analyzeClientReach,
  hasUseServerDirective,
  isSplitRouteModule,
} from "../utils/client-reach";
import { importOf, resolveVariable } from "../utils/scope";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
/** The module that exports the server-side Dusk helpers (`serverFn`, `apiRoute`). */
const DUSK_SERVER = "@shadow-js/dusk/server";

/** `a.b` -> `a\.b` for names built into a pattern. */
const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Every module Node.js ships, as the build's import protection sees it: a specifier is a built-in
 * when it, or its first path segment, is in `module.builtinModules` (so `fs`, `fs/promises`,
 * `crypto`, `path`, `url`...), or when it starts with `node:`.
 */
const NODE_BUILTINS = `^(?:node:|(?:${[
  ...new Set(builtinModules.map((name) => name.split("/")[0] ?? name)),
]
  .filter((name) => !name.startsWith("node:"))
  .map(escapePattern)
  .join("|")})(?:/|$))`;

/** Files that never reach a browser in a Dusk project, whatever they import. */
const DUSK_SERVER_FILES = [
  // The build's own convention: `*.server.{ts,tsx,js,jsx,mts,mjs}`.
  "\\.server\\.[cm]?[jt]sx?$",
  // Handler options and middleware (`src/entry-server.ts`).
  "(^|/)entry-server\\.[cm]?[jt]sx?$",
  "\\.(test|spec)\\.[cm]?[jt]sx?$",
  "(^|/)(test|tests|__tests__)/",
  "\\.config\\.[cm]?[jt]s$",
  // Project tooling, not the app: a `tools/` folder under `src/` is browser code like any other.
  "^(?!(?:.*/)?src/)(?:.*/)?(?:scripts|tools)/",
  // Node entry files such as `serve.mjs`, which run the production build. Under `src/` a `.mjs`
  // file is a module like any other.
  "^(?!(?:.*/)?src/).*\\.[mc]js$",
];

/** What the build's import protection refuses in browser code. */
const DUSK_SERVER_IMPORTS = [
  "\\.server(\\.[cm]?[jt]sx?)?$",
  "^@shadow-js/dusk/(?:server|node|static|testing)$",
  // The npm marker of server code: the build refuses the specifier itself.
  "^server-only$",
  NODE_BUILTINS,
];

/** Older, directory-and-driver conventions for code bases that are not Dusk. */
const GENERIC_SERVER_FILES = [...DUSK_SERVER_FILES, "(^|/)server/"];
const GENERIC_SERVER_IMPORTS = [
  "\\.server(\\.[cm]?[jt]sx?)?$",
  "(^|/)server/",
  "^server-only$",
  "^@shadow-js/dusk/server$",
  "^@shadow-js/web/server$",
  "^node:",
  "^(?:fs|fs/promises|child_process|net|http|https|http2|dns|tls|cluster|worker_threads|os|readline|vm|zlib)$",
  "^(?:pg|mysql2?|better-sqlite3|sqlite3|@prisma/client|bcrypt|bcryptjs)$",
];

interface Options {
  preset?: "dusk" | "generic";
  serverFiles?: string[];
  serverImports?: string[];
  allow?: string[];
}

/**
 * Disallow importing server-only modules from code that reaches the browser.
 *
 * What it catches and why: a browser bundle cannot run `node:fs`, and server code that reaches it
 * can leak secrets or fail the build far from the cause. With the `dusk` preset (the default) the
 * rule answers what the Dusk build answers, file by file. For the browser the build does this:
 * 1. The server-function transform replaces the arguments of every `serverFn(...)` from
 *    `@shadow-js/dusk/server` (handler, `input` schema, `middleware`) and the body of every
 *    `"use server"` function by a stub, then drops every declaration and import that only that
 *    code used. A module with no server function is not rewritten: all its imports stay.
 * 2. The router splits a page under `routes/` (one that exports `default`, `pending`, `error` or
 *    `notFound`, has no `export *` and no top-level statement that runs code) and keeps in each
 *    half only what its exports use, so an import nothing uses is gone. `loader`, `beforeLoad`,
 *    `validateSearch` and `head` are kept: they run in the browser on client navigations.
 * 3. Import protection fails the build on any import left in browser code of a `*.server.*`
 *    module, a Node built-in (`node:*`, or a name in `module.builtinModules` such as `fs`, `path`,
 *    `crypto`, `fs/promises`), `@shadow-js/dusk/server`, `/node`, `/static`, `/testing`, or the
 *    `server-only` marker package.
 *
 * The rule reports an import declaration, re-export, dynamic `import()` or `require()` of such a
 * module that survives steps 1 and 2. Uses in types only (`import type`, `typeof x` in a type,
 * `export type` and `export { type A } from`) are erased and never reported. Server files are not
 * checked at all: `*.server.*`, `entry-server.*`, tests, `*.config.*`, `scripts/` and `tools/`
 * (outside `src/`), Node entry files (`*.mjs`, `*.cjs` outside `src/`, such as `serve.mjs`), API
 * routes (a default export of `apiRoute(...)` from `@shadow-js/dusk/server`, or HTTP-method exports
 * such as `GET` with no default export), files with a top-level `"use server"` directive, and, in
 * the `dusk` preset, files under
 * `server/` that define no server function. One file cannot see what imports it, so a component
 * that imports such a `src/server` file is not reported unless it reaches a forbidden module
 * itself; the build catches that case with the full import chain. The build itself is the oracle
 * of the tests (`server-only-import-in-client.build.test.ts`).
 *
 * Incorrect:
 *
 * ```tsx
 * // src/components/Profile.tsx
 * import { db } from './db.server';
 * export function Profile() {
 *   return <p>{db.name}</p>;
 * }
 * ```
 *
 * ```tsx
 * // src/routes/posts/index.tsx
 * import { db } from '../../server/db.server';
 * // A loader runs in the browser on client navigations: it is not stripped.
 * export const loader = () => db.list();
 * ```
 *
 * ```tsx
 * // src/routes/index.tsx
 * import { readFile } from 'node:fs/promises';
 * export const text = readFile;
 * ```
 *
 * ```tsx
 * // src/server/posts.ts
 * import { serverFn } from '@shadow-js/dusk/server';
 * import { db } from './db.server';
 * // Top-level code of a module the routes import reaches the browser.
 * export const total = db.size;
 * export const list = serverFn({}, () => db.list());
 * ```
 *
 * Correct:
 *
 * ```tsx
 * // src/server/posts.ts
 * import { serverFn } from '@shadow-js/dusk/server';
 * import { db } from './db.server';
 * export const list = serverFn({ method: 'GET' }, () => db.list());
 * ```
 *
 * ```tsx
 * // src/routes/posts/index.tsx
 * import { list } from '../../server/posts';
 * export const loader = () => list();
 * ```
 *
 * ```tsx
 * // src/routes/index.tsx
 * import { db } from './db.server';
 * async function save(title: string) {
 *   'use server';
 *   return db.insert(title);
 * }
 * export default function Home() {
 *   return <button onClick={() => save('x')}>Save</button>;
 * }
 * ```
 *
 * ```tsx
 * // src/lib/sizes.ts
 * import type { Stats } from 'node:fs';
 * export const size = (stats: Stats) => stats.size;
 * ```
 *
 * Options: one object; every pattern is a regular expression as a string. File patterns are
 * matched against the path of the linted file inside the project (relative to the working
 * directory), import patterns against the specifier.
 * - `preset` (`"dusk"` or `"generic"`, default `"dusk"`): `dusk` is the boundary above. `generic`
 *   is for code bases that are not Dusk: it treats as server-only `*.server` modules, `server/`
 *   directories, `server-only`, `@shadow-js/dusk/server`, `@shadow-js/web/server`, `node:*`, a
 *   short list of Node built-ins (`fs`, `child_process`, `http`, ...) and common database
 *   drivers (`pg`, `mysql2`, `@prisma/client`, ...), and every file under `server/` is server code.
 * - `serverFiles` (default none): more files that are server code and are not checked.
 * - `serverImports` (default none): more server-only specifiers.
 * - `allow` (default none): specifiers never reported.
 *
 * The rule does not read Dusk's `importProtection` option: express its extra `server` globs with
 * `serverImports` and its exemptions with `allow`.
 *
 * Autofix: the rule does not fix code.
 *
 * Disabling: `// eslint-disable-next-line shadow/server-only-import-in-client` for one line, or a
 * block between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/server-only-import-in-client *\/
 * /* eslint-enable shadow/server-only-import-in-client *\/
 * ```
 *
 * A disable is legitimate in a file that only server code imports but whose path the rule cannot
 * tell apart from browser code; a `serverFiles` pattern is the better fix when there are several.
 *
 * Configs:
 * - `recommended`: `"error"`
 * - `strict`: `"error"`
 * - `migration`: `"error"`
 * - `dusk`: `["error", { preset: "dusk" }]`
 *
 * @example
 * ```ts
 * import shadow from "@shadow-js/eslint-plugin";
 *
 * export default [
 *   shadow.configs.recommended,
 *   {
 *     rules: {
 *       "shadow/server-only-import-in-client": [
 *         "error",
 *         { preset: "dusk", serverFiles: ["^src/jobs/"], allow: ["^@acme/shared-config$"] },
 *       ],
 *     },
 *   },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/server-only-import-in-client.md
 */
export const serverOnlyImportInClient: ShadowRule = defineRule({
  name: "server-only-import-in-client",
  id: "ESL-15",
  type: "problem",
  description: "Disallow importing server-only modules from code that reaches the browser.",
  recommended: true,
  rationale:
    "A browser bundle cannot run `node:fs`, and server code that reaches it can leak secrets or fail " +
    "the build far from the cause. Dusk draws the line itself: its build replaces every " +
    'server function (`serverFn(...)`, `"use server"`) by a stub and drops the imports only that code ' +
    "used; then import protection fails the build on any server-only import left in browser code " +
    "(`*.server.*` files, Node built-ins, `@shadow-js/dusk/server|node|static|testing`, the " +
    "`server-only` marker). This rule " +
    "runs the same check in the editor. It reports exactly what the build would, so a route may import " +
    "a module of server functions from `src/server`, and a `.server` import used only inside a " +
    "server function is fine.",
  examples: {
    incorrect: [
      "// src/components/Profile.tsx\nimport { db } from './db.server';\nexport function Profile() {\n  return <p>{db.name}</p>;\n}",
      "// src/routes/posts/index.tsx\nimport { db } from '../../server/db.server';\n// A loader runs in the browser on client navigations: it is not stripped.\nexport const loader = () => db.list();",
      "// src/routes/index.tsx\nimport { readFile } from 'node:fs/promises';\nexport const text = readFile;",
      "// src/server/posts.ts\nimport { serverFn } from '@shadow-js/dusk/server';\nimport { db } from './db.server';\n// Top-level code of a module the routes import reaches the browser.\nexport const total = db.size;\nexport const list = serverFn({}, () => db.list());",
    ],
    correct: [
      "// src/server/posts.ts\nimport { serverFn } from '@shadow-js/dusk/server';\nimport { db } from './db.server';\nexport const list = serverFn({ method: 'GET' }, () => db.list());",
      "// src/routes/posts/index.tsx\nimport { list } from '../../server/posts';\nexport const loader = () => list();",
      "// src/routes/index.tsx\nimport { db } from './db.server';\nasync function save(title: string) {\n  'use server';\n  return db.insert(title);\n}\nexport default function Home() {\n  return <button onClick={() => save('x')}>Save</button>;\n}",
      "// src/lib/sizes.ts\nimport type { Stats } from 'node:fs';\nexport const size = (stats: Stats) => stats.size;",
    ],
  },
  notes: [
    "The rule has two presets. `dusk` (the default) is the boundary of Dusk and reports only what the build's import protection refuses: `*.server.*` modules, any Node built-in (`node:*`, `fs`, `path`, `crypto`, ...), `@shadow-js/dusk/server`, `/node`, `/static`, `/testing` and the `server-only` marker package. `generic`, for code bases that are not Dusk, treats `*.server` modules, `server/` directories, `server-only`, `@shadow-js/dusk/server`, `@shadow-js/web/server`, `node:*`, a short list of Node built-ins and common database drivers as server-only.",
    'What the browser build removes: the arguments of `serverFn(...)` (handler, `input` schema, `middleware`) and the bodies of `"use server"` functions, then every declaration and import that only that code used. An import is reported when something still uses it after that, when nothing uses it, or when it is a side-effect import. A module with no server function is not rewritten: all its imports count. Pages under `routes/` are the exception: the router keeps only what the route exports use, so an import nothing uses is gone. Uses in types (`import type`, `typeof x` in a type) are erased and never reported.',
    "`loader`, `beforeLoad`, `validateSearch` and `head` are not stripped: they run in the browser on client navigations, so a server-only import used by them is reported. Call a server function from a loader instead.",
    'Server code (not checked): `*.server.*`, `entry-server.*`, tests, `*.config.*`, `scripts/` and `tools/` (outside `src/`), Node entry files (`*.mjs`, `*.cjs` outside `src/`, such as `serve.mjs`), API routes (a default export of `apiRoute(...)` from `@shadow-js/dusk/server`, or HTTP-method exports such as `GET` with no default export), files with a top-level `"use server"`, and, in the `dusk` preset, files under `server/` that define no server function. A file under `server/` that does define one is imported by the routes, so its imports are checked.',
    "One file cannot tell what imports it: `src/server/db.ts` without server functions is assumed server-only, and a component that imports it is not reported unless it reaches a `.server` file or a built-in. The build catches that case with the full import chain.",
    "Options are regular expressions as strings, matched against the path of the file inside the project (relative to the working directory). `serverFiles` and `serverImports` add patterns to the preset's; `allow` lists specifiers to ignore.",
  ],
  schema: [
    {
      type: "object",
      properties: {
        preset: { enum: ["dusk", "generic"] },
        serverFiles: { type: "array", items: { type: "string" } },
        serverImports: { type: "array", items: { type: "string" } },
        allow: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{}],
  disableWhen:
    "In a file that only server code imports but whose path the rule cannot tell apart from browser " +
    "code; when there are several such files, a `serverFiles` pattern is the better fix.",
  messages: {
    serverOnly:
      '`{{source}}` is server-only, but code in `{{file}}` can reach the browser. Import it from a server file (`*.server.ts`), or use it only inside a `serverFn` handler or a `"use server"` function.',
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const generic = options.preset === "generic";
    const compile = (patterns: readonly string[]): RegExp[] => patterns.map((p) => new RegExp(p));
    const serverFiles = compile([
      ...(generic ? GENERIC_SERVER_FILES : DUSK_SERVER_FILES),
      ...(options.serverFiles ?? []),
    ]);
    const serverImports = compile([
      ...(generic ? GENERIC_SERVER_IMPORTS : DUSK_SERVER_IMPORTS),
      ...(options.serverImports ?? []),
    ]);
    const allowed = compile(options.allow ?? []);
    const absolute = context.filename.replaceAll("\\", "/");
    // Patterns see the path inside the project, so a checkout under `~/tools/` or `~/server/` does
    // not turn every file into server code. Files outside the working directory keep their path.
    const inProject = relative(context.cwd, absolute).replaceAll("\\", "/");
    const file = inProject.startsWith("..") || inProject === "" ? absolute : inProject;
    const display = absolute.split("/").slice(-3).join("/");
    const program = asAst(context.sourceCode.ast);
    const body = list(program, "body");

    /**
     * `apiRoute(...)` from `@shadow-js/dusk/server` (or `ns.apiRoute(...)`): the default export of an
     * API route (see the router contract).
     */
    const isDuskApiRoute = (node: AstNode): boolean => {
      if (node.type !== "CallExpression") return false;
      const callee = at(node, "callee");
      if (callee === null) return false;
      const target = unwrap(callee);
      if (target.type === "Identifier") {
        const variable = resolveVariable(context, target);
        const origin = variable === null ? null : importOf(variable);
        return origin !== null && origin.source === DUSK_SERVER && origin.imported === "apiRoute";
      }
      if (target.type !== "MemberExpression" || Reflect.get(target, "computed") === true)
        return false;
      const object = at(target, "object");
      const property = at(target, "property");
      if (object === null || property === null || object.type !== "Identifier") return false;
      if (identName(property) !== "apiRoute") return false;
      const variable = resolveVariable(context, object);
      const origin = variable === null ? null : importOf(variable);
      return origin !== null && origin.source === DUSK_SERVER && origin.imported === "*";
    };

    /**
     * A file whose default export is `apiRoute(...)`, or that has HTTP-method exports and no default
     * export, is an API route (see the router contract).
     */
    const isApiRoute = (): boolean => {
      const defaultExport = body.find((statement) => statement.type === "ExportDefaultDeclaration");
      if (defaultExport !== undefined) {
        const declaration = at(defaultExport, "declaration");
        return declaration !== null && isDuskApiRoute(unwrap(declaration));
      }
      return body.some((statement) => {
        if (statement.type !== "ExportNamedDeclaration") return false;
        const declaration = at(statement, "declaration");
        if (declaration === null) return false;
        if (declaration.type === "FunctionDeclaration") {
          return HTTP_METHODS.has(identName(at(declaration, "id")) ?? "");
        }
        return (
          declaration.type === "VariableDeclaration" &&
          list(declaration, "declarations").some((declarator) =>
            HTTP_METHODS.has(identName(at(declarator, "id")) ?? ""),
          )
        );
      });
    };
    if (serverFiles.some((pattern) => pattern.test(file))) return {};
    if (hasUseServerDirective(body) || isApiRoute()) return {};

    // The router splits the pages under `routes/` and keeps only what their exports use.
    const reach = analyzeClientReach(
      context,
      /(^|\/)routes\//.test(file) && isSplitRouteModule(program),
    );
    // `src/server/<name>.ts` without server functions is imported by server code only, as far as
    // one file can tell; with them, routes import it and the build checks what is left.
    if (!generic && !reach.hasServerFunctions && /(^|\/)server\//.test(file)) return {};

    const isServerOnly = (specifier: string): boolean =>
      serverImports.some((pattern) => pattern.test(specifier)) &&
      !allowed.some((pattern) => pattern.test(specifier));

    const sourceOf = (node: AstNode): string | undefined => {
      const source = at(node, "source");
      const value: unknown = source === null ? undefined : Reflect.get(source, "value");
      return typeof value === "string" ? value : undefined;
    };

    const report = (node: AstNode, source: string): void => {
      context.report({ node, messageId: "serverOnly", data: { source, file: display } });
    };

    /**
     * `import { type A }`, `import type`, `export { type A } from` or `export type { A } from`: erased
     * at build time. An empty `export {} from` is not type-only: it keeps the module.
     */
    const isTypeOnly = (node: AstNode): boolean => {
      const kindOf = (item: AstNode): string | undefined =>
        str(item, "importKind") ?? str(item, "exportKind");
      if (kindOf(node) === "type") return true;
      const specifiers = list(node, "specifiers");
      return specifiers.length > 0 && specifiers.every((s) => kindOf(s) === "type");
    };

    /**
     * True when every use of the import is in a type position (erased by the TypeScript
     * transform), which leaves nothing for the browser.
     */
    const usedOnlyAsType = (node: AstNode): boolean => {
      const specifiers = list(node, "specifiers");
      if (specifiers.length === 0) return false;
      return specifiers.every((specifier) => {
        const local = at(specifier, "local");
        const variable = local === null ? null : resolveVariable(context, local);
        if (variable === null) return false;
        const uses = variable.references.filter(
          (reference) => (reference.identifier as unknown) !== local,
        );
        return (
          uses.length > 0 &&
          uses.every((reference) => {
            if (Reflect.get(reference, "isValueReference") === false) return true;
            for (
              let current = asAst(reference.identifier).parent;
              current !== null;
              current = current.parent
            ) {
              if (current.type === "TSTypeQuery") return true;
              if (current === program) return false;
            }
            return false;
          })
        );
      });
    };

    return {
      ImportDeclaration(node) {
        const specifier = sourceOf(node);
        if (specifier === undefined || !isServerOnly(specifier)) return;
        if (isTypeOnly(node) || usedOnlyAsType(node)) return;
        if (!reach.importSurvives(node)) return;
        report(node, specifier);
      },
      ExportNamedDeclaration(node) {
        const specifier = sourceOf(node);
        if (specifier === undefined || !isServerOnly(specifier)) return;
        if (isTypeOnly(node)) return;
        report(node, specifier);
      },
      ExportAllDeclaration(node) {
        const specifier = sourceOf(node);
        if (specifier === undefined || !isServerOnly(specifier)) return;
        if (str(node, "exportKind") === "type") return;
        report(node, specifier);
      },
      ImportExpression(node) {
        const specifier = sourceOf(node);
        if (specifier === undefined || !isServerOnly(specifier)) return;
        if (!reach.survives(node)) return;
        report(node, specifier);
      },
      CallExpression(node) {
        const callee = at(node, "callee");
        if (callee === null || callee.type !== "Identifier" || str(callee, "name") !== "require")
          return;
        const argument = list(node, "arguments")[0];
        const specifier = argument === undefined ? undefined : Reflect.get(argument, "value");
        if (typeof specifier !== "string" || !isServerOnly(specifier)) return;
        // A local `require` binding is not Node's.
        const binding = resolveVariable(context, callee);
        if (binding !== null && binding.defs.length > 0) return;
        if (!reach.survives(node)) return;
        report(node, specifier);
      },
    };
  },
});
