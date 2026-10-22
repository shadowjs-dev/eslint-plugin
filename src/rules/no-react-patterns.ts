import type { Rule, Scope } from "eslint";
import { type Foreign, RENAMED, SAME_NAME, UNSUPPORTED } from "../data/foreign";
import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, asAst, at, identName, list, str, unwrap } from "../utils/ast";
import {
  applyEdits,
  type Edit,
  ensureImports,
  moveImportEdits,
  readsToCalls,
  removeSpecifierEdit,
} from "../utils/fixes";
import { isIntrinsicTag, jsxAttributeExpression, jsxAttributeName, jsxTagName } from "../utils/jsx";
import { memberName } from "../utils/reactive";
import { importOf, resolveVariable, shadowApiName } from "../utils/scope";

const SOURCES: Record<Foreign, RegExp> = {
  react: /^react(?:-dom)?(?:\/.*)?$/,
  solid: /^solid-js(?:\/.*)?$/,
};

interface Options {
  frameworks?: Foreign[];
}

/**
 * Input types whose React `onChange` is already the committed `change` event (the same in Solid).
 * Mirrors `CHANGE_ON_TYPES` in the compiler (`packages/compiler/src/internal/react-names.ts`).
 */
const COMMITTED_INPUT_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio", "file"]);

/**
 * How an element's `onChange` event behaves: per edit (`text`), committed (`change`), or unknown
 * because the `type` is a dynamic expression (`unknown`, reported: the rename is harmless for a checkbox).
 */
type ControlKind = "text" | "change" | "unknown";

/** A call or reference resolved to a name exported by a foreign framework. */
interface ForeignRef {
  framework: Foreign;
  /** The exported name (`useState`). */
  name: string;
  /** The module it was imported from (`react`). */
  source: string;
  /** `shadow` when the name already comes from `@shadow-js/*` (a dependency array left behind). */
  origin: "foreign" | "shadow";
}

function targetOf(framework: Foreign, name: string): string | undefined {
  return SAME_NAME[framework][name];
}

/**
 * Flag React (and optionally Solid) APIs and JSX habits that ShadowJS does differently.
 *
 * What it catches and why: code ported from React keeps working as text but means something else.
 * Components run once, so there is no re-render and no dependency array, and `useState` becomes a
 * signal whose value is read with a call. The rule only looks at names imported from `react` /
 * `react-dom` (and `solid-js` when enabled), including `React.x` through a default or namespace
 * import, so a local function named `useState` is left alone. It reports:
 * - `useState` (becomes `useSignal`), `useMemo` (its value becomes an accessor), dependency arrays
 *   of `useEffect` / `useLayoutEffect` / `useMemo` (also one left behind after the import moved to
 *   `@shadow-js/core`; `[]` means `onMount`), `useCallback` and `memo` (not needed);
 * - APIs renamed in ShadowJS (`useLayoutEffect` to `useRenderEffect`, `useSyncExternalStore` to
 *   `useExternalStore`, `useEffectEvent` to `useEvent`, `useActionState` to `useAction`, and the
 *   Solid `createSignal` / `createEffect` / `createMemo` family to its `use*` equivalents);
 * - imports of APIs that ShadowJS has under the same name in `@shadow-js/core` or `@shadow-js/web`,
 *   imports left unused by the other fixes, and APIs with no equivalent (`useRef`, `forwardRef`,
 *   `useInsertionEffect`, ...) with the recipe to use instead;
 * - on DOM elements, `key` (it writes nothing; lists are keyed with `<For key>`) and `className` /
 *   `htmlFor` (the HTML spelling is preferred).
 *
 * React spellings that the compiler keeps with React's meaning (DEC-REACT-NAMES) are not reported:
 * `onChange` on a text input (per edit, as
 * in React), `defaultValue` / `defaultChecked`, and `key` on a component (passed as a prop).
 *
 * One `onChange` does change meaning: Solid's is the native `change` event, which a text input fires
 * when the value is committed (blur or Enter). ShadowJS's `onChange` on a text input or a textarea is
 * per edit, so a ported Solid form would update on every keystroke. Where the code is Solid code
 * (every file when only `solid` is listed; with `react` too, a file that imports `solid-js` and no
 * React module), the rule reports such an element once. The fix renames the attribute to `onchange`,
 * the lower-case native event, which is Solid's behavior. A checkbox, radio, file or select already
 * means `change` in both, so it is not reported.
 *
 * Incorrect:
 *
 * ```tsx
 * import { useState, useEffect } from 'react';
 * const [count, setCount] = useState(0);
 * useEffect(() => { document.title = String(count); }, [count]);
 * ```
 *
 * ```tsx
 * <label htmlFor="name" className="field">Name</label>
 * ```
 *
 * ```tsx
 * <ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>
 * ```
 *
 * ```tsx
 * import { useCallback } from 'react';
 * const handler = useCallback(() => save(id), [id]);
 * ```
 *
 * Correct:
 *
 * ```tsx
 * import { useSignal, useEffect } from '@shadow-js/core';
 * const [count, setCount] = useSignal(0);
 * useEffect(() => { document.title = String(count()); });
 * ```
 *
 * ```tsx
 * <label for="name" class="field">Name</label>
 * ```
 *
 * ```tsx
 * <ul><For each={items()} key={(i) => i.id}>{(i) => <li>{i().name}</li>}</For></ul>
 * ```
 *
 * ```tsx
 * const handler = () => save(id);
 * ```
 *
 * Options: one object.
 * - `frameworks` (array of `"react"` and `"solid"`, unique, default `["react"]`): the libraries
 *   whose imports are checked. The `key`, `className` and `htmlFor` checks run only when `"react"` is
 *   listed; the Solid `onChange` check runs when `"solid"` is listed (see above).
 *
 * Autofix: the fixes rename hooks to their ShadowJS names (`useState` to `useSignal` with every
 * read of the value turned into a call, `useLayoutEffect` to `useRenderEffect`, Solid `createX`
 * hooks to their `use*` equivalents), drop dependency arrays (`useEffect(fn, [])` becomes
 * `onMount(fn)`), unwrap `useCallback(fn)` and `memo(fn)`, turn `useMemo` reads into calls, rename
 * `className` / `htmlFor` on DOM elements, move same-name imports to `@shadow-js/*` and remove imports that are no longer
 * used. They apply over several ESLint passes. A fix is withheld when the needed name is already
 * bound to something else, when a `useState` / `useMemo` value is reassigned or not stored in a
 * plain variable, and for Solid `createEffect(on(...))`. `key` on a DOM element gets a suggestion
 * that removes the attribute. APIs without an equivalent are reported with the recipe and not fixed.
 *
 * Disabling: `// eslint-disable-next-line shadow/no-react-patterns` above the line, or a block
 * between `/* eslint-disable shadow/no-react-patterns *\/` and
 * `/* eslint-enable shadow/no-react-patterns *\/`. A disable is legitimate for code that must keep
 * running under React or Solid as well (shared components, a compatibility layer), where the
 * foreign API is intended.
 *
 * Configs:
 * - `recommended`: off
 * - `strict`: `error`
 * - `migration`: `error` with `{ frameworks: ["react", "solid"] }`
 * - `dusk`: off
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   { rules: { "shadow/no-react-patterns": ["error", { frameworks: ["react", "solid"] }] } },
 * ];
 * ```
 * @since 1.0.0
 */
export const noReactPatterns: ShadowRule = defineRule({
  name: "no-react-patterns",
  id: "ESL-09",
  type: "suggestion",
  description:
    "Flag React (and optionally Solid) APIs and JSX habits that ShadowJS does differently.",
  recommended: false,
  rationale:
    "Code ported from React keeps working as text but means something else: components run once, so there is no " +
    "re-render and no dependency array; `useState` becomes a signal with an accessor; `key` on an element does " +
    "nothing (lists are keyed with `<For key>`). This rule finds those places and rewrites the mechanical ones. " +
    "React spellings that keep React's meaning (`onChange` on a text input, `defaultValue`, `key` on a component) " +
    "are left alone. Solid's `onChange` on a text input is the committed change, which ShadowJS spells `onchange`: " +
    "Solid code that uses it is reported once and renamed. Enable `frameworks: ['react', 'solid']` (the migration " +
    "config does) to port Solid code too.",
  examples: {
    incorrect: [
      "import { useState, useEffect } from 'react';\nconst [count, setCount] = useState(0);\nuseEffect(() => { document.title = String(count); }, [count]);",
      '<label htmlFor="name" className="field">Name</label>',
      "<ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>",
      "import { useCallback } from 'react';\nconst handler = useCallback(() => save(id), [id]);",
    ],
    correct: [
      "import { useSignal, useEffect } from '@shadow-js/core';\nconst [count, setCount] = useSignal(0);\nuseEffect(() => { document.title = String(count()); });",
      '<label for="name" class="field">Name</label>',
      "<ul><For each={items()} key={(i) => i.id}>{(i) => <li>{i().name}</li>}</For></ul>",
      "const handler = () => save(id);",
    ],
  },
  notes: [
    "Autofixes: `useState` to `useSignal` (reads become calls), dependency arrays removed (`[]` becomes `onMount`), `useLayoutEffect` to `useRenderEffect`, `useCallback`/`memo` unwrapped, `className`/`htmlFor` renamed, imports moved to `@shadow-js/*` and the old import removed once unused. Fixes apply over several ESLint passes.",
    "`key` on an element is a suggestion: removing it changes nothing at run time, but the list may need `<For key>`.",
    "`onChange` on a text input or a textarea is per edit in ShadowJS, as in React. Solid's `onChange` is committed on change: with `frameworks: ['solid']`, or a file that imports `solid-js` and no React module when both are listed, it is reported once and the fix renames it to `onchange`. Use `onInput` to keep per-edit updates.",
    "Only names imported from `react`, `react-dom` (or `solid-js`) are checked: a local function named `useState` is left alone.",
    "Option `frameworks` (default `['react']`) selects which libraries are checked; Solid names are renamed one to one (`createSignal` to `useSignal`).",
  ],
  fix: "Solid `onChange` on a text input is renamed to `onchange` (the native change event, Solid's meaning), unless the element has a second `onChange` or already has `onchange`. Other fixes rename hooks to their ShadowJS names (`useState` to `useSignal` with every read of the value turned into a call, `useLayoutEffect` to `useRenderEffect`, Solid `createX` hooks to their `use*` equivalents), drop dependency arrays (`useEffect(fn, [])` becomes `onMount(fn)`), unwrap `useCallback(fn)` and `memo(fn)`, turn `useMemo` reads into calls, rename `className`/`htmlFor` on DOM elements, move same-name imports to `@shadow-js/*` and remove imports that are no longer used. A fix is withheld when the needed name is already bound to something else, when a `useState`/`useMemo` value is reassigned or not stored in a plain variable, and for `createEffect(on(...))`. The `key` suggestion removes the attribute from a DOM element. APIs without an equivalent are reported with the recipe and not fixed.",
  disableWhen:
    "Disable it for code that must keep running under React or Solid as well (shared components, a compatibility layer), where the foreign API is intended.",
  fixable: "code",
  hasSuggestions: true,
  schema: [
    {
      type: "object",
      properties: {
        frameworks: { type: "array", items: { enum: ["react", "solid"] }, uniqueItems: true },
      },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{ frameworks: ["react"] }],
  messages: {
    foreignImport: "`{{name}}` comes from `{{source}}`. ShadowJS has the same API in `{{target}}`.",
    unusedImport: "`{{name}}` from `{{source}}` is no longer used. Remove the import.",
    noEquivalent: "`{{name}}` has no ShadowJS equivalent: {{hint}}.",
    state:
      "`useState` becomes `useSignal`: the first value is an accessor (`count()`), and components run once so nothing re-renders.",
    renamed: "`{{from}}` is `{{to}}` in ShadowJS.",
    memoAccessor:
      "`useMemo` returns an accessor in ShadowJS: read the value as `value()`. The dependency array is not needed.",
    dependencyArray:
      "ShadowJS tracks dependencies automatically. Remove the dependency array of `{{name}}`.",
    emptyDeps: "`{{name}}(fn, [])` runs once: that is `onMount(fn)` in ShadowJS.",
    useCallback:
      "Components run once, so functions are already stable: `useCallback` is not needed.",
    memo: "Components run once, so `memo` is not needed.",
    className: "Prefer `class` to `className`.",
    htmlFor: "Prefer `for` to `htmlFor`.",
    key: "`key` is not a DOM attribute here and does nothing on <{{tag}}>. Use `<For key={...}>` for lists.",
    removeKey: "Remove the `key` attribute.",
    solidChange:
      "`onChange` on this {{tag}} runs on every edit in ShadowJS, but Solid's `onChange` runs when the value is committed. Use `onchange` (the native change event, as in Solid) or `onInput` (every edit).",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const frameworks: readonly Foreign[] = options.frameworks ?? ["react"];
    const text = context.sourceCode.text;

    // Which code is Solid code for the `onChange` check. The file's imports decide when React is
    // checked too: a React file's `onChange` on a text input keeps React's per-edit meaning.
    const importedSources = list(asAst(context.sourceCode.ast), "body").flatMap((statement) => {
      if (statement.type !== "ImportDeclaration") return [];
      const source = at(statement, "source");
      const value = source === null ? undefined : Reflect.get(source, "value");
      return typeof value === "string" ? [value] : [];
    });
    const importsReact = importedSources.some((source) => SOURCES.react.test(source));
    const importsSolid = importedSources.some((source) => SOURCES.solid.test(source));
    const solidCode =
      frameworks.includes("solid") &&
      (!frameworks.includes("react") || (importsSolid && !importsReact));

    /** The framework an import source belongs to, if enabled. */
    const frameworkOf = (source: string): Foreign | null => {
      for (const framework of frameworks) if (SOURCES[framework].test(source)) return framework;
      return null;
    };

    /** Resolves an identifier or `React.x` member to a foreign export. */
    const foreignRef = (node: AstNode): ForeignRef | null => {
      if (node.type === "Identifier") {
        const variable = resolveVariable(context, node);
        if (variable === null) return null;
        const origin = importOf(variable);
        if (origin === null) return null;
        const framework = frameworkOf(origin.source);
        if (framework === null || origin.imported === "default" || origin.imported === "*")
          return null;
        return { framework, name: origin.imported, source: origin.source, origin: "foreign" };
      }
      if (node.type === "MemberExpression") {
        const object = at(node, "object");
        const name = memberName(node);
        if (object === null || object.type !== "Identifier" || name === undefined) return null;
        const variable = resolveVariable(context, object);
        if (variable === null) return null;
        const origin = importOf(variable);
        if (origin === null) return null;
        const framework = frameworkOf(origin.source);
        if (framework === null) return null;
        if (origin.imported !== "default" && origin.imported !== "*") return null;
        return { framework, name, source: origin.source, origin: "foreign" };
      }
      return null;
    };

    /** Edits that make a renamed API available and replace the callee text. */
    const renameEdits = (callee: AstNode, to: string, module: string): Edit[] | null => {
      const imports = ensureImports(context, [{ name: to, source: module }]);
      if (imports === null) return null;
      return [...imports, { range: callee.range, text: to }];
    };

    const fixWith = (edits: Edit[] | null): { fix: Rule.ReportFixer } | Record<string, never> =>
      edits === null ? {} : { fix: (fixer: Rule.RuleFixer) => applyEdits(fixer, edits) };

    /** Removes `, deps` (the second argument) from a call. */
    const dropSecondArgument = (call: AstNode): Edit | null => {
      const args = list(call, "arguments");
      const first = args[0];
      const second = args[1];
      if (first === undefined || second === undefined) return null;
      const last = args[args.length - 1];
      if (last === undefined) return null;
      return { range: [first.range[1], last.range[1]], text: "" };
    };

    const checkCall = (call: AstNode): void => {
      const callee = at(call, "callee");
      if (callee === null) return;
      const args = list(call, "arguments");
      let ref = foreignRef(callee);
      if (ref === null) {
        // A dependency array can stay behind after the import was already moved to ShadowJS.
        const api = shadowApiName(context, callee);
        const second = args[1];
        if (
          frameworks.includes("react") &&
          (api === "useEffect" || api === "useMemo") &&
          second !== undefined &&
          unwrap(second).type === "ArrayExpression"
        ) {
          ref = { framework: "react", name: api, source: "@shadow-js/core", origin: "shadow" };
        } else {
          return;
        }
      }
      const { framework, name } = ref;
      const declarator =
        call.parent !== null && call.parent.type === "VariableDeclarator" ? call.parent : null;

      // ---- React ----
      if (framework === "react") {
        if (name === "useState") {
          const id = declarator === null ? null : at(declarator, "id");
          const first =
            id !== null && id.type === "ArrayPattern" ? list(id, "elements")[0] : undefined;
          let edits: Edit[] | null = null;
          if (first !== undefined && first.type === "Identifier") {
            const variable = resolveVariable(context, first);
            const reads = variable === null ? null : readsToCalls(variable);
            const renamed = renameEdits(callee, "useSignal", "@shadow-js/core");
            if (reads !== null && renamed !== null) edits = [...renamed, ...reads];
          }
          context.report({ node: call, messageId: "state", ...fixWith(edits) });
          return;
        }
        if (name === "useEffect" || name === "useLayoutEffect") {
          const deps = args[1];
          if (deps === undefined || unwrap(deps).type !== "ArrayExpression") {
            if (name === "useEffect") return;
            // `useLayoutEffect(fn)` goes on to the RENAMED table below (`useRenderEffect`,
            // DEC-CALLBACK).
          } else {
            const empty = list(unwrap(deps), "elements").length === 0;
            const drop = dropSecondArgument(call);
            if (empty) {
              const renamed = renameEdits(callee, "onMount", "@shadow-js/core");
              context.report({
                node: deps,
                messageId: "emptyDeps",
                data: { name },
                ...fixWith(renamed === null || drop === null ? null : [...renamed, drop]),
              });
            } else {
              const renamed =
                name === "useLayoutEffect"
                  ? renameEdits(callee, "useRenderEffect", "@shadow-js/core")
                  : [];
              context.report({
                node: deps,
                messageId: "dependencyArray",
                data: { name },
                ...fixWith(renamed === null || drop === null ? null : [...renamed, drop]),
              });
            }
            return;
          }
        }
        if (name === "useMemo" && ref.origin === "shadow") {
          const drop = dropSecondArgument(call);
          context.report({
            node: args[1] ?? call,
            messageId: "dependencyArray",
            data: { name },
            ...fixWith(drop === null ? null : [drop]),
          });
          return;
        }
        if (name === "useMemo") {
          const edits: Edit[] = [];
          const drop = args[1] === undefined ? null : dropSecondArgument(call);
          if (drop !== null) edits.push(drop);
          let ok = true;
          if (declarator !== null) {
            const id = at(declarator, "id");
            const variable = id === null ? null : resolveVariable(context, id);
            const reads = variable === null ? null : readsToCalls(variable);
            if (reads === null) ok = false;
            else edits.push(...reads);
          } else {
            ok = false;
          }
          context.report({ node: call, messageId: "memoAccessor", ...fixWith(ok ? edits : null) });
          return;
        }
        if (name === "useCallback") {
          const first = args[0];
          context.report({
            node: call,
            messageId: "useCallback",
            ...fixWith(
              first === undefined
                ? null
                : [{ range: call.range, text: text.slice(...first.range) }],
            ),
          });
          return;
        }
        if (name === "memo") {
          const first = args[0];
          context.report({
            node: call,
            messageId: "memo",
            ...fixWith(
              first === undefined
                ? null
                : [{ range: call.range, text: text.slice(...first.range) }],
            ),
          });
          return;
        }
      }

      // ---- renamed APIs (React useState handled above; Solid createX) ----
      const renamedTo = RENAMED[framework][name];
      if (renamedTo !== undefined) {
        // `createEffect(on(dep, fn))` has no direct translation; leave the call for a human.
        const firstArgument = args[0];
        const firstCallee =
          firstArgument !== undefined && firstArgument.type === "CallExpression"
            ? at(firstArgument, "callee")
            : null;
        const usesOn = firstCallee !== null && foreignRef(firstCallee)?.name === "on";
        const renamed = usesOn ? null : renameEdits(callee, renamedTo.name, renamedTo.module);
        context.report({
          node: callee,
          messageId: "renamed",
          data: { from: name, to: renamedTo.name },
          ...fixWith(renamed),
        });
        return;
      }

      const hint = UNSUPPORTED[framework][name];
      if (hint !== undefined) {
        context.report({ node: callee, messageId: "noEquivalent", data: { name, hint } });
      }
    };

    /** Reports an import specifier: moved, unused, or unsupported. */
    const checkImport = (declaration: AstNode): void => {
      const sourceNode = at(declaration, "source");
      const source = sourceNode === null ? undefined : Reflect.get(sourceNode, "value");
      if (typeof source !== "string") return;
      const framework = frameworkOf(source);
      if (framework === null) return;
      if (str(declaration, "importKind") === "type") return;
      for (const specifier of list(declaration, "specifiers")) {
        if (str(specifier, "importKind") === "type") continue;
        const local = at(specifier, "local");
        if (local === null) continue;
        const variable = resolveVariable(context, local);
        const referenced = variable === null ? [] : usages(variable, local);
        const imported =
          specifier.type === "ImportSpecifier"
            ? (identName(at(specifier, "imported")) ??
              str(at(specifier, "imported") ?? specifier, "value"))
            : undefined;
        const display = imported ?? identName(local) ?? "default";

        if (referenced.length === 0) {
          const removal = removeSpecifierEdit(context, specifier);
          context.report({
            node: specifier,
            messageId: "unusedImport",
            data: { name: display, source },
            ...fixWith(removal === null ? null : [removal]),
          });
          continue;
        }
        if (imported === undefined) continue;
        const target = targetOf(framework, imported);
        if (target !== undefined && identName(local) === imported) {
          context.report({
            node: specifier,
            messageId: "foreignImport",
            data: { name: imported, source, target },
            ...fixWith(moveImportEdits(context, specifier, imported, target, source)),
          });
        }
      }
    };

    const usages = (variable: Scope.Variable, declared: AstNode): AstNode[] =>
      variable.references
        .map((reference) => asAst(reference.identifier))
        .filter((identifier) => identifier !== declared);

    const tagOfAttribute = (attribute: AstNode): string | undefined => {
      const opening = attribute.parent;
      return opening === null ? undefined : jsxTagName(opening);
    };

    /** How an element's `type` attribute classifies the `onChange` event (see {@link ControlKind}). */
    const controlKind = (tag: string, attributes: readonly AstNode[]): ControlKind => {
      if (tag === "textarea") return "text";
      if (tag !== "input") return "change";
      const typeAttribute = attributes.find(
        (attribute) => attribute.type === "JSXAttribute" && jsxAttributeName(attribute) === "type",
      );
      if (typeAttribute === undefined) return "text";
      const value = jsxAttributeExpression(typeAttribute);
      if (value === null) return "text";
      const literal = Reflect.get(value, "value");
      if (value.type !== "Literal" || typeof literal !== "string") return "unknown";
      return COMMITTED_INPUT_TYPES.has(literal.toLowerCase()) ? "change" : "text";
    };

    /**
     * One report per element. The rename is withheld when the element has a second `onChange` or
     * already has `onchange`: the renamed attribute would then be a duplicate.
     */
    const checkElement = (opening: AstNode): void => {
      if (!solidCode) return;
      const tag = jsxTagName(opening);
      if (tag === undefined || !isIntrinsicTag(tag)) return;
      const attributes = list(opening, "attributes");
      const handlers = attributes.filter(
        (attribute) =>
          attribute.type === "JSXAttribute" && jsxAttributeName(attribute) === "onChange",
      );
      const first = handlers[0];
      if (first === undefined || controlKind(tag, attributes) === "change") return;
      const alreadyLower = attributes.some(
        (attribute) =>
          attribute.type === "JSXAttribute" && jsxAttributeName(attribute) === "onchange",
      );
      const nameNode = handlers.length === 1 && !alreadyLower ? at(first, "name") : null;
      context.report({
        node: first,
        messageId: "solidChange",
        data: { tag },
        ...(nameNode === null
          ? {}
          : { fix: (fixer: Rule.RuleFixer) => fixer.replaceTextRange(nameNode.range, "onchange") }),
      });
    };

    const checkAttribute = (attribute: AstNode): void => {
      if (!frameworks.includes("react")) return;
      const name = jsxAttributeName(attribute);
      const tag = tagOfAttribute(attribute);
      if (name === undefined || tag === undefined) return;
      const nameNode = at(attribute, "name");
      // Only DOM elements: a component receives `key`, `className` and `htmlFor` as ordinary props
      // (DEC-REACT-NAMES).
      const intrinsic = /^[a-z]/.test(tag) && !tag.includes(".");
      if (!intrinsic || nameNode === null) return;

      if (name === "key") {
        let start = attribute.range[0];
        while (start > 0 && /\s/.test(text[start - 1] ?? "")) start -= 1;
        context.report({
          node: attribute,
          messageId: "key",
          data: { tag },
          suggest: [
            {
              messageId: "removeKey",
              fix: (fixer) => fixer.removeRange([start, attribute.range[1]]),
            },
          ],
        });
        return;
      }
      // `onChange` on a text input and `defaultValue` / `defaultChecked` keep React's meaning in
      // ShadowJS (DEC-REACT-NAMES), so they are not reported.
      if (name === "className" || name === "htmlFor") {
        const replacement = name === "className" ? "class" : "for";
        context.report({
          node: attribute,
          messageId: name === "className" ? "className" : "htmlFor",
          fix: (fixer) => fixer.replaceTextRange(nameNode.range, replacement),
        });
      }
    };

    return {
      ImportDeclaration: checkImport,
      CallExpression: checkCall,
      JSXAttribute: checkAttribute,
      JSXOpeningElement: checkElement,
    };
  },
});
