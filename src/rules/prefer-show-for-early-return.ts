import type { Rule, SourceCode } from "eslint";
import { defineRule, type ShadowRule } from "../rule";
import {
  type AstNode,
  asAst,
  at,
  flag,
  identName,
  isFunction,
  isJsx,
  list,
  someInFunction,
  str,
  unwrap,
  walk,
} from "../utils/ast";
import { isComponent } from "../utils/components";
import { applyEdits, ensureImports } from "../utils/fixes";
import { reactiveModel } from "../utils/reactive";
import { resolveVariable } from "../utils/scope";

/**
 * True for `import.meta.env` and its property reads with a literal key (`import.meta.env.SSR`,
 * `import.meta.env?.SSR`, `import.meta.env["SSR"]`). Vite and Dusk replace these at build time, so
 * they never change while a component lives. A computed key that is not a literal is not static.
 */
function isBuildTimeEnvRead(node: AstNode): boolean {
  let member = unwrap(node);
  if (member.type === "ChainExpression") {
    const inner = at(member, "expression");
    if (inner === null) return false;
    member = unwrap(inner);
  }
  // Walk down the member chain from the outside in: every key must be a name or a literal, and
  // the innermost member must be `import.meta.env`.
  while (member.type === "MemberExpression") {
    const property = at(member, "property");
    if (property === null) return false;
    if (flag(member, "computed") && property.type !== "Literal") return false;
    const object = at(member, "object");
    if (object === null) return false;
    const target = unwrap(object);
    if (target.type === "MetaProperty") {
      return (
        !flag(member, "computed") &&
        identName(property) === "env" &&
        identName(at(target, "meta")) === "import" &&
        identName(at(target, "property")) === "meta"
      );
    }
    member = target;
  }
  return false;
}

/**
 * Mirrors the compiler's `isDynamic`: calls, member reads, optional chains, tagged templates, `in`.
 * The exception is a build-time read of `import.meta.env` (see {@link isBuildTimeEnvRead}): such a
 * guard selects one branch per build, so it is not a reactive early return.
 */
function readsSomething(root: AstNode, keys: SourceCode.VisitorKeys): boolean {
  let found = false;
  walk(root, keys, (node) => {
    if (found) return false;
    if (node !== root && isFunction(node)) return false;
    if (isBuildTimeEnvRead(node)) return false;
    switch (node.type) {
      case "CallExpression":
      case "MemberExpression":
      case "TaggedTemplateExpression":
      case "ChainExpression":
        found = true;
        return false;
      case "BinaryExpression":
        if (str(node, "operator") === "in") {
          found = true;
          return false;
        }
        return true;
      default:
        return true;
    }
  });
  return found;
}

function isNothing(node: AstNode): boolean {
  const value = unwrap(node);
  if (value.type === "Identifier") return str(value, "name") === "undefined";
  if (value.type === "Literal") {
    const literal = Reflect.get(value, "value");
    return literal === null || literal === false;
  }
  return false;
}

/** The expression returned by a statement that is `return x;` or a block holding only that. */
function returnedBy(statement: AstNode | null): { found: boolean; argument: AstNode | null } {
  if (statement === null) return { found: false, argument: null };
  if (statement.type === "ReturnStatement") {
    return { found: true, argument: at(statement, "argument") };
  }
  if (statement.type === "BlockStatement") {
    const body = list(statement, "body");
    const only = body[0];
    if (body.length === 1 && only !== undefined && only.type === "ReturnStatement") {
      return { found: true, argument: at(only, "argument") };
    }
  }
  return { found: false, argument: null };
}

/** True when the consequent contains a `return` somewhere that is not a lone `return x;`. */
function hasReturn(statement: AstNode, keys: SourceCode.VisitorKeys): boolean {
  return someInFunction(statement, keys, (node) => node.type === "ReturnStatement");
}

/**
 * Prefer `<Show>` over an early `return` guarded by a reactive condition.
 *
 * What it catches and why: a component body runs once. In
 * `if (loading()) return <Spinner />; return <Page />;` the branch is picked the first time and
 * never again, so the page does not follow `loading()`. Forgiving reactivity makes a returned
 * ternary or `&&` live (`return open() ? <A /> : <B />;`), but the forgiving-reactivity contract
 * leaves early returns as written and says to use `<Show>` for them. `<Show when={...}
 * fallback={...}>` re-evaluates the condition and swaps the branch. The rule reports an `if` at
 * the top level of a component (a PascalCase function that contains JSX) whose consequent returns,
 * when JSX is returned on some path and the condition reads something, judged as the compiler
 * judges a returned condition (`isDynamic` in `@shadow-js/compiler`): a call, a member read such as
 * `props.loading`, an optional chain, a tagged template, an `in` test, a signal or memo accessor,
 * or a constant initialized from such a read. A condition of plain locals, globals and literals
 * (`typeof window === 'undefined'`) is not reported. Neither is a build-time flag read from
 * `import.meta.env` (`import.meta.env.SSR`): Vite and Dusk replace it when the bundle is built, so
 * the branch never changes while the component lives.
 *
 * Incorrect:
 *
 * ```tsx
 * function Page(props) {
 *   if (props.loading) return <Spinner />;
 *   return <Content />;
 * }
 * ```
 *
 * ```tsx
 * function Page() {
 *   if (!user()) return null;
 *   return <Profile user={user()} />;
 * }
 * ```
 *
 * Correct:
 *
 * ```tsx
 * function Page() {
 *   if (import.meta.env.SSR) return null;
 *   return <Content />;
 * }
 * ```
 *
 * ```tsx
 * function Page(props) {
 *   return (
 *     <Show when={!props.loading} fallback={<Spinner />}>
 *       <Content />
 *     </Show>
 *   );
 * }
 * ```
 *
 * ```tsx
 * function Page(props) {
 *   return props.loading ? <Spinner /> : <Content />;
 * }
 * ```
 *
 * ```tsx
 * function Page() {
 *   if (typeof window === 'undefined') return null;
 *   return <Content />;
 * }
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: no autofix; a suggestion replaces the guard and the final return with one
 * `return <Show when={...} fallback={...}>...</Show>;` and adds the `Show` import from
 * `@shadow-js/web` when it is missing. A negated condition (`!user()`) is turned around so the
 * main result is shown and the guard's result is the fallback; a `null`, `undefined` or `false`
 * result gives no `fallback`. The suggestion is offered only when the guard and the final `return`
 * are the last two statements (or an `if`/`else` is the last statement) and each branch is a
 * lone `return`; otherwise the rule only reports.
 *
 * Disabling: `// eslint-disable-next-line shadow/prefer-show-for-early-return` for one line, or a
 * block between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/prefer-show-for-early-return *\/
 * /* eslint-enable shadow/prefer-show-for-early-return *\/
 * ```
 *
 * A disable is legitimate when the condition cannot change while the component lives and the
 * rule cannot see that, for example a value computed once at module load by a function call.
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
 *   { rules: { "shadow/prefer-show-for-early-return": "error" } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/prefer-show-for-early-return.md
 */
export const preferShowForEarlyReturn: ShadowRule = defineRule({
  name: "prefer-show-for-early-return",
  id: "ESL-08",
  type: "suggestion",
  description: "Prefer `<Show>` over an early `return` guarded by a reactive condition.",
  recommended: true,
  rationale:
    "A component body runs once. `if (loading()) return <Spinner />; return <Page />;` picks a branch the first " +
    "time and never again, so the page does not follow `loading()`. A returned ternary or `&&` is made live by " +
    "the compiler, but an early `return` is left as written (see the forgiving-reactivity contract). " +
    "`<Show when={...} fallback={...}>` re-evaluates the condition and swaps the branch.",
  examples: {
    incorrect: [
      "function Page(props) {\n  if (props.loading) return <Spinner />;\n  return <Content />;\n}",
      "function Page() {\n  if (!user()) return null;\n  return <Profile user={user()} />;\n}",
    ],
    correct: [
      "function Page(props) {\n  return (\n    <Show when={!props.loading} fallback={<Spinner />}>\n      <Content />\n    </Show>\n  );\n}",
      "function Page(props) {\n  return props.loading ? <Spinner /> : <Content />;\n}",
      "function Page() {\n  if (typeof window === 'undefined') return null;\n  return <Content />;\n}",
      "function Page() {\n  if (import.meta.env.SSR) return null;\n  return <Content />;\n}",
    ],
  },
  notes: [
    "Only conditions that read something reactive-looking (calls, member reads such as `props.x`, accessors, derived constants) are reported.",
    "Static conditions such as `typeof window === 'undefined'` are fine, and so is a build-time flag read from `import.meta.env` (`import.meta.env.SSR`), which Vite and Dusk replace when the bundle is built. A computed key that is not a literal (`import.meta.env[key]`) is still reactive.",
    "The suggestion is offered when the guard and the final `return` are the last two statements.",
  ],
  hasSuggestions: true,
  fix:
    "A suggestion (not an autofix) replaces the guard and the final return with one " +
    "`return <Show when={...} fallback={...}>...</Show>;` and adds the `Show` import from " +
    "`@shadow-js/web`. A negated condition is turned around, and a `null`, `undefined` or `false` " +
    "result gives no `fallback`. It is withheld unless the guard and the final `return` are the last " +
    "two statements (or an `if`/`else` is last) and each branch is a lone `return`.",
  disableWhen:
    "When the condition cannot change while the component lives and the rule cannot see that, for " +
    "example a value computed once at module load by a function call.",
  messages: {
    preferShow:
      "This early return is evaluated once, so the component will not follow `{{condition}}`. Use `<Show when={...}>` (or a returned ternary).",
    wrapInShow: "Replace the early return with `<Show>`.",
  },
  create(context) {
    const model = reactiveModel(context);
    const keys = context.sourceCode.visitorKeys;
    const text = context.sourceCode.text;

    const isReactive = (test: AstNode): boolean => {
      if (readsSomething(test, keys)) return true;
      // A bare accessor or a derived constant (`const loading = status() === "x"`).
      let found = false;
      someInFunction(test, keys, (node) => {
        if (found || node.type !== "Identifier") return false;
        const variable = resolveVariable(context, node);
        if (variable === null) return false;
        if (model.accessors.has(variable)) {
          found = true;
          return true;
        }
        for (const def of variable.defs) {
          if (def.type !== "Variable") continue;
          const declarator = asAst(def.node);
          const init = at(declarator, "init");
          if (init !== null && readsSomething(init, keys)) {
            found = true;
            return true;
          }
        }
        return false;
      });
      return found;
    };

    const expressionText = (node: AstNode): string => text.slice(...node.range);
    const childText = (node: AstNode): string =>
      isJsx(unwrap(node)) ? expressionText(unwrap(node)) : `{${expressionText(node)}}`;

    const check = (fn: AstNode): void => {
      if (!isComponent(fn, keys)) return;
      const body = at(fn, "body");
      if (body === null || body.type !== "BlockStatement") return;
      const statements = list(body, "body");
      statements.forEach((statement, index) => {
        if (statement.type !== "IfStatement") return;
        const consequent = at(statement, "consequent");
        const alternate = at(statement, "alternate");
        const test = at(statement, "test");
        if (test === null || consequent === null || !hasReturn(consequent, keys)) return;
        if (!isReactive(test)) return;
        const first = returnedBy(consequent);
        // Something JSX-like must be returned for the guard to matter.
        const later = statements.slice(index + 1);
        const rest = alternate ?? later.find((s) => s.type === "ReturnStatement") ?? null;
        const jsxPresent =
          (first.argument !== null && someInFunction(first.argument, keys, isJsx)) ||
          later.some((s) => someInFunction(s, keys, isJsx)) ||
          (alternate !== null && someInFunction(alternate, keys, isJsx));
        if (!jsxPresent) return;

        const conditionText = text.slice(...test.range);
        const lastTwo = index === statements.length - 2 && alternate === null;
        const withElse = index === statements.length - 1 && alternate !== null;
        let suggest: Rule.SuggestionReportDescriptor[] = [];
        const second = alternate !== null ? returnedBy(alternate) : returnedBy(rest);
        if ((lastTwo || withElse) && first.found && second.found) {
          const imports = ensureImports(context, [{ name: "Show", source: "@shadow-js/web" }]);
          const whenNode = unwrap(test);
          const negated = whenNode.type === "UnaryExpression" && str(whenNode, "operator") === "!";
          const inner = negated ? at(whenNode, "argument") : null;
          const guardResult = first.argument;
          const mainResult = second.argument;
          const shown = negated ? mainResult : guardResult;
          const fallback = negated ? guardResult : mainResult;
          const lastNode = alternate !== null ? statement : (rest ?? statement);
          if (imports !== null && shown !== null) {
            const when = negated && inner !== null ? expressionText(inner) : expressionText(test);
            const fallbackAttr =
              fallback === null || isNothing(fallback)
                ? ""
                : ` fallback={${expressionText(fallback)}}`;
            const range: [number, number] = [statement.range[0], lastNode.range[1]];
            const replacement = `return <Show when={${when}}${fallbackAttr}>${childText(shown)}</Show>;`;
            suggest = [
              {
                messageId: "wrapInShow",
                fix: (fixer) => [
                  ...applyEdits(fixer, imports),
                  fixer.replaceTextRange(range, replacement),
                ],
              },
            ];
          }
        }
        context.report({
          node: statement,
          messageId: "preferShow",
          data: {
            condition:
              conditionText.length > 40 ? `${conditionText.slice(0, 37)}...` : conditionText,
          },
          suggest,
        });
      });
    };

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: (node) => {
        if (isFunction(node)) check(node);
      },
    };
  },
});
