import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, list } from "../utils/ast";
import { isIntrinsicTag, jsxAttributeName, jsxTagName } from "../utils/jsx";

/** Pairs written two ways: the HTML spelling and the React-style alias. Both work; mixing them is noise. */
const PAIRS = [
  { html: "class", react: "className" },
  { html: "for", react: "htmlFor" },
] as const;

type Prefer = "html" | "react";

interface Options {
  prefer?: Prefer;
  enforce?: boolean;
}

interface Use {
  node: AstNode;
  name: string;
  side: "html" | "react";
  pair: number;
}

/**
 * Keep DOM attribute spelling consistent: do not mix `class` / `className` (or `for` / `htmlFor`).
 *
 * What it catches and why: ShadowJS accepts both the HTML spelling (`class`, `for`) and the
 * React-style aliases (`className`, `htmlFor`); the compiler writes both as the same attribute.
 * Using both in one codebase makes search and review harder, and both on one element is ambiguous.
 * On intrinsic elements (lowercase tags; components and namespaced attributes are left alone) the
 * rule reports:
 * - both spellings of a pair on one element (the non-preferred one is reported);
 * - both spellings of a pair in one file (each non-preferred use is reported);
 * - with `enforce: true`, every non-preferred spelling even when the file is consistent;
 * - a wrong casing of `class`, `className`, `classList`, `for` or `htmlFor` (`classname`, `Class`),
 *   which is not an attribute the runtime knows;
 * - the same attribute written with two casings on one element (`tabIndex` and `tabindex`).
 *
 * Incorrect:
 *
 * ```tsx
 * <div class='a' className='b' />
 * ```
 *
 * ```tsx
 * const a = <div class='a' />;
 * const b = <div className='b' />;
 * ```
 *
 * ```tsx
 * <div classname='a' />
 * ```
 *
 * ```tsx
 * <label htmlFor='x' for='y' />
 * ```
 *
 * Correct:
 *
 * ```tsx
 * <div class='a' />
 * ```
 *
 * ```tsx
 * <div className={cls()} />
 * ```
 *
 * ```tsx
 * <label for='x'>Name</label>
 * ```
 *
 * Options: one object.
 * - `prefer` (`"html"` or `"react"`, default `"html"`): the spelling to keep.
 * - `enforce` (boolean, default `false`): report every non-preferred spelling, not only mixing.
 *
 * Autofix: the fix renames the reported attribute to the preferred spelling (`className` to
 * `class`, `htmlFor` to `for`, or the reverse with `prefer: "react"`) and a wrong casing to the
 * preferred spelling of its pair (`classList` for a wrong casing of `classList`). The same
 * attribute written with two casings is reported without a fix, since the rule cannot tell which
 * one is meant. A wrong casing is fixed only when the element has no other spelling of its attribute:
 * a rename onto a spelling already there would write the attribute twice, and the later one would
 * silently win.
 *
 * Disabling: `// eslint-disable-next-line shadow/no-lowercase-dom-attrs-casing` above the line, or a
 * block between `/* eslint-disable shadow/no-lowercase-dom-attrs-casing *\/` and
 * `/* eslint-enable shadow/no-lowercase-dom-attrs-casing *\/`. A disable is legitimate for a file
 * that mirrors markup from elsewhere (pasted HTML next to ported React) while it is being
 * converted.
 *
 * Configs:
 * - `recommended`: `warn`
 * - `strict`: `error` with `{ enforce: true }`
 * - `migration`: off
 * - `dusk`: `warn`
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   { rules: { "shadow/no-lowercase-dom-attrs-casing": ["warn", { prefer: "react" }] } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/no-lowercase-dom-attrs-casing.md
 */
export const noLowercaseDomAttrsCasing: ShadowRule = defineRule({
  name: "no-lowercase-dom-attrs-casing",
  id: "ESL-17",
  type: "suggestion",
  description:
    "Keep DOM attribute spelling consistent: do not mix `class` / `className` (or `for` / `htmlFor`).",
  recommended: true,
  rationale:
    "ShadowJS accepts both the HTML spelling (`class`, `for`) and the React-style aliases (`className`, " +
    "`htmlFor`). Using both in one codebase makes search and review harder, and both on one element is " +
    "ambiguous: the later spread or attribute wins. Pick one (the HTML spelling by default). Misspelled " +
    "variants such as `classname` or `Class` are not attributes the runtime knows.",
  examples: {
    incorrect: [
      "<div class='a' className='b' />",
      "const a = <div class='a' />;\nconst b = <div className='b' />;",
      "<div classname='a' />",
      "<label htmlFor='x' for='y' />",
    ],
    correct: ["<div class='a' />", "<div className={cls()} />", "<label for='x'>Name</label>"],
  },
  notes: [
    "Default: only reports mixing (on one element, or both spellings used in one file). The non-preferred spelling is reported.",
    "Option `prefer` (`html` default, or `react`) chooses the spelling to keep; `enforce: true` reports every non-preferred spelling, even when the file is consistent.",
    "Also reported: the same attribute written with two casings on one element (`tabIndex` and `tabindex`), and wrong casings of `class`, `className`, `classList`, `for` and `htmlFor`.",
  ],
  fix: "The fix renames the reported attribute to the preferred spelling (`className` to `class` and `htmlFor` to `for`, or the reverse with `prefer: 'react'`), and a wrong casing to the preferred spelling of its pair (or to `classList`). The same attribute written with two casings is reported without a fix, since the rule cannot tell which one is meant. A wrong casing is fixed only when the element has no other spelling of its attribute, since the rename would write the attribute twice.",
  disableWhen:
    "Disable it for a file that mirrors markup from elsewhere (pasted HTML next to ported React) while it is being converted.",
  fixable: "code",
  schema: [
    {
      type: "object",
      properties: {
        prefer: { enum: ["html", "react"] },
        enforce: { type: "boolean" },
      },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{ prefer: "html", enforce: false }],
  messages: {
    mixedOnElement: "<{{tag}}> has both `{{first}}` and `{{second}}`. Keep one: `{{preferred}}`.",
    mixedInFile:
      "This file uses both `{{html}}` and `{{react}}`. Use `{{preferred}}` consistently.",
    notPreferred: "Use `{{preferred}}` instead of `{{name}}`.",
    wrongCase: "`{{name}}` is not an attribute the runtime knows. Use `{{preferred}}`.",
    duplicateCasing: "<{{tag}}> sets `{{name}}` and `{{other}}`, which are the same attribute.",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const prefer: Prefer = options.prefer ?? "html";
    const enforce = options.enforce === true;
    const uses: Use[] = [];

    const preferredOf = (pair: number): string => {
      const entry = PAIRS[pair];
      return entry === undefined ? "" : entry[prefer];
    };

    const rename = (node: AstNode, replacement: string) => {
      const nameNode = at(node, "name");
      return nameNode === null
        ? undefined
        : (fixer: import("eslint").Rule.RuleFixer) =>
            fixer.replaceTextRange(nameNode.range, replacement);
    };

    return {
      JSXOpeningElement(opening) {
        const tag = jsxTagName(opening);
        if (!isIntrinsicTag(tag)) return;
        const attributes = list(opening, "attributes").filter((a) => a.type === "JSXAttribute");
        const seen = new Map<string, AstNode>();
        const named = new Map<string, AstNode>();
        // Attributes per lower-cased name, so a wrong casing can tell whether its target is already here.
        const counts = new Map<string, number>();
        for (const attribute of attributes) {
          const name = jsxAttributeName(attribute);
          if (name === undefined || name.includes(":")) continue;
          const lower = name.toLowerCase();
          counts.set(lower, (counts.get(lower) ?? 0) + 1);
        }

        for (const attribute of attributes) {
          const name = jsxAttributeName(attribute);
          if (name === undefined || name.includes(":")) continue;
          const lower = name.toLowerCase();

          // Wrong casings of the aliases.
          const pairIndex = PAIRS.findIndex(
            (pair) => lower === pair.html || lower === pair.react.toLowerCase(),
          );
          const pair = PAIRS[pairIndex];
          if (pair !== undefined) {
            const isHtml = name === pair.html;
            const isReact = name === pair.react;
            if (!isHtml && !isReact) {
              // Renaming onto a spelling the element already has would write one attribute twice, and
              // the later one would silently win: then the rule reports without a fix.
              const spellings =
                (counts.get(pair.html) ?? 0) + (counts.get(pair.react.toLowerCase()) ?? 0);
              const fix = spellings === 1 ? rename(attribute, preferredOf(pairIndex)) : undefined;
              context.report({
                node: attribute,
                messageId: "wrongCase",
                data: { name, preferred: preferredOf(pairIndex) },
                ...(fix === undefined ? {} : { fix }),
              });
              continue;
            }
            uses.push({ node: attribute, name, side: isHtml ? "html" : "react", pair: pairIndex });
            const other = named.get(`pair${pairIndex}`);
            if (other !== undefined) {
              const first = jsxAttributeName(other) ?? "";
              if (first !== name) {
                // Report (and fix) the spelling that is not the preferred one.
                const offender = name === preferredOf(pairIndex) ? other : attribute;
                const fix = rename(offender, preferredOf(pairIndex));
                context.report({
                  node: offender,
                  messageId: "mixedOnElement",
                  data: {
                    tag: tag ?? "element",
                    first,
                    second: name,
                    preferred: preferredOf(pairIndex),
                  },
                  ...(fix === undefined ? {} : { fix }),
                });
              }
            } else {
              named.set(`pair${pairIndex}`, attribute);
            }
            continue;
          }
          if (lower === "classlist" && name !== "classList") {
            const fix = counts.get("classlist") === 1 ? rename(attribute, "classList") : undefined;
            context.report({
              node: attribute,
              messageId: "wrongCase",
              data: { name, preferred: "classList" },
              ...(fix === undefined ? {} : { fix }),
            });
            continue;
          }

          const previous = seen.get(lower);
          if (previous !== undefined) {
            const other = jsxAttributeName(previous) ?? "";
            if (other !== name) {
              context.report({
                node: attribute,
                messageId: "duplicateCasing",
                data: { tag: tag ?? "element", name, other },
              });
            }
          } else {
            seen.set(lower, attribute);
          }
        }
      },
      "Program:exit"() {
        for (let pair = 0; pair < PAIRS.length; pair += 1) {
          const entry = PAIRS[pair];
          if (entry === undefined) continue;
          const here = uses.filter((use) => use.pair === pair);
          const html = here.filter((use) => use.side === "html");
          const react = here.filter((use) => use.side === "react");
          const mixed = html.length > 0 && react.length > 0;
          const offenders = prefer === "html" ? react : html;
          if (!mixed && !enforce) continue;
          for (const use of offenders) {
            // Elements that were already reported as mixed on one element keep that one message.
            const sameElement = here.some(
              (other) =>
                other !== use && other.node.parent === use.node.parent && other.side !== use.side,
            );
            if (sameElement) continue;
            const fix = rename(use.node, preferredOf(pair));
            context.report({
              node: use.node,
              messageId: mixed ? "mixedInFile" : "notPreferred",
              data: {
                html: entry.html,
                react: entry.react,
                preferred: preferredOf(pair),
                name: use.name,
              },
              ...(fix === undefined ? {} : { fix }),
            });
          }
        }
      },
    };
  },
});
