import type { Rule, Scope } from "eslint";
import { defineRule, type ShadowRule } from "../rule";
import {
  type AstNode,
  at,
  flag,
  identName,
  isFunction,
  isWrapper,
  list,
  str,
  unwrap,
  walk,
} from "../utils/ast";
import {
  compilerHandlesComponent,
  containsJsx,
  functionName,
  isComponentName,
  wrappedComponentName,
} from "../utils/components";
import { readsToPropertyAccess } from "../utils/fixes";
import { resolveVariable, scopeOf } from "../utils/scope";

interface Entry {
  key: string;
  local: string;
  hasDefault: boolean;
  identifier: AstNode;
}

type Shape =
  | { kind: "simple"; entries: Entry[] }
  | { kind: "rest" | "nested" | "computed" | "other" };

/** Classifies a destructuring pattern the way the compiler's `patternEntries` does. */
function shapeOf(pattern: AstNode): Shape {
  const entries: Entry[] = [];
  for (const property of list(pattern, "properties")) {
    if (property.type === "RestElement") return { kind: "rest" };
    if (property.type !== "Property") return { kind: "other" };
    if (flag(property, "computed")) return { kind: "computed" };
    const key = at(property, "key");
    const value = at(property, "value");
    if (key === null || value === null) return { kind: "other" };
    const keyName =
      key.type === "Identifier"
        ? str(key, "name")
        : key.type === "Literal"
          ? String(Reflect.get(key, "value"))
          : undefined;
    if (keyName === undefined) return { kind: "other" };
    if (value.type === "Identifier") {
      entries.push({
        key: keyName,
        local: str(value, "name") ?? "",
        hasDefault: false,
        identifier: value,
      });
    } else if (value.type === "AssignmentPattern") {
      const left = at(value, "left");
      if (left === null || left.type !== "Identifier") return { kind: "nested" };
      entries.push({
        key: keyName,
        local: str(left, "name") ?? "",
        hasDefault: true,
        identifier: left,
      });
    } else {
      return { kind: "nested" };
    }
  }
  return { kind: "simple", entries };
}

/** `export default () => <.../>` and `export default function () {...}`: a component without a name. */
function isAnonymousDefaultExport(fn: AstNode): boolean {
  let parent = fn.parent;
  while (parent !== null && isWrapper(parent)) parent = parent.parent;
  return parent !== null && parent.type === "ExportDefaultDeclaration";
}

/**
 * The compiler's `unwrapParens` (`packages/compiler/src/internal/ast.ts`): parentheses only. A
 * TypeScript cast (`as`, `satisfies`, `!`) is not looked through, because the compiler does not.
 */
function unwrapParens(node: AstNode): AstNode {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    const inner = at(current, "expression");
    if (inner === null) break;
    current = inner;
  }
  return current;
}

/**
 * True when the compiler's `components()` pass (`packages/compiler/src/internal/derive.ts`) can
 * find the function: a function declaration, or the initializer of a variable declarator (through
 * parentheses only). A cast around the function (`(() => ...) as FC`) hides it from the compiler,
 * and so does a function in an object property, an assignment or a call argument.
 */
function declaredDirectly(fn: AstNode): boolean {
  if (fn.type === "FunctionDeclaration") return true;
  let parent = fn.parent;
  while (parent !== null && parent.type === "ParenthesizedExpression") parent = parent.parent;
  return parent !== null && parent.type === "VariableDeclarator";
}

/**
 * True when a rewritten `propsName` would not reach the component's props. Either the component
 * reads an outer binding of that name (it is in the function scope's `through` list), or a scope
 * between one of the destructured names' reads and the component declares that name.
 */
function wouldCapture(
  componentScope: Scope.Scope,
  variable: Scope.Variable,
  propsName: string,
): boolean {
  if (componentScope.through.some((reference) => reference.identifier.name === propsName)) {
    return true;
  }
  return variable.references.some((reference) => {
    for (
      let scope: Scope.Scope | null = reference.from;
      scope !== null && scope !== componentScope;
      scope = scope.upper
    ) {
      if (scope.set.has(propsName)) return true;
    }
    return false;
  });
}

const WRAPPED_REASON =
  "the component is wrapped in a call such as memo(...); the compiler only rewrites components declared directly";

const WRAPPED_INIT_REASON =
  "the initializer is not a plain `props` (a TypeScript wrapper such as `as` is not looked through)";

const SHAPE_REASON: Record<string, string> = {
  rest: "the pattern has a rest element (use `splitProps(props, [...])` instead)",
  nested: "the pattern is nested",
  computed: "the pattern has computed keys",
  other: "the pattern is not a plain `{ a, b: c, d = 1 }` list",
};

/**
 * Disallow destructuring props where the compiler does not keep them reactive (autoReactive off, or
 * an unsupported form).
 *
 * What it catches and why: props are getters, so destructuring reads them once and later updates
 * never reach the destructured names. With `autoReactive` on (the default), the compiler's
 * forgiving-reactivity pass (`packages/compiler/src/internal/derive.ts`) rewrites `({ title }) => ...` and
 * `const { title } = props` so each name follows `props`. That rewrite only covers PascalCase
 * components declared directly (a function declaration or a function assigned to a variable), with
 * at most one parameter, not async and not a generator; only top-level `const` declarations of the
 * body; and only plain patterns (`{ a, b: c, d = 1 }`, no rest, nesting or computed keys).
 * Everywhere else the destructuring silently freezes the value, and this rule reports exactly
 * those places: a parameter pattern or a `{ ... } = props` declaration in a component that is
 * wrapped in a call such as `memo(...)` or in a TypeScript cast, is an anonymous default export, is
 * defined in an object property or an assignment, is async or a generator, or has more than one
 * parameter; a `let` / `var` or nested declaration; a declaration whose initializer is a cast of
 * `props` (`= props as Props`); and a pattern with rest, nesting or computed keys. With
 * `autoReactive: false` every destructuring of props in a component is reported. Only PascalCase
 * functions that contain JSX are checked, and destructuring inside a callback that runs later (an
 * effect, a memo, an event handler) reads the props at that time and is not reported.
 *
 * Incorrect:
 *
 * ```tsx
 * function Row({ id, ...rest }) {
 *   return <li data-id={id} {...rest} />;
 * }
 * ```
 *
 * ```tsx
 * function Row(props) {
 *   let { title } = props;
 *   return <li>{title}</li>;
 * }
 * ```
 *
 * ```tsx
 * function Row(props) {
 *   if (props.on) {
 *     const { title } = props;
 *     log(title);
 *   }
 *   return <li />;
 * }
 * ```
 *
 * ```tsx
 * const Row = memo(({ title }) => <li>{title}</li>);
 * ```
 *
 * Correct:
 *
 * ```tsx
 * function Row({ id, title = 'untitled' }) {
 *   return <li data-id={id}>{title}</li>;
 * }
 * ```
 *
 * ```tsx
 * function Row(props) {
 *   const { title } = props;
 *   return <li>{title}</li>;
 * }
 * ```
 *
 * ```tsx
 * function Row(props) {
 *   const [local, rest] = splitProps(props, ['id']);
 *   return <li data-id={local.id} {...rest} />;
 * }
 * ```
 *
 * Options: one object.
 * - `autoReactive` (boolean, default `true`): mirrors the compiler flag of the same name. Set it to
 *   `false` for projects compiled with `autoReactive: false`, to report every destructuring of
 *   props.
 *
 * Autofix: no automatic fix. The suggestion reads props directly: a parameter pattern becomes
 * `props` (keeping its type annotation) and a `const { a } = props` declaration is removed, and
 * every read of a destructured name becomes `props.key` (with the component's own parameter name in
 * the declaration case). It is withheld for patterns with defaults,
 * rest elements, nesting or computed keys, when a destructured name is reassigned, when the
 * component already has a binding named `props` (parameter case), when a nested scope declares that
 * name around a read or the component reads an outer binding of it (the rewrite would be captured),
 * when a comment sits inside the text the rewrite replaces (it would be deleted), and when the
 * declaration declares more than one pattern or is not a statement of its own (declaration case).
 *
 * Disabling: `// eslint-disable-next-line shadow/no-destructure-props-outside-forgiving` above the
 * line, or a block between `/* eslint-disable shadow/no-destructure-props-outside-forgiving *\/`
 * and `/* eslint-enable shadow/no-destructure-props-outside-forgiving *\/`. A disable is legitimate
 * when reading the props once is intended, for example an initial value that must not follow later
 * updates.
 *
 * Configs:
 * - `recommended`: `warn`
 * - `strict`: `error` with `{ autoReactive: true }`
 * - `migration`: `warn`
 * - `dusk`: `warn`
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   {
 *     rules: {
 *       "shadow/no-destructure-props-outside-forgiving": ["error", { autoReactive: false }],
 *     },
 *   },
 * ];
 * ```
 * @since 1.0.0
 */
export const noDestructurePropsOutsideForgiving: ShadowRule = defineRule({
  name: "no-destructure-props-outside-forgiving",
  id: "ESL-01",
  type: "problem",
  description:
    "Disallow destructuring props where the compiler does not keep them reactive (autoReactive off, or an unsupported form).",
  recommended: true,
  rationale:
    "Props are getters: destructuring reads them once, so later updates never reach the destructured names. " +
    "With `autoReactive` on (the default), the compiler rewrites `({ title }) => ...` and `const { title } = props` " +
    "in components so each name follows `props`. That rewrite only covers PascalCase components declared directly, with one parameter, " +
    "top-level `const` declarations and plain patterns. Everywhere else the destructuring silently freezes the value; " +
    "this rule reports exactly those places. Set `autoReactive: false` to report every destructuring (for projects that " +
    "compile with `autoReactive: false`).",
  examples: {
    incorrect: [
      "function Row({ id, ...rest }) {\n  return <li data-id={id} {...rest} />;\n}",
      "function Row(props) {\n  let { title } = props;\n  return <li>{title}</li>;\n}",
      "function Row(props) {\n  if (props.on) {\n    const { title } = props;\n    log(title);\n  }\n  return <li />;\n}",
      "const Row = memo(({ title }) => <li>{title}</li>);",
    ],
    correct: [
      "function Row({ id, title = 'untitled' }) {\n  return <li data-id={id}>{title}</li>;\n}",
      "function Row(props) {\n  const { title } = props;\n  return <li>{title}</li>;\n}",
      "function Row(props) {\n  const [local, rest] = splitProps(props, ['id']);\n  return <li data-id={local.id} {...rest} />;\n}",
    ],
  },
  notes: [
    "Destructuring inside a callback that runs later (an effect, a memo, an event handler) reads the props at that time and is not reported.",
    "Option `autoReactive` (default `true`) mirrors the compiler flag of the same name.",
    "Suggestions rewrite plain patterns without defaults to `props.name`; patterns with defaults, rest or nesting need a manual change.",
  ],
  fix: "The suggestion reads props directly: a parameter pattern becomes `props` (keeping its type annotation) or a `const { a } = props` declaration is removed, and every read of a destructured name becomes `props.key` (with the component's own parameter name in the declaration case). It is withheld for patterns with defaults, rest elements, nesting or computed keys, when a destructured name is reassigned, when the component already has a binding named `props` (parameter case), when a nested scope or an outer binding would capture the rewritten name, when a comment sits inside the replaced text, and when the declaration declares more than one pattern or is not a statement of its own.",
  disableWhen:
    "Disable it when reading the props once is intended, for example an initial value that must not follow later updates.",
  hasSuggestions: true,
  schema: [
    {
      type: "object",
      properties: { autoReactive: { type: "boolean" } },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{ autoReactive: true }],
  messages: {
    frozenParam:
      "Destructuring props in the parameter list reads each prop once, so updates are lost ({{reason}}). Read `props.x` where it is used, or enable `autoReactive`.",
    frozenDeclaration:
      "Destructuring `{{props}}` reads each prop once, so updates are lost ({{reason}}). Read `{{props}}.x` where it is used, or enable `autoReactive`.",
    useProps: "Read `props.x` instead of destructuring.",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const autoReactive =
      typeof rawOptions === "object" && rawOptions !== null
        ? Reflect.get(rawOptions, "autoReactive") !== false
        : true;
    const keys = context.sourceCode.visitorKeys;
    const text = context.sourceCode.text;

    /**
     * Why the compiler leaves a component alone, or `null` when it rewrites it. Only functions that
     * are components by name are judged: an anonymous callback or a lower-case helper that
     * destructures its argument is destructuring a plain value, not props.
     */
    const unhandledReason = (fn: AstNode): string | null | "not-a-component" => {
      const name = functionName(fn);
      if (name === undefined) {
        if (isAnonymousDefaultExport(fn)) {
          return "an anonymous default export has no name, so the compiler leaves it alone";
        }
        const wrapped = wrappedComponentName(fn);
        if (wrapped === undefined || !isComponentName(wrapped)) return "not-a-component";
        return WRAPPED_REASON;
      }
      if (!isComponentName(name)) return "not-a-component";
      if (!declaredDirectly(fn)) {
        return wrappedComponentName(fn) === undefined
          ? "the compiler only rewrites components that are function declarations or functions assigned to a variable"
          : WRAPPED_REASON;
      }
      if (!compilerHandlesComponent(fn)) {
        return flag(fn, "async") || flag(fn, "generator")
          ? "async and generator functions are not rewritten"
          : "the compiler only rewrites components with a single parameter";
      }
      return null;
    };

    /** True when a comment lies inside the range; a rewrite of that range would delete it. */
    const hasCommentIn = (range: [number, number]): boolean =>
      context.sourceCode
        .getAllComments()
        .some(
          (comment) =>
            comment.range !== undefined &&
            comment.range[0] >= range[0] &&
            comment.range[1] <= range[1],
        );

    /** Suggestion that replaces the destructured names by `<props>.name`. */
    const suggestionFor = (
      fn: AstNode,
      shape: Shape,
      removal: { range: [number, number]; text: string },
      propsName: string,
    ): Rule.SuggestionReportDescriptor[] => {
      if (shape.kind !== "simple" || shape.entries.some((entry) => entry.hasDefault)) return [];
      const componentScope = scopeOf(context, fn);
      const edits: Array<{ range: [number, number]; text: string }> = [removal];
      for (const entry of shape.entries) {
        const variable = resolveVariable(context, entry.identifier);
        if (variable === null || wouldCapture(componentScope, variable, propsName)) return [];
        const rewritten = readsToPropertyAccess(variable, propsName, entry.key);
        if (rewritten === null) return [];
        edits.push(...rewritten);
      }
      if (edits.some((edit) => hasCommentIn(edit.range))) return [];
      return [
        {
          messageId: "useProps",
          fix: (fixer) => edits.map((edit) => fixer.replaceTextRange(edit.range, edit.text)),
        },
      ];
    };

    const checkFunction = (fn: AstNode): void => {
      const params = list(fn, "params");
      const first = params[0];
      if (first === undefined || !containsJsx(fn, keys)) return;
      const unhandled = unhandledReason(fn);
      if (unhandled === "not-a-component") return;

      if (first.type === "ObjectPattern") {
        const shape = shapeOf(first);
        let reason: string | null = null;
        if (!autoReactive) reason = "autoReactive is off";
        else if (unhandled !== null) reason = unhandled;
        else if (shape.kind !== "simple")
          reason = SHAPE_REASON[shape.kind] ?? "unsupported pattern";
        if (reason === null) return;
        const annotation = at(first, "typeAnnotation");
        const annotationText = annotation === null ? "" : text.slice(...annotation.range);
        const conflict = scopeOf(context, fn).set.has("props");
        context.report({
          node: first,
          messageId: "frozenParam",
          data: { reason },
          suggest: conflict
            ? []
            : suggestionFor(
                fn,
                shape,
                { range: first.range, text: `props${annotationText}` },
                "props",
              ),
        });
        return;
      }

      if (first.type !== "Identifier") return;
      const propsName = identName(first);
      if (propsName === undefined) return;
      const body = at(fn, "body");
      const topLevel = body !== null && body.type === "BlockStatement" ? list(body, "body") : [];

      // Declarations `const { a } = props;` that run while the component sets up.
      if (body === null) return;
      walk(body, keys, (node) => {
        if (node !== body && isFunction(node)) return false;
        if (node.type !== "VariableDeclarator") return true;
        const id = at(node, "id");
        const init = at(node, "init");
        const source = init === null ? null : unwrap(init);
        if (
          id === null ||
          id.type !== "ObjectPattern" ||
          init === null ||
          source === null ||
          source.type !== "Identifier" ||
          str(source, "name") !== propsName
        ) {
          return true;
        }
        // The compiler reads the initializer through parentheses only: a cast around `props` is not.
        const castAround = unwrapParens(init).type !== "Identifier";
        const declaration = node.parent;
        const isTopLevelConst =
          declaration !== null &&
          str(declaration, "kind") === "const" &&
          topLevel.includes(declaration);
        const shape = shapeOf(id);
        let reason: string | null = null;
        if (!autoReactive) reason = "autoReactive is off";
        else if (unhandled !== null) reason = unhandled;
        else if (!isTopLevelConst) {
          reason =
            declaration !== null && str(declaration, "kind") !== "const"
              ? "only top-level `const` declarations are rewritten"
              : "only declarations at the top level of the component body are rewritten";
        } else if (castAround) {
          reason = WRAPPED_INIT_REASON;
        } else if (shape.kind !== "simple") {
          reason = SHAPE_REASON[shape.kind] ?? "unsupported pattern";
        }
        if (reason === null) return true;
        const sole =
          declaration !== null &&
          list(declaration, "declarations").length === 1 &&
          declaration.parent !== null &&
          (declaration.parent.type === "BlockStatement" || declaration.parent.type === "Program");
        context.report({
          node: id,
          messageId: "frozenDeclaration",
          data: { props: propsName, reason },
          suggest:
            sole && declaration !== null
              ? suggestionFor(fn, shape, { range: lineRange(declaration), text: "" }, propsName)
              : [],
        });
        return true;
      });
    };

    /** The statement's range widened to its whole line(s) when nothing else shares them. */
    const lineRange = (statement: AstNode): [number, number] => {
      let [start, end] = statement.range;
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
        start = lineStart;
        if (text[end] === "\n") end += 1;
      } else if (text[start - 1] === " " && text[end] === " ") {
        end += 1;
      }
      return [start, end];
    };

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
});
