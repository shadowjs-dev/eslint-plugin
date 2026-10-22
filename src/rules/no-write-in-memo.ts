import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, isWrapper, list, unwrap } from "../utils/ast";
import { owningFunction } from "../utils/flow";
import { reactiveModel, writeCallOf } from "../utils/reactive";
import { shadowApiName } from "../utils/scope";

/**
 * Disallow writing signals or stores inside a `useMemo` computation.
 *
 * What it catches and why: a memo is a pure derivation. It may run lazily, more than once, or not
 * at all, so a write from inside it makes the result depend on evaluation order. The engine throws
 * `WRITE_IN_MEMO` in development builds when a signal or store setter runs while a memo computes.
 * The rule reports a call of a tracked setter (from `useSignal` or `useStore`, through
 * aliases) or of `writeSignal` inside the compute function of `useMemo` or of
 * `createComputation({ kind: "memo", fn })`, including callbacks that run synchronously inside
 * it (`array.map(...)`, immediately invoked functions, `batch(...)`). Functions that may run
 * later, such as event handlers and timers created in the memo, are not checked.
 *
 * Incorrect:
 *
 * ```tsx
 * const [last, setLast] = useSignal(0);
 * const total = useMemo(() => {
 *   const sum = a() + b();
 *   setLast(sum);
 *   return sum;
 * });
 * ```
 *
 * Correct:
 *
 * ```tsx
 * const [last, setLast] = useSignal(0);
 * const total = useMemo(() => a() + b());
 * useEffect(() => setLast(total()));
 * ```
 *
 * ```tsx
 * const [last, setLast] = useSignal(0);
 * const total = useMemo(() => {
 *   const handler = () => setLast(1);
 *   return a() + b();
 * });
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: the rule does not fix code.
 *
 * Disabling: `// eslint-disable-next-line shadow/no-write-in-memo` for one line, or a block
 * between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/no-write-in-memo *\/
 * /* eslint-enable shadow/no-write-in-memo *\/
 * ```
 *
 * A disable is rarely legitimate: the engine throws on the write in development. For a primitive
 * that must be written during a memo, use `writeSignal(node, value, { allowInMemo: true })`,
 * which the rule allows, instead of a disable comment.
 *
 * Configs:
 * - `recommended`: `"error"`
 * - `strict`: `"error"`
 * - `migration`: `"error"`
 * - `dusk`: `"error"`
 *
 * @example
 * ```ts
 * import shadow from "@shadow-js/eslint-plugin";
 *
 * export default [shadow.configs.recommended, { rules: { "shadow/no-write-in-memo": "error" } }];
 * ```
 * @since 1.0.0
 * @see docs/rules/no-write-in-memo.md
 */
export const noWriteInMemo: ShadowRule = defineRule({
  name: "no-write-in-memo",
  id: "ESL-03",
  type: "problem",
  description: "Disallow writing signals or stores inside a `useMemo` computation.",
  recommended: true,
  rationale:
    "A memo is a pure derivation: it may run lazily, more than once, or not at all. Writing a signal from " +
    "inside it makes the result depend on evaluation order, and the engine throws `WRITE_IN_MEMO` in " +
    "development. Derive the value from its sources, or write from a `useEffect`.",
  examples: {
    incorrect: [
      "const [last, setLast] = useSignal(0);\nconst total = useMemo(() => {\n  const sum = a() + b();\n  setLast(sum);\n  return sum;\n});",
    ],
    correct: [
      "const [last, setLast] = useSignal(0);\nconst total = useMemo(() => a() + b());\nuseEffect(() => setLast(total()));",
      "const [last, setLast] = useSignal(0);\nconst total = useMemo(() => {\n  const handler = () => setLast(1);\n  return a() + b();\n});",
    ],
  },
  notes: [
    "Callbacks that run synchronously inside the memo (`array.map(...)`, IIFEs, `batch(...)`) are checked; functions that may run later (event handlers, timers) are not.",
    "`writeSignal(node, value, { allowInMemo: true })` is the documented escape hatch for primitives and is allowed.",
  ],
  disableWhen:
    "Rarely: the engine throws on the write in development. For a primitive that must be written " +
    "during a memo, use `writeSignal(node, value, { allowInMemo: true })`, which the rule allows.",
  messages: {
    writeInMemo:
      "`{{name}}` writes state inside a `useMemo` computation. Memos must be pure: derive the value from its sources, or write from `useEffect`.",
  },
  create(context) {
    const model = reactiveModel(context);
    /** True when `fn` is the compute callback of a memo. */
    const isMemoCallback = (fn: AstNode | null): boolean => {
      if (fn === null) return false;
      // A TypeScript cast around the function (`(() => ...) as Compute`) does not change its role.
      let child: AstNode = fn;
      let parent = fn.parent;
      while (parent !== null && isWrapper(parent)) {
        child = parent;
        parent = parent.parent;
      }
      if (parent === null) return false;
      if (parent.type === "CallExpression") {
        const callee = at(parent, "callee");
        if (callee === null || list(parent, "arguments")[0] !== child) return false;
        return shadowApiName(context, callee) === "useMemo";
      }
      // createComputation({ kind: "memo", fn })
      if (parent.type === "Property") {
        const object = parent.parent;
        const call = object === null ? null : object.parent;
        if (object === null || call === null || call.type !== "CallExpression") return false;
        const callee = at(call, "callee");
        if (callee === null || shadowApiName(context, callee) !== "createComputation") return false;
        const key = at(parent, "key");
        if (key === null || Reflect.get(key, "name") !== "fn") return false;
        return list(object, "properties").some((property) => {
          const propertyKey = at(property, "key");
          const value = at(property, "value");
          return (
            propertyKey !== null &&
            Reflect.get(propertyKey, "name") === "kind" &&
            value !== null &&
            Reflect.get(unwrap(value), "value") === "memo"
          );
        });
      }
      return false;
    };
    return {
      CallExpression(node) {
        const write = writeCallOf(context, model, node);
        if (write === null || write.allowsMemo) return;
        const { fn } = owningFunction(context, node);
        if (!isMemoCallback(fn)) return;
        context.report({ node, messageId: "writeInMemo", data: { name: write.name } });
      },
    };
  },
});
