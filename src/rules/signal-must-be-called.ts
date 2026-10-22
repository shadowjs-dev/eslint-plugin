import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, identName, isWrapper, str } from "../utils/ast";
import { ACCESSOR_MEMBERS, type AccessorKind, memberName, reactiveModel } from "../utils/reactive";
import { type Context, resolveVariable } from "../utils/scope";
import { typeOfNode } from "../utils/types";

/** Binary operators whose operands must be values (a function there is always a mistake). */
const VALUE_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  ">",
  "<=",
  ">=",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
]);
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);
const VALUE_UNARY = new Set(["-", "+", "!", "~"]);
const FUNCTION_MEMBERS = new Set(["call", "apply", "bind"]);
/** Global functions that coerce or compute from their arguments. */
const COERCING_CALLEES = new Set([
  "Number",
  "String",
  "Boolean",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
]);

type Situation =
  | "arithmetic"
  | "comparison"
  | "template"
  | "condition"
  | "member"
  | "unary"
  | "argument"
  | "spread"
  | "index";

/** Climbs through `as` / `!` / parentheses so the context of the real expression is seen. */
function effective(node: AstNode): { inner: AstNode; parent: AstNode | null } {
  let inner = node;
  let parent = node.parent;
  while (parent !== null && isWrapper(parent)) {
    inner = parent;
    parent = parent.parent;
  }
  return { inner, parent };
}

function isNullish(node: AstNode | null): boolean {
  if (node === null) return false;
  if (node.type === "Identifier") return str(node, "name") === "undefined";
  return node.type === "Literal" && Reflect.get(node, "value") === null && !("regex" in node);
}

/** Why a value (not a function) is needed at this position, or `null` when an accessor is fine. */
function situationOf(node: AstNode): Situation | null {
  const { inner, parent } = effective(node);
  if (parent === null) return null;
  switch (parent.type) {
    case "BinaryExpression": {
      const operator = str(parent, "operator") ?? "";
      if (VALUE_OPERATORS.has(operator)) return operator === "+" ? "arithmetic" : "comparison";
      if (EQUALITY_OPERATORS.has(operator)) {
        const left = at(parent, "left");
        const other = left === inner ? at(parent, "right") : left;
        if (other === null || isNullish(other)) return null;
        // Comparing with a literal can never be true for a function.
        return other.type === "Literal" || other.type === "TemplateLiteral" ? "comparison" : null;
      }
      return null;
    }
    case "UnaryExpression":
      return VALUE_UNARY.has(str(parent, "operator") ?? "") ? "unary" : null;
    case "TemplateLiteral": {
      // A tagged template hands the value to its tag, as a call argument does; only `${}` in a plain
      // template prints the function's source.
      const tagged = parent.parent;
      if (tagged !== null && tagged.type === "TaggedTemplateExpression") {
        return at(tagged, "quasi") === parent ? null : "template";
      }
      return "template";
    }
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ConditionalExpression": {
      const test = at(parent, "test");
      return test === inner ? "condition" : null;
    }
    case "SwitchStatement":
      return at(parent, "discriminant") === inner ? "condition" : null;
    case "LogicalExpression":
      return at(parent, "left") === inner ? "condition" : null;
    case "MemberExpression": {
      if (at(parent, "object") === inner) {
        const name = memberName(parent);
        if (name !== undefined && FUNCTION_MEMBERS.has(name)) return null;
        return "member";
      }
      // `list[count]`
      return Reflect.get(parent, "computed") === true ? "index" : null;
    }
    case "SpreadElement":
      return "spread";
    case "JSXSpreadAttribute":
      // `<div {...props} />` needs the object; a function spreads no props.
      return at(parent, "argument") === inner ? "spread" : null;
    case "ForOfStatement":
      return at(parent, "right") === inner ? "spread" : null;
    case "CallExpression": {
      if (at(parent, "callee") === inner) return null;
      const callee = at(parent, "callee");
      if (callee === null) return null;
      if (callee.type === "Identifier" && COERCING_CALLEES.has(str(callee, "name") ?? "")) {
        return "argument";
      }
      if (callee.type === "MemberExpression") {
        const object = at(callee, "object");
        if (object !== null && identName(object) === "Math") return "argument";
      }
      return null;
    }
    default:
      return null;
  }
}

/** True when `identifier` reads a variable (not a declaration, key or property name). */
function isReadReference(identifier: AstNode): boolean {
  const parent = identifier.parent;
  if (parent === null) return false;
  switch (parent.type) {
    case "MemberExpression":
      return at(parent, "object") === identifier || Reflect.get(parent, "computed") === true;
    case "Property":
      return at(parent, "value") === identifier || Reflect.get(parent, "computed") === true;
    case "PropertyDefinition":
    case "MethodDefinition":
    case "VariableDeclarator":
      return at(parent, "init") === identifier;
    case "ImportSpecifier":
    case "ExportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
    case "CatchClause":
    case "RestElement":
    case "ArrayPattern":
    case "ObjectPattern":
    case "AssignmentPattern":
    case "UpdateExpression":
      return false;
    case "AssignmentExpression":
      return at(parent, "right") === identifier;
    default:
      return !parent.type.startsWith("TS") || isWrapper(parent);
  }
}

/** True when the identifier's type is a function taking no parameters and returning a value. */
function isZeroArgAccessorType(context: Context, identifier: AstNode): boolean {
  const resolved = typeOfNode(context, identifier);
  if (resolved === null) return false;
  const { type, checker } = resolved;
  if (type.isUnion() || type.getConstructSignatures().length > 0) return false;
  const signatures = type.getCallSignatures();
  if (signatures.length !== 1) return false;
  const signature = signatures[0];
  if (signature === undefined || signature.getParameters().length !== 0) return false;
  const returned = checker.typeToString(signature.getReturnType());
  return returned !== "void" && returned !== "never" && returned !== "undefined";
}

/**
 * Require signal and memo accessors to be called when a value is needed.
 *
 * What it catches and why: `useSignal` and `useMemo` return accessors, which are functions. JSX
 * children and attribute values accept the bare accessor (`{count}`) because the runtime calls it,
 * so forgiving reactivity lets you leave the call out there. Everywhere a value is needed the
 * function itself is used instead: `count + 1` concatenates the function's source text, `if (count)`
 * is always true, `count.length` is the function's arity and `` `${count}` `` prints its source.
 * The rule reports an accessor in arithmetic, comparisons (`<`, `>`, and `===` with a literal),
 * template strings, conditions (`if`, `while`, `switch`, `?:`, the left side of `&&` and `||`),
 * unary operators, member access, computed indexes, spreads (array, object and JSX attribute),
 * `for...of`, and as an argument of `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`, `isNaN`,
 * `isFinite` or a `Math` method. A tagged template (`` css`${count}` ``) hands the accessor to its tag
 * and is not reported, like any other call argument.
 * Accessors are found from `useSignal`, `useMemo`, `useResource`, `useSelector`, `children` and
 * a primitive `useStore` cell, through aliases, renamed and namespace imports. Members the accessor
 * really has (`bind`, `call`, `apply`, a resource's `loading` or `refetch`, `toArray` of
 * `children`) and comparisons with `null`, `undefined` or another expression are not reported.
 *
 * Incorrect:
 *
 * ```tsx
 * const [count, setCount] = useSignal(0);
 * const next = count + 1;
 * ```
 *
 * ```tsx
 * const [items] = useSignal<string[]>([]);
 * const size = items.length;
 * ```
 *
 * ```tsx
 * const [count] = useSignal(0);
 * const label = `Count: ${count}`;
 * ```
 *
 * ```tsx
 * const [count] = useSignal(0);
 * if (count) { start(); }
 * ```
 *
 * Correct:
 *
 * ```tsx
 * const [count, setCount] = useSignal(0);
 * const next = count() + 1;
 * ```
 *
 * ```tsx
 * const [count] = useSignal(0);
 * const view = <span>{count}</span>;
 * ```
 *
 * ```tsx
 * const [state] = useStore({ n: 0 });
 * const next = state.n + 1;
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: an accessor declared by a ShadowJS hook is fixed by inserting `()` after it. With a
 * type-aware parser (`parserOptions.projectService`), any other identifier whose type is a single
 * zero-argument function returning a value is reported too, with a suggestion (not an autofix) to
 * call it, because a plain function is not known to be safe to call.
 *
 * Disabling: `// eslint-disable-next-line shadow/signal-must-be-called` for one line, or a block
 * between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/signal-must-be-called *\/
 * /* eslint-enable shadow/signal-must-be-called *\/
 * ```
 *
 * A disable is legitimate when the function itself is the intended value, for example reading a
 * property of the function (`handler.name`) or printing its source text on purpose.
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
 * export default [shadow.configs.recommended, { rules: { "shadow/signal-must-be-called": "error" } }];
 * ```
 * @since 1.0.0
 * @see docs/rules/signal-must-be-called.md
 */
export const signalMustBeCalled: ShadowRule = defineRule({
  name: "signal-must-be-called",
  id: "ESL-02",
  type: "problem",
  description: "Require signal and memo accessors to be called when a value is needed.",
  recommended: true,
  typeAware: true,
  rationale:
    "`useSignal` and `useMemo` return functions. In JSX children and attributes the runtime accepts the " +
    "bare accessor (`{count}`), but in arithmetic, comparisons, conditions, template strings and member " +
    "access a function is not the value: `count + 1` is a string, `if (count)` is always true and " +
    "`count.length` is the function's arity. Call the accessor.",
  examples: {
    incorrect: [
      "const [count, setCount] = useSignal(0);\nconst next = count + 1;",
      "const [items] = useSignal<string[]>([]);\nconst size = items.length;",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      "const [count] = useSignal(0);\nconst label = `Count: ${count}`;",
      "const [count] = useSignal(0);\nif (count) { start(); }",
    ],
    correct: [
      "const [count, setCount] = useSignal(0);\nconst next = count() + 1;",
      "const [count] = useSignal(0);\nconst view = <span>{count}</span>;",
      "const [state] = useStore({ n: 0 });\nconst next = state.n + 1;",
    ],
  },
  notes: [
    "Accessors are found from `useSignal`, `useMemo`, `useResource`, `useSelector` and `children` declarations and their aliases.",
    "With a type-aware parser (`parserOptions.projectService`), zero-argument function types are also reported, as suggestions.",
    "Members the accessor really has are not reported: a resource's `state`, `loading`, `error`, `latest`, `refetch`, `mutate`, and `children().toArray()`.",
  ],
  fixable: "code",
  hasSuggestions: true,
  fix:
    "An accessor declared by a ShadowJS hook (`useSignal`, `useMemo`, `useResource`, `useSelector`, " +
    "`children`, a primitive `useStore`) is fixed by inserting `()` after it. An identifier found only " +
    "through type information (a zero-argument function type) gets a suggestion to call it instead, " +
    "because calling an arbitrary function is not known to be safe.",
  disableWhen:
    "When the function itself is the intended value, for example reading a property of the function " +
    "(`handler.name`) or printing its source text on purpose.",
  messages: {
    mustCall: "`{{name}}` is a {{kind}} accessor: call it (`{{name}}()`) to read the value here.",
    mustCallTyped: "`{{name}}` is a function that returns a value: call it (`{{name}}()`) here.",
    callIt: "Call `{{name}}()`.",
  },
  create(context) {
    const model = reactiveModel(context);
    const kindLabel = (kind: AccessorKind): string => {
      switch (kind) {
        case "signal":
          return "signal";
        case "memo":
          return "memo";
        case "resource":
          return "resource";
        case "selector":
          return "selector";
        case "children":
          return "children";
      }
    };
    return {
      Identifier(node) {
        if (!isReadReference(node)) return;
        const situation = situationOf(node);
        if (situation === null) return;
        const name = identName(node);
        if (name === undefined) return;
        const variable = resolveVariable(context, node);
        if (variable === null || variable.identifiers.some((id) => (id as unknown) === node))
          return;
        const kind = model.accessors.get(variable);
        if (kind !== undefined) {
          if (situation === "member") {
            const parent = effective(node).parent;
            const member = parent === null ? undefined : memberName(parent);
            if (member !== undefined && ACCESSOR_MEMBERS[kind].has(member)) return;
          }
          context.report({
            node,
            messageId: "mustCall",
            data: { name, kind: kindLabel(kind) },
            fix: (fixer) => fixer.insertTextAfterRange(node.range, "()"),
          });
          return;
        }
        // Not declared by a framework hook: ask the type checker, if the parser provides one.
        if (!isZeroArgAccessorType(context, node)) return;
        context.report({
          node,
          messageId: "mustCallTyped",
          data: { name },
          suggest: [
            {
              messageId: "callIt",
              data: { name },
              fix: (fixer) => fixer.insertTextAfterRange(node.range, "()"),
            },
          ],
        });
      },
    };
  },
});
