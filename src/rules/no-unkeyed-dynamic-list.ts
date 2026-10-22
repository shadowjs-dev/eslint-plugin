import type { Rule } from "eslint";
import { defineRule, type ShadowRule } from "../rule";
import {
  type AstNode,
  asAst,
  at,
  identName,
  isFunction,
  isJsx,
  isWrapper,
  list,
  someInFunction,
  unwrap,
} from "../utils/ast";
import { applyEdits, type Edit, ensureImports, sliceWithEdits } from "../utils/fixes";
import { jsxAttributeName } from "../utils/jsx";
import { memberName, reactiveModel, readsReactive } from "../utils/reactive";
import { resolveVariable } from "../utils/scope";

/** `[1, 2].map`, `Array.from({ length: n }).map`, `Array(n).fill(0).map`: fixed, not data-driven. */
function isStaticReceiver(node: AstNode): boolean {
  const value = unwrap(node);
  if (value.type === "ArrayExpression") return true;
  if (value.type === "CallExpression" || value.type === "NewExpression") {
    const callee = at(value, "callee");
    if (callee === null) return false;
    if (callee.type === "Identifier") return identName(callee) === "Array";
    if (callee.type === "MemberExpression") {
      const object = at(callee, "object");
      const name = memberName(callee);
      if (object !== null && identName(object) === "Array") return name === "from" || name === "of";
      // `Array(n).fill(0)`
      if (name === "fill" || name === "keys") return object !== null && isStaticReceiver(object);
    }
  }
  return false;
}

/**
 * Prefer `<For>` over `.map()` for lists rendered in JSX.
 *
 * What it catches and why: `{items().map(...)}` is one reactive expression. Whenever the list
 * changes it runs the callback again for every item, so every row is rebuilt, DOM state (focus,
 * scroll, input text) is lost and the cost grows with the list. `<For>` keeps one row per item (or
 * per key) and only creates, moves or removes the rows that changed. The rule reports a `.map()`
 * call whose callback returns JSX and that is rendered directly as a JSX child. By default it
 * reports only lists that can change: the receiver must read a signal or memo accessor, a store,
 * the component's props (destructured or not), or a constant derived from them, the same reads
 * forgiving reactivity keeps live. Lists of fixed size (`[a, b].map`,
 * `Array.from({ length: 3 }).map`, `Array(n).fill(0).map`) are never reported, and neither is a
 * `.map()` in an attribute value or outside JSX.
 *
 * Incorrect:
 *
 * ```tsx
 * const [todos] = useSignal([]);
 * const list = <ul>{todos().map((todo) => <li>{todo.title}</li>)}</ul>;
 * ```
 *
 * ```tsx
 * const [rows] = useSignal([]);
 * const list = <ul>{rows().map((row) => <li key={row.id}>{row.name}</li>)}</ul>;
 * ```
 *
 * Correct:
 *
 * ```tsx
 * const [todos] = useSignal([]);
 * const list = <ul><For each={todos()}>{(todo) => <li>{todo.title}</li>}</For></ul>;
 * ```
 *
 * ```tsx
 * const [rows] = useSignal([]);
 * const list = <ul><For each={rows()} key={(row) => row.id}>{(row) => <li>{row().name}</li>}</For></ul>;
 * ```
 *
 * ```tsx
 * <ul>{[1, 2, 3].map((n) => <li>{n}</li>)}</ul>
 * ```
 *
 * Options: one object.
 * - `reactiveOnly` (boolean, default `true`): report only `.map()` over a list that can change.
 *   Set it to `false` to report every `.map()` rendered as a JSX child, except lists of fixed size.
 *
 * Autofix: no autofix; a suggestion rewrites `{list.map(callback)}` to
 * `<For each={list}>{callback}</For>` and adds the `For` import from `@shadow-js/web` when it is
 * missing. The index parameter becomes an accessor (`i` to `i()`). A `key` attribute on the row's
 * root element becomes the `key` function of `<For>`, and the item parameter then becomes an
 * accessor too (`row` to `row()`). The suggestion is withheld when the callback is not an arrow
 * function, the call is an optional chain, a parameter is destructured or reassigned, there are
 * more than two parameters, the callback body is not a single JSX element (or a block holding only
 * `return <element />`), the `key` uses the index, or a comment sits inside the call outside the
 * callback (the rewrite would delete it).
 *
 * Disabling: `// eslint-disable-next-line shadow/no-unkeyed-dynamic-list` for one line, or a block
 * between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/no-unkeyed-dynamic-list *\/
 * /* eslint-enable shadow/no-unkeyed-dynamic-list *\/
 * ```
 *
 * A disable is legitimate when rebuilding every row is intended, for example a short list whose
 * rows hold no state and are always replaced together.
 *
 * Configs:
 * - `recommended`: `"warn"`
 * - `strict`: `"error"`
 * - `migration`: `"warn"`
 * - `dusk`: `"warn"`
 *
 * @example
 * ```ts
 * import shadow from "@shadow-js/eslint-plugin";
 *
 * export default [
 *   shadow.configs.recommended,
 *   { rules: { "shadow/no-unkeyed-dynamic-list": ["error", { reactiveOnly: false }] } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/no-unkeyed-dynamic-list.md
 */
export const noUnkeyedDynamicList: ShadowRule = defineRule({
  name: "no-unkeyed-dynamic-list",
  id: "ESL-14",
  type: "suggestion",
  description: "Prefer `<For>` over `.map()` for lists rendered in JSX.",
  recommended: true,
  rationale:
    "`{items().map(...)}` re-runs the callback for every item whenever the list changes: all rows are rebuilt, " +
    "DOM state (focus, scroll, input text) is lost and the cost grows with the list. `<For>` keeps a row per " +
    "item (or per key) and only creates, moves or removes the rows that changed.",
  examples: {
    incorrect: [
      "const [todos] = useSignal([]);\nconst list = <ul>{todos().map((todo) => <li>{todo.title}</li>)}</ul>;",
      "const [rows] = useSignal([]);\nconst list = <ul>{rows().map((row) => <li key={row.id}>{row.name}</li>)}</ul>;",
    ],
    correct: [
      "const [todos] = useSignal([]);\nconst list = <ul><For each={todos()}>{(todo) => <li>{todo.title}</li>}</For></ul>;",
      "const [rows] = useSignal([]);\nconst list = <ul><For each={rows()} key={(row) => row.id}>{(row) => <li>{row().name}</li>}</For></ul>;",
      "<ul>{[1, 2, 3].map((n) => <li>{n}</li>)}</ul>",
    ],
  },
  notes: [
    "Lists of fixed, literal size (`[a, b].map`, `Array.from({ length: 3 }).map`) are not reported.",
    "By default only lists that can change are reported: the receiver must read an accessor, a store, the component's props, or a constant derived from them. `GROUPS.map(...)` over a module constant is fine. Set `reactiveOnly: false` to report every `.map` that renders JSX.",
    "A `key` attribute on the row root becomes the `key` function of `<For>`; the item is then an accessor and the suggestion rewrites `row` to `row()`.",
  ],
  hasSuggestions: true,
  fix:
    "A suggestion (not an autofix) rewrites `{list.map(callback)}` to `<For each={list}>{callback}</For>` " +
    "and adds the `For` import. The index becomes an accessor (`i()`); a `key` attribute on the row root " +
    "becomes the `key` function and the item becomes an accessor (`row()`). It is withheld for " +
    "non-arrow callbacks, optional chains, destructured or reassigned parameters, more than two " +
    "parameters, a body that is not a single JSX element, a `key` that uses the index, or a comment " +
    "outside the callback that the rewrite would delete.",
  disableWhen:
    "When rebuilding every row is intended, for example a short list whose rows hold no state and are " +
    "always replaced together.",
  schema: [
    {
      type: "object",
      properties: { reactiveOnly: { type: "boolean" } },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{ reactiveOnly: true }],
  messages: {
    useFor:
      "`.map()` in JSX rebuilds every row when the list changes and drops row state. Use `<For each={...}>`.",
    convertToFor: "Convert to `<For>`.",
  },
  create(context) {
    const text = context.sourceCode.text;
    const keys = context.sourceCode.visitorKeys;
    const rawOptions: unknown = context.options[0];
    const reactiveOnly =
      typeof rawOptions === "object" && rawOptions !== null
        ? Reflect.get(rawOptions, "reactiveOnly") !== false
        : true;
    const model = reactiveModel(context);

    const returnsJsx = (fn: AstNode): boolean => {
      const body = at(fn, "body");
      if (body === null) return false;
      if (body.type !== "BlockStatement") {
        return someInFunction(body, keys, (node) => isJsx(node) && true);
      }
      return someInFunction(body, keys, (node) => {
        if (node.type !== "ReturnStatement") return false;
        const argument = at(node, "argument");
        return argument !== null && someInFunction(argument, keys, isJsx);
      });
    };

    /** The `{...}` container when the call is rendered as a JSX child. */
    const childContainer = (call: AstNode): AstNode | null => {
      let current: AstNode = call;
      let parent = call.parent;
      while (parent !== null && (isWrapper(parent) || parent.type === "ChainExpression")) {
        current = parent;
        parent = parent.parent;
      }
      if (parent === null || parent.type !== "JSXExpressionContainer") return null;
      if (at(parent, "expression") !== current) return null;
      const owner = parent.parent;
      return owner !== null && (owner.type === "JSXElement" || owner.type === "JSXFragment")
        ? parent
        : null;
    };

    const rowRoot = (fn: AstNode): AstNode | null => {
      const body = at(fn, "body");
      if (body === null) return null;
      if (body.type !== "BlockStatement") {
        const value = unwrap(body);
        return value.type === "JSXElement" ? value : null;
      }
      const statements = list(body, "body");
      const only = statements[0];
      if (statements.length !== 1 || only === undefined || only.type !== "ReturnStatement")
        return null;
      const argument = at(only, "argument");
      const value = argument === null ? null : unwrap(argument);
      return value !== null && value.type === "JSXElement" ? value : null;
    };

    const suggestion = (
      call: AstNode,
      container: AstNode,
      callee: AstNode,
      callback: AstNode,
    ): Rule.SuggestionReportDescriptor[] => {
      if (callback.type !== "ArrowFunctionExpression" || call.parent === null) return [];
      if (call.parent.type === "ChainExpression" || Reflect.get(callee, "optional") === true)
        return [];
      // The rewrite replaces the whole container: a comment outside the callback would be lost.
      const commentLost = context.sourceCode
        .getAllComments()
        .some(
          (comment) =>
            comment.range !== undefined &&
            comment.range[0] >= container.range[0] &&
            comment.range[1] <= container.range[1] &&
            (comment.range[1] <= callback.range[0] || comment.range[0] >= callback.range[1]),
        );
      if (commentLost) return [];
      const params = list(callback, "params");
      if (params.length > 2 || params.some((param) => param.type !== "Identifier")) return [];
      const root = rowRoot(callback);
      const receiver = at(callee, "object");
      const imports = ensureImports(context, [{ name: "For", source: "@shadow-js/web" }]);
      if (root === null || receiver === null || imports === null) return [];
      const [itemParam, indexParam] = params;
      const opening = at(root, "openingElement");
      if (opening === null) return [];
      const keyAttribute = list(opening, "attributes").find(
        (attribute) => attribute.type === "JSXAttribute" && jsxAttributeName(attribute) === "key",
      );
      const keyExpression =
        keyAttribute === undefined
          ? null
          : at(at(keyAttribute, "value") ?? keyAttribute, "expression");
      if (keyAttribute !== undefined && keyExpression === null) return [];

      const edits: Edit[] = [];
      const indexVariable = indexParam === undefined ? null : resolveVariable(context, indexParam);
      const itemVariable = itemParam === undefined ? null : resolveVariable(context, itemParam);
      const collect = (variable: typeof itemVariable, skip: AstNode | undefined): boolean => {
        if (variable === null) return true;
        for (const reference of variable.references) {
          if (reference.init === true) continue;
          if (reference.isWrite()) return false;
          const identifier = asAst(reference.identifier);
          if (
            skip !== undefined &&
            identifier.range[0] >= skip.range[0] &&
            identifier.range[1] <= skip.range[1]
          ) {
            continue;
          }
          const parent = identifier.parent;
          if (parent === null || parent.type.startsWith("TS")) continue;
          const name = identName(identifier) ?? "";
          if (parent.type === "Property" && Reflect.get(parent, "shorthand") === true) {
            edits.push({ range: parent.range, text: `${name}: ${name}()` });
          } else {
            edits.push({ range: identifier.range, text: `${name}()` });
          }
        }
        return true;
      };
      // The index is an accessor in both forms; the item only when the rows are keyed.
      if (!collect(indexVariable, keyAttribute)) return [];
      if (keyAttribute !== undefined && !collect(itemVariable, keyAttribute)) return [];
      if (keyAttribute !== undefined && indexVariable !== null) {
        const usesIndex = indexVariable.references.some((reference) => {
          const identifier = asAst(reference.identifier);
          return (
            identifier.range[0] >= keyAttribute.range[0] &&
            identifier.range[1] <= keyAttribute.range[1]
          );
        });
        if (usesIndex) return [];
      }
      if (keyAttribute !== undefined) {
        let start = keyAttribute.range[0];
        while (start > 0 && /\s/.test(text[start - 1] ?? "")) start -= 1;
        edits.push({ range: [start, keyAttribute.range[1]], text: "" });
      }
      const callbackText = sliceWithEdits(text, callback.range, edits);
      const eachText = text.slice(...receiver.range);
      const keyText =
        keyAttribute === undefined || keyExpression === null || itemParam === undefined
          ? ""
          : ` key={(${identName(itemParam) ?? "item"}) => ${text.slice(...keyExpression.range)}}`;
      const replacement = `<For each={${eachText}}${keyText}>{${callbackText}}</For>`;
      return [
        {
          messageId: "convertToFor",
          fix: (fixer) => [
            ...applyEdits(fixer, imports),
            fixer.replaceTextRange(container.range, replacement),
          ],
        },
      ];
    };

    return {
      CallExpression(node) {
        const callee = at(node, "callee");
        if (callee === null || callee.type !== "MemberExpression") return;
        if (memberName(callee) !== "map") return;
        const callback = list(node, "arguments")[0];
        if (callback === undefined || !isFunction(callback) || !returnsJsx(callback)) return;
        const receiver = at(callee, "object");
        if (receiver === null || isStaticReceiver(receiver)) return;
        if (reactiveOnly && !readsReactive(context, model, receiver, keys)) return;
        const container = childContainer(node);
        if (container === null) return;
        context.report({
          node,
          messageId: "useFor",
          suggest: suggestion(node, container, callee, callback),
        });
      },
    };
  },
});
