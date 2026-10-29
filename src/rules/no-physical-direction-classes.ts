import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, identName, list, str, unwrap } from "../utils/ast";
import { jsxAttributeName } from "../utils/jsx";

const MAX_CLASS_NODES = 10_000;
const SIDES: Readonly<Record<string, string>> = { left: "start", right: "end", l: "s", r: "e" };

/** Variants may contain colons inside arbitrary selectors; only top-level colons separate them. */
function logicalToken(token: string): string {
  let depth = 0;
  let start = 0;
  let explicit = false;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) {
      const variant = token.slice(start, index);
      if (variant === "rtl" || variant === "ltr" || variant.includes("data-[side="))
        explicit = true;
      start = index + 1;
    }
  }
  // Explicit direction or a popper's physical side already defines when a physical utility applies.
  if (explicit) return token;
  const utility = token.slice(start);
  const prefix = utility.startsWith("!") ? "!" : "";
  const signed = utility.slice(prefix.length);
  const sign = signed.startsWith("-") ? "-" : "";
  const bare = signed.slice(sign.length);
  const logical = bare.replace(
    // `ml`, `pr`, `left` and `right` are utilities only with a value (`ml-2`, `left-0`); on their own
    // they are an author's own class names (`class="left"`) and must not be rewritten.
    /^(?:(?:[mp][lr]|left|right)(?=-)|(?:text-(?:left|right)|(?:border|rounded)-[lr])(?=-|$))/,
    (physical) => physical.replace(/left$|right$|[lr]$/, (side) => SIDES[side] ?? side),
  );
  return `${token.slice(0, start)}${prefix}${sign}${logical}`;
}

/**
 * Prefer logical Tailwind spacing, alignment, borders and positioning in direction-neutral classes.
 * Checks static class/className strings, classList keys, conditionals, arrays, and cn/clsx/classNames calls.
 * Dynamic strings and unknown helper calls are left alone. Direction and popper-side variants are explicit exceptions.
 *
 * Incorrect: <div class="ml-2 pl-4 text-left" />
 * Correct: <div class="ms-2 ps-4 text-start" />
 * Explicit direction: <div class="rtl:ml-2 ltr:mr-2" />
 *
 * @returns An ESLint rule with suggestions, or autofixes when `{ fix: true }` explicitly requests logical layout.
 * @example <div class="ms-2 ps-4 text-start" />
 * @since 1.0.0
 * @see docs/rules/no-physical-direction-classes.md
 */
export const noPhysicalDirectionClasses: ShadowRule = defineRule({
  name: "no-physical-direction-classes",
  id: "ESL-18",
  type: "suggestion",
  description: "Prefer logical classes for LTR and RTL layouts.",
  recommended: false,
  rationale: "Logical classes mirror with reading direction; physical edges do not.",
  examples: {
    incorrect: ['<div class="ml-2 pl-4 text-left" />'],
    correct: ['<div class="ms-2 ps-4 text-start" />', '<div class="rtl:ml-2 ltr:mr-2" />'],
  },
  notes: ["Static literals only. Allows rtl/ltr/data-[side=...] variants. Limit: 10,000 nodes."],
  fix: "Offers suggestions; { fix: true } enables autofix. Encoded literals have no fix.",
  disableWhen: "Disable for intentional physical edges that do not mirror in RTL.",
  fixable: "code",
  hasSuggestions: true,
  schema: [
    { type: "object", properties: { fix: { type: "boolean" } }, additionalProperties: false },
  ],
  messages: {
    physical: "Use logical direction classes: {{classes}}.",
    logical: "Use logical direction classes.",
    limit: "Class expression exceeds 10,000 nodes. Split it into smaller components.",
  },
  create(context) {
    const option: unknown = context.options[0];
    const autofix =
      typeof option === "object" && option !== null && Reflect.get(option, "fix") === true;
    const reportLiteral = (node: AstNode, value: string): void => {
      const replacement = value.replace(/\S+/g, logicalToken);
      if (replacement === value) return;
      const raw = context.sourceCode.text.slice(node.range[0], node.range[1]);
      // Decoded values can differ from the source's offsets; never rewrite escaped or encoded text.
      const safe = ["'", '"', "`"].includes(raw[0] ?? "") && raw.slice(1, -1) === value;
      const fix = safe
        ? (fixer: import("eslint").Rule.RuleFixer) =>
            fixer.replaceTextRange(node.range, `${raw[0]}${replacement}${raw[raw.length - 1]}`)
        : undefined;
      context.report({
        loc: node.loc,
        messageId: "physical",
        data: { classes: replacement },
        ...(fix === undefined
          ? {}
          : autofix
            ? { fix }
            : { suggest: [{ messageId: "logical", fix }] }),
      });
    };
    return {
      JSXAttribute(attribute) {
        const name = jsxAttributeName(attribute);
        if (name !== "class" && name !== "className" && name !== "classList") return;
        const stack = [at(attribute, "value")];
        let visited = 0;
        let exceeded = false;
        const enqueue = (nodes: readonly AstNode[]): void => {
          if (visited + stack.length + nodes.length > MAX_CLASS_NODES) {
            exceeded = true;
            context.report({ loc: attribute.loc, messageId: "limit" });
            return;
          }
          for (let index = nodes.length - 1; index >= 0; index -= 1) {
            const child = nodes[index];
            if (child !== undefined) stack.push(child);
          }
        };
        while (stack.length > 0 && !exceeded) {
          const next = stack.pop();
          if (next === null || next === undefined) continue;
          visited += 1;
          if (visited > MAX_CLASS_NODES) {
            context.report({ loc: attribute.loc, messageId: "limit" });
            break;
          }
          const node = unwrap(next);
          if (node.type === "Literal") {
            const value = str(node, "value");
            if (value !== undefined) reportLiteral(node, value);
          } else if (node.type === "JSXExpressionContainer") stack.push(at(node, "expression"));
          else if (node.type === "ConditionalExpression")
            stack.push(at(node, "alternate"), at(node, "consequent"));
          else if (node.type === "LogicalExpression")
            stack.push(at(node, "right"), at(node, "left"));
          else if (node.type === "ArrayExpression") enqueue(list(node, "elements"));
          else if (node.type === "ObjectExpression") {
            enqueue(
              list(node, "properties").flatMap((property) => {
                const key = at(property, "key");
                return Reflect.get(property, "computed") === true || key === null ? [] : [key];
              }),
            );
          } else if (node.type === "CallExpression") {
            const callee = identName(at(node, "callee"));
            if (callee === "cn" || callee === "clsx" || callee === "classNames")
              enqueue(list(node, "arguments"));
          } else if (node.type === "TemplateLiteral" && list(node, "expressions").length === 0) {
            const quasi = list(node, "quasis")[0];
            const value: unknown = quasi === undefined ? undefined : Reflect.get(quasi, "value");
            if (typeof value === "object" && value !== null) {
              const cooked: unknown = Reflect.get(value, "cooked");
              if (typeof cooked === "string") reportLiteral(node, cooked);
            }
          }
        }
      },
    };
  },
});
