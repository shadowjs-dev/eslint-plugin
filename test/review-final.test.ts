import { jsxNoUnsafeInnerHtml } from "../src/rules/jsx-no-unsafe-inner-html";
import { runRule } from "./support/tester";

runRule(
  "ESL-FINAL-1",
  "jsx-no-unsafe-inner-html (the library, however it is loaded)",
  jsxNoUnsafeInnerHtml,
  {
    valid: [
      // [ESL-FINAL-1.1] A DOMPurify loaded with a dynamic import is the library.
      'async function show(html) { const { default: DOMPurify } = await import("dompurify"); el.innerHTML = DOMPurify.sanitize(html); }',
      'async function show(html) { const DOMPurify = (await import("dompurify")).default; el.innerHTML = DOMPurify.sanitize(html); }',
      'const DOMPurify = require("dompurify").default; el.innerHTML = DOMPurify.sanitize(html);',
      // [ESL-FINAL-1.2] A DOMPurify the configuration declares as a global (a script tag loads it) is the global.
      {
        code: "el.innerHTML = DOMPurify.sanitize(html);",
        languageOptions: { globals: { DOMPurify: "readonly" } },
      },
      // [ESL-FINAL-1.5] An ambient `declare const DOMPurify` only states the type of the global.
      "declare const DOMPurify: { sanitize(html: string): string }; el.innerHTML = DOMPurify.sanitize(html);",
    ],
    invalid: [
      {
        name: "[ESL-FINAL-1.3] a local object, even one read through a member or an await, is still not the library",
        code: "async function show(html) { const DOMPurify = (await makeFake()).sanitizer; el.innerHTML = DOMPurify.sanitize(html); }",
        errors: [{ messageId: "unsafeAssignment" }],
      },
      {
        name: "[ESL-FINAL-1.6] a const DOMPurify that is not declared ambient and has no module source is not the library",
        code: "const DOMPurify = { sanitize: (html) => html }; el.innerHTML = DOMPurify.sanitize(html);",
        errors: [{ messageId: "unsafeAssignment" }],
      },
      {
        name: "[ESL-FINAL-1.4] a parameter named DOMPurify is not a configured global",
        code: "function show(DOMPurify, html) { el.innerHTML = DOMPurify.sanitize(html); }",
        languageOptions: { globals: { DOMPurify: "readonly" } },
        errors: [{ messageId: "unsafeAssignment" }],
      },
    ],
  },
);
