import { signalMustBeCalled } from "../../src/rules/signal-must-be-called";
import { runTypedRule } from "../support/tester";

const types = "type Accessor<T> = () => T;\ndeclare const total: Accessor<number>;\n";

runTypedRule("ESL-02", "signal-must-be-called", signalMustBeCalled, {
  valid: [
    `${types}const next = total() + 1;`,
    // Functions with parameters are handlers, not accessors.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
    "declare const handler: (event: number) => void;\nconst s = `${typeof handler}`;",
    // Functions returning void are callbacks.
    "declare const done: () => void;\nconst t = typeof done;\nif (done) { }",
    // Non-function values are untouched.
    "declare const n: number;\nconst m = n + 1;",
    // Passing the accessor along is fine.
    `${types}const forward = total;`,
    // [ESL-02.E10] A TypeScript cast around a call result is a call: nothing to suggest.
    {
      name: "[ESL-02.E10] a cast around the called accessor",
      code: `${types}const label = (total() as number) + 1;`,
    },
    // [ESL-02.E11] A zero-argument function that is only compared to null is a presence check.
    {
      name: "[ESL-02.E11] comparison with null of a typed function",
      code: `${types}const present = total != null;`,
    },
  ],
  invalid: [
    {
      name: "template literal with a typed accessor",
      code: `${types}const label = \`Total: \${total}\`;`,
      errors: [
        {
          messageId: "mustCallTyped",
          suggestions: [
            {
              messageId: "callIt",
              output: `${types}const label = \`Total: \${total()}\`;`,
            },
          ],
        },
      ],
    },
    {
      name: "condition with a typed accessor",
      code: `${types}if (total) { }`,
      errors: [
        {
          messageId: "mustCallTyped",
          suggestions: [{ messageId: "callIt", output: `${types}if (total()) { }` }],
        },
      ],
    },
    // [ESL-02.E12] A TypeScript cast around a typed accessor is a value read: suggest the call.
    {
      name: "[ESL-02.E12] a cast around a typed accessor",
      code: `${types}const label = (total as Accessor<number>) + 1;`,
      errors: [
        {
          messageId: "mustCallTyped",
          suggestions: [
            {
              messageId: "callIt",
              output: `${types}const label = (total() as Accessor<number>) + 1;`,
            },
          ],
        },
      ],
    },
    // [ESL-02.E13] A comment inside the condition stays in the suggested output.
    {
      name: "[ESL-02.E13] a comment inside the condition is kept by the suggestion",
      code: `${types}if (total /* keep */) { }`,
      errors: [
        {
          messageId: "mustCallTyped",
          suggestions: [{ messageId: "callIt", output: `${types}if (total() /* keep */) { }` }],
        },
      ],
    },
    // [ESL-02.E14] An async function type is still a function whose truthiness is always true.
    {
      name: "[ESL-02.E14] an async zero-argument function in a condition",
      code: "declare const load: () => Promise<number>;\nif (load) { }",
      errors: [
        {
          messageId: "mustCallTyped",
          suggestions: [
            {
              messageId: "callIt",
              output: "declare const load: () => Promise<number>;\nif (load()) { }",
            },
          ],
        },
      ],
    },
    // [ESL-02.E15] A JSX spread of a typed accessor spreads nothing: suggest the call.
    {
      name: "[ESL-02.E15] spreading a typed accessor in JSX",
      code: `${types}const view = <div {...total} />;`,
      errors: [
        {
          messageId: "mustCallTyped",
          suggestions: [
            { messageId: "callIt", output: `${types}const view = <div {...total()} />;` },
          ],
        },
      ],
    },
  ],
});
