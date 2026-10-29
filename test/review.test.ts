import { jsxNoUnsafeInnerHtml } from "../src/rules/jsx-no-unsafe-inner-html";
import { noPhysicalDirectionClasses } from "../src/rules/no-physical-direction-classes";
import { runRule } from "./support/tester";

runRule("ESL-REV-1", "jsx-no-unsafe-inner-html (optional chaining)", jsxNoUnsafeInnerHtml, {
  valid: [
    // [ESL-REV-1.1] An optional call of an allowed sanitizer is the same call: the sanitizer runs.
    "el.innerHTML = DOMPurify?.sanitize(html);",
    "el.innerHTML = DOMPurify.sanitize?.(html);",
    "const view = <div innerHTML={sanitize?.(html)} />;",
    "const view = <div innerHTML={ok ? DOMPurify?.sanitize(html) : '<i>none</i>'} />;",
  ],
  invalid: [
    {
      name: "[ESL-REV-1.2] an optional call of a function that is not a sanitizer is still reported",
      code: "el.innerHTML = other?.sanitizeNot(html);",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "[ESL-REV-1.3] an optional member read is not a sanitizer call",
      code: "el.innerHTML = html?.value;",
      errors: [{ messageId: "unsafeAssignment" }],
    },
  ],
});

runRule("ESL-REV-2", "no-physical-direction-classes (bare words)", noPhysicalDirectionClasses, {
  valid: [
    // [ESL-REV-2.1] `left`, `right`, `ml` and `pr` are utilities only with a value; alone they are an
    // author's own class names, which the rule must leave alone.
    '<div class="left right" />',
    '<div class="ml pl mr pr" />',
    '<img class="float left" />',
  ],
  invalid: [
    {
      name: "[ESL-REV-2.2] a physical utility next to such a class name is still reported, and only it is rewritten",
      code: '<div class="left ml-2 right" />',
      errors: [
        {
          messageId: "physical",
          suggestions: [{ messageId: "logical", output: '<div class="left ms-2 right" />' }],
        },
      ],
      output: null,
    },
  ],
});
