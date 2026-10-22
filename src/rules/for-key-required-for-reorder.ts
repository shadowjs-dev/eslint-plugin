import type { Rule } from "eslint";
import { defineRule, type ShadowRule } from "../rule";
import {
  type AstNode,
  asAst,
  at,
  identName,
  isFunction,
  isWrapper,
  list,
  someInFunction,
} from "../utils/ast";
import { applyEdits, readsToCalls } from "../utils/fixes";
import { jsxAttributeName } from "../utils/jsx";
import { memberName, reactiveModel, readsReactive } from "../utils/reactive";
import { resolveVariable, shadowApiName } from "../utils/scope";

const ID_FIELDS = ["id", "_id", "uid", "uuid", "key", "slug"];

/**
 * Require a `key` on `<For>` when items have an identity or the list is rebuilt.
 *
 * What it catches and why: without `key`, `<For>` (from `@shadow-js/web`, or an unbound `For`)
 * matches rows by item reference. When the list is replaced with fresh objects (a refetch, a
 * `.map()` that copies items, a server response), every row is destroyed and recreated: inputs lose
 * focus and local state resets, even though row `7` is still row `7`. A `key` function tells
 * `<For>` which rows are the same, so they are moved and updated instead. The rule reports a
 * `<For>` without `key` (and without a spread that could carry one) when the row callback reads an
 * identity field of its item (`id`, `_id`, `uid`, `uuid`, `key`, `slug`, also through a
 * destructured parameter or a TypeScript assertion such as `(item as Item).id` or `item!.id`), or
 * when `each` is built with `.map(...)`. It stays quiet when `each`
 * reads nothing reactive (a module constant, a literal): such a list is never rebuilt.
 *
 * Incorrect:
 *
 * ```tsx
 * import { useSignal } from '@shadow-js/core';
 * const [todos] = useSignal([{ id: 1, title: 'Write docs' }]);
 * const list = <For each={todos()}>{(todo) => <li>{todo.id}: {todo.title}</li>}</For>;
 * ```
 *
 * ```tsx
 * import { useSignal } from '@shadow-js/core';
 * const [rows] = useSignal([{ id: 1 }]);
 * const [id] = useSignal(1);
 * const table = <For each={rows().map((row) => ({ ...row, selected: row.id === id() }))}>{(row) => <Row row={row} />}</For>;
 * ```
 *
 * Correct:
 *
 * ```tsx
 * import { useSignal } from '@shadow-js/core';
 * const [todos] = useSignal([{ id: 1, title: 'Write docs' }]);
 * const list = <For each={todos()} key={(todo) => todo.id}>{(todo) => <li>{todo().title}</li>}</For>;
 * ```
 *
 * ```tsx
 * import { useSignal } from '@shadow-js/core';
 * const [names] = useSignal(['Ada', 'Grace']);
 * const list = <For each={names()}>{(name) => <li>{name}</li>}</For>;
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: no automatic fix. When the row callback reads an identity field through a plain
 * parameter, the suggestion adds `key={(item) => item.<field>}` after the `For` tag name and
 * rewrites every read of the item to `item()`, because a keyed row receives an accessor. It is
 * withheld when the parameter is destructured, when the report comes from `.map(...)` alone (no
 * identity field to key on), and when the item parameter is reassigned.
 *
 * Disabling: `// eslint-disable-next-line shadow/for-key-required-for-reorder` above the line, or a
 * block between `/* eslint-disable shadow/for-key-required-for-reorder *\/` and
 * `/* eslint-enable shadow/for-key-required-for-reorder *\/`. A disable is legitimate when the
 * items keep their object identity across updates (the same objects are reused), so matching by
 * reference already keeps the rows.
 *
 * Configs:
 * - `recommended`: `warn`
 * - `strict`: `error`
 * - `migration`: `warn`
 * - `dusk`: `warn`
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   { rules: { "shadow/for-key-required-for-reorder": "error" } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/for-key-required-for-reorder.md
 */
export const forKeyRequiredForReorder: ShadowRule = defineRule({
  name: "for-key-required-for-reorder",
  id: "ESL-13",
  type: "suggestion",
  description: "Require a `key` on `<For>` when items have an identity or the list is rebuilt.",
  recommended: true,
  rationale:
    "Without `key`, `<For>` matches rows by item reference. When the list is replaced with fresh objects " +
    "(a refetch, a `.map()` that copies items, a server response), every row is destroyed and recreated: " +
    "inputs lose focus and local state resets, even though row `7` is still row `7`. A `key` function " +
    "tells `<For>` which rows are the same, so they are moved and updated instead.",
  examples: {
    incorrect: [
      "import { useSignal } from '@shadow-js/core';\nconst [todos] = useSignal([{ id: 1, title: 'Write docs' }]);\nconst list = <For each={todos()}>{(todo) => <li>{todo.id}: {todo.title}</li>}</For>;",
      "import { useSignal } from '@shadow-js/core';\nconst [rows] = useSignal([{ id: 1 }]);\nconst [id] = useSignal(1);\nconst table = <For each={rows().map((row) => ({ ...row, selected: row.id === id() }))}>{(row) => <Row row={row} />}</For>;",
    ],
    correct: [
      "import { useSignal } from '@shadow-js/core';\nconst [todos] = useSignal([{ id: 1, title: 'Write docs' }]);\nconst list = <For each={todos()} key={(todo) => todo.id}>{(todo) => <li>{todo().title}</li>}</For>;",
      "import { useSignal } from '@shadow-js/core';\nconst [names] = useSignal(['Ada', 'Grace']);\nconst list = <For each={names()}>{(name) => <li>{name}</li>}</For>;",
    ],
  },
  notes: [
    "A list that cannot change (a module constant, a literal) is not reported: the rows are never rebuilt.",
    "Reported when the row callback reads an identity field (`id`, `_id`, `uid`, `uuid`, `key`, `slug`) of its item, or when `each` is built with `.map(...)` (new objects on every change).",
    "With `key`, the row callback receives an accessor: the suggestion rewrites `item` to `item()` in the callback.",
  ],
  fix: "The suggestion adds `key={(item) => item.<field>}` after the `For` tag name and rewrites every read of the item to `item()` (a keyed row receives an accessor). It is withheld when the parameter is destructured, when only `.map(...)` triggered the report (no identity field to key on), or when the item parameter is reassigned.",
  disableWhen:
    "Disable it when the items keep their object identity across updates (the same objects are reused), so matching rows by reference already keeps them.",
  hasSuggestions: true,
  messages: {
    missingKey:
      "`<For>` rows are matched by object identity. Add `key={(item) => item.{{field}}}` so rows survive when the list is rebuilt.",
    missingKeyDerived:
      "`each` builds new objects on every change, so rows are matched by identity and all rebuilt. Add a `key` function.",
    addKey: "Add `key={(item) => item.{{field}}}` and read the item as an accessor.",
  },
  create(context) {
    const keys = context.sourceCode.visitorKeys;
    const model = reactiveModel(context);

    const isFor = (opening: AstNode): boolean => {
      const name = at(opening, "name");
      if (name === null || name.type !== "JSXIdentifier") return false;
      if (identName(name) !== "For") return false;
      // Unbound `For` (snippets) counts; a bound one must come from the framework.
      return shadowApiName(context, name) === "For";
    };

    return {
      JSXOpeningElement(opening) {
        if (!isFor(opening)) return;
        const attributes = list(opening, "attributes").filter((a) => a.type === "JSXAttribute");
        if (attributes.some((a) => jsxAttributeName(a) === "key")) return;
        if (list(opening, "attributes").some((a) => a.type === "JSXSpreadAttribute")) return;
        const element = opening.parent;
        if (element === null) return;
        const each = attributes.find((a) => jsxAttributeName(a) === "each");
        const eachExpression =
          each === undefined ? null : at(at(each, "value") ?? each, "expression");

        // The row callback: `{(item, index) => ...}` as the only expression child.
        const callback = list(element, "children")
          .filter((child) => child.type === "JSXExpressionContainer")
          .map((child) => at(child, "expression"))
          .find(
            (expression): expression is AstNode => expression !== null && isFunction(expression),
          );

        let field: string | undefined;
        let itemVariable: ReturnType<typeof resolveVariable> = null;
        let itemParam: AstNode | null = null;
        if (callback !== undefined) {
          const first = list(callback, "params")[0];
          if (first !== undefined && first.type === "Identifier") {
            itemParam = first;
            itemVariable = resolveVariable(context, first);
            for (const reference of itemVariable?.references ?? []) {
              // `(item as Item).id` and `item!.id` read the identity too: look through the wrappers.
              let member = asAst(reference.identifier);
              let parent = member.parent;
              while (parent !== null && isWrapper(parent)) {
                member = parent;
                parent = parent.parent;
              }
              if (parent === null || parent.type !== "MemberExpression") continue;
              if (at(parent, "object") !== member) continue;
              const name = memberName(parent);
              if (name !== undefined && ID_FIELDS.includes(name)) {
                field = name;
                break;
              }
            }
          } else if (first !== undefined && first.type === "ObjectPattern") {
            for (const property of list(first, "properties")) {
              const name = identName(at(property, "key"));
              if (property.type === "Property" && name !== undefined && ID_FIELDS.includes(name)) {
                field = name;
                break;
              }
            }
          }
        }

        const derived =
          eachExpression !== null &&
          someInFunction(eachExpression, keys, (node) => {
            if (node.type !== "CallExpression") return false;
            const callee = at(node, "callee");
            return (
              callee !== null && callee.type === "MemberExpression" && memberName(callee) === "map"
            );
          });

        if (field === undefined && !derived) return;
        // A list that never changes (a module constant) keeps its rows for ever: nothing to match.
        if (eachExpression !== null && !readsReactive(context, model, eachExpression, keys)) return;

        let suggest: Rule.SuggestionReportDescriptor[] = [];
        if (field !== undefined && itemParam !== null && itemVariable !== null) {
          const reads = readsToCalls(itemVariable);
          const name = identName(itemParam) ?? "item";
          const nameNode = at(opening, "name");
          if (reads !== null && nameNode !== null) {
            const keyText = ` key={(${name}) => ${name}.${field}}`;
            suggest = [
              {
                messageId: "addKey",
                data: { field },
                fix: (fixer) => [
                  fixer.insertTextAfterRange(nameNode.range, keyText),
                  ...applyEdits(fixer, reads),
                ],
              },
            ];
          }
        }
        context.report({
          node: opening,
          messageId: field === undefined ? "missingKeyDerived" : "missingKey",
          data: { field: field ?? "id" },
          suggest,
        });
      },
    };
  },
});
