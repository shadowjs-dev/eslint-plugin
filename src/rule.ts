import type { Rule } from "eslint";
import { type AstNode, asAst } from "./utils/ast";

/**
 * Documentation carried by every rule's `meta.docs`; the docs generator renders it.
 *
 * @since 1.0.0
 */
export interface ShadowRuleDocs {
  /** Invariant id used by the tests (`ESL-07`). */
  id: string;
  /** One sentence, shown in the rule index and by editors. */
  description: string;
  /** Path of the generated page, relative to the package (`docs/rules/<name>.md`). */
  url: string;
  /** Whether `configs.recommended` enables the rule. */
  recommended: boolean;
  /** Longer explanation of why the rule exists, in plain paragraphs. */
  rationale: string;
  /** Code that must be reported and code that must not. */
  examples: {
    incorrect: readonly string[];
    correct: readonly string[];
  };
  /** True when the rule uses TypeScript type information if the parser provides it. */
  typeAware?: boolean;
  /** Free-form notes (limitations, interplay with the compiler). */
  notes?: readonly string[];
  /**
   * What an autofix or suggestion changes and when it is withheld. Required when the rule is
   * fixable or offers suggestions.
   */
  fix?: string;
  /** When a disable comment is legitimate, in one or two sentences. */
  disableWhen: string;
}

/**
 * The authoring input of {@link defineRule}.
 *
 * @since 1.0.0
 */
export interface RuleSpec {
  name: string;
  /** Invariant id used by the tests (`ESL-07`). */
  id: string;
  type: "problem" | "suggestion" | "layout";
  description: string;
  recommended: boolean;
  rationale: string;
  examples: ShadowRuleDocs["examples"];
  typeAware?: boolean;
  notes?: readonly string[];
  fix?: string;
  disableWhen: string;
  messages: Record<string, string>;
  fixable?: "code";
  hasSuggestions?: boolean;
  schema?: Rule.RuleMetaData["schema"];
  defaultOptions?: unknown[];
  create(context: Rule.RuleContext): Record<string, (node: AstNode) => void>;
}

/**
 * A rule module with the documentation the generator needs.
 *
 * @since 1.0.0
 */
export interface ShadowRule extends Rule.RuleModule {
  meta: NonNullable<Rule.RuleModule["meta"]> & { docs: ShadowRuleDocs };
}

/** Docs live next to the package (`docs/rules/<name>.md`); the generator writes them. */
const DOCS_DIR = "docs/rules";

/**
 * Builds a rule module from a spec. Listener nodes are handed to the rule as {@link AstNode}, which
 * also covers JSX and TypeScript nodes that ESTree's types do not list.
 *
 * @param spec Name, documentation, messages and the `create` function.
 * @returns A rule module ready to register in the plugin's `rules` map.
 * @example
 * export const rule = defineRule({ name: "my-rule", type: "problem", ... });
 * @since 1.0.0
 */
export function defineRule(spec: RuleSpec): ShadowRule {
  const docs: ShadowRuleDocs = {
    id: spec.id,
    description: spec.description,
    url: `${DOCS_DIR}/${spec.name}.md`,
    recommended: spec.recommended,
    rationale: spec.rationale,
    examples: spec.examples,
    ...(spec.typeAware === undefined ? {} : { typeAware: spec.typeAware }),
    ...(spec.notes === undefined ? {} : { notes: spec.notes }),
    ...(spec.fix === undefined ? {} : { fix: spec.fix }),
    disableWhen: spec.disableWhen,
  };
  const meta: ShadowRule["meta"] = {
    type: spec.type,
    docs,
    messages: spec.messages,
    schema: spec.schema ?? [],
    ...(spec.fixable === undefined ? {} : { fixable: spec.fixable }),
    ...(spec.hasSuggestions === true ? { hasSuggestions: true } : {}),
    ...(spec.defaultOptions === undefined ? {} : { defaultOptions: spec.defaultOptions }),
  };
  return {
    meta,
    create(context: Rule.RuleContext): Rule.RuleListener {
      const handlers = spec.create(context);
      const listener: Record<string, (node: unknown) => void> = {};
      for (const key of Object.keys(handlers)) {
        const handler = handlers[key];
        if (handler === undefined) continue;
        listener[key] = (node: unknown): void => handler(asAst(node));
      }
      // ESLint calls each key with the ESTree node; the wrapper above narrows it once.
      return listener as unknown as Rule.RuleListener;
    },
  };
}
