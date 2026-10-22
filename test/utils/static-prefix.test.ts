import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";
import { parser } from "../../src/parser/index";
import { asAst } from "../../src/utils/ast";
import { jsxAttributeExpression, staticPrefix } from "../../src/utils/jsx";

/**
 * A probe rule that reports what `staticPrefix` returns for each JSX attribute value, so the helper
 * is checked on real parsed code with the shipped parser.
 */
const probe: Rule.RuleModule = {
  create(context) {
    return {
      JSXAttribute(node: unknown): void {
        const attribute = asAst(node);
        const value = jsxAttributeExpression(attribute);
        const prefix = value === null ? undefined : staticPrefix(value);
        const described =
          value === null
            ? "no expression"
            : prefix === undefined
              ? "undefined"
              : JSON.stringify(prefix);
        context.report({ loc: attribute.loc, message: described });
      },
    };
  },
};

/** The value `staticPrefix` gives for the expression inside `href={...}`. */
function prefixOf(expression: string): string {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    `<a href={${expression}} />`,
    [
      {
        files: ["**/*.tsx"],
        plugins: { probe: { rules: { prefix: probe } } },
        languageOptions: {
          parser,
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { "probe/prefix": "error" },
      },
    ],
    { filename: "probe.tsx" },
  );
  const [message] = messages;
  if (message === undefined) throw new Error("the probe reported nothing");
  return message.message;
}

describe("staticPrefix", () => {
  it.each([
    // [ESL-10.U1] The literal, a template's first static part and a `+` chain's known head.
    ['"javascript:void(0)"', '"javascript:void(0)"'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this string is parsed as source by the probe.
    ["`https://${host}`", '"https://"'],
    ['"java" + "script:" + code', '"javascript:"'],
    ['"java" + ("script:" + code)', '"javascript:"'],
    ['"a" + "b" + "c"', '"abc"'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this string is parsed as source by the probe.
    ['"a" + `b${x}` + "c"', '"ab"'],
    ['"a" + code + "b"', '"a"'],
    ['"a" + 1 + code', '"a"'],
    // A dynamic left side has no known start; a numeric left side is not a string.
    ['code + "javascript:"', "undefined"],
    ['1 + "javascript:"', "undefined"],
    ["code", "undefined"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this string is parsed as source by the probe.
    ["`${code}`", '""'],
  ])("%s gives %s", (expression, expected) => {
    // The probe reports `staticPrefix` as JSON, or `undefined`, so compare with the same spelling.
    expect(prefixOf(expression)).toBe(expected);
  });

  it("a complete static left side joins a static right side, at any depth", () => {
    // [ESL-10.U2] A long chain of literals is joined in order and stops at the first dynamic part.
    const parts = Array.from({ length: 12 }, (_, index) => `"p${index}"`);
    const expression = [...parts, "code", '"tail"'].join(" + ");
    expect(prefixOf(expression)).toBe(
      JSON.stringify(parts.map((part) => part.slice(1, -1)).join("")),
    );
  });
});
