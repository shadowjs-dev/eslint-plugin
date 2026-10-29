import { jsxNoUnsafeInnerHtml } from "../src/rules/jsx-no-unsafe-inner-html";
import { runRule } from "./support/tester";

const sanitizers = "sanitize, sanitizeHtml, DOMPurify.sanitize, trusted, trustedHtml";

runRule("ESL-R2-6", "jsx-no-unsafe-inner-html (iframe srcdoc)", jsxNoUnsafeInnerHtml, {
  valid: [
    // [ESL-R2-6.1] The same trust rules as innerHTML: a literal or an allowed sanitizer.
    '<iframe srcdoc="<p>static</p>" />',
    "<iframe srcdoc={DOMPurify.sanitize(html)} />",
    "<iframe prop:srcdoc={sanitize(html)} />",
    "frame.srcdoc = sanitize(html);",
    // [ESL-R2-6.2] Only an iframe takes the attribute as a document: other elements and components keep it.
    "<div srcdoc={html} />",
    "<Frame srcdoc={html} />",
  ],
  invalid: [
    {
      name: "[ESL-R2-6.3] a dynamic srcdoc on an iframe",
      code: "<iframe srcdoc={html()} />",
      errors: [{ messageId: "unsafeAttribute", data: { attr: "srcdoc", sanitizers } }],
    },
    {
      name: "[ESL-R2-6.4] the prop: form and the React casing",
      code: "<iframe prop:srcdoc={html} srcDoc={html} />",
      errors: [{ messageId: "unsafeAttribute" }, { messageId: "unsafeAttribute" }],
    },
    {
      name: "[ESL-R2-6.5] an object spread onto an iframe",
      code: "<iframe {...{ srcdoc: html }} />",
      errors: [{ messageId: "unsafeAttribute", data: { attr: "srcdoc", sanitizers } }],
    },
    {
      name: "[ESL-R2-6.6] an assignment to .srcdoc",
      code: "frame.srcdoc = html;",
      errors: [{ messageId: "unsafeAssignment", data: { property: "srcdoc", sanitizers } }],
    },
  ],
});

runRule("ESL-R2-7", "jsx-no-unsafe-inner-html (sanitizer identity)", jsxNoUnsafeInnerHtml, {
  valid: [
    // [ESL-R2-7.1] A sequence expression calls its last value: `(0, f)(x)` is `f(x)` without `this`.
    "el.innerHTML = (0, DOMPurify.sanitize)(html);",
    "el.innerHTML = (0, sanitize)(html);",
    "el.innerHTML = (log(), 0, DOMPurify.sanitize)(html);",
    "el.innerHTML = (0, '<b>x</b>');",
    // [ESL-R2-7.2] The imported DOMPurify, however it was bound.
    'import DOMPurify from "dompurify"; el.innerHTML = DOMPurify.sanitize(html);',
    'import * as DOMPurify from "dompurify"; el.innerHTML = (0, DOMPurify.sanitize)(html);',
    'import createDOMPurify from "dompurify"; const DOMPurify = createDOMPurify(window); el.innerHTML = DOMPurify.sanitize(html);',
    'const DOMPurify = require("dompurify"); el.innerHTML = DOMPurify.sanitize(html);',
    // The global one.
    "el.innerHTML = DOMPurify.sanitize(html);",
  ],
  invalid: [
    {
      name: "[ESL-R2-7.3] a local object named DOMPurify is not the library",
      code: "const DOMPurify = { sanitize: (value) => value }; el.innerHTML = DOMPurify.sanitize(html);",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "[ESL-R2-7.4] a parameter named DOMPurify shadows the global",
      code: "function show(DOMPurify, html) { el.innerHTML = DOMPurify.sanitize(html); }",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "[ESL-R2-7.5] the shadowing is also seen through a sequence expression",
      code: "const DOMPurify = makeFake(); el.innerHTML = (0, DOMPurify.sanitize)(html);",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "[ESL-R2-7.6] a sequence that ends in something else is not trusted",
      code: "el.innerHTML = (DOMPurify.sanitize(html), other);",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "[ESL-R2-7.7] a sequence that calls a function that is not a sanitizer is reported",
      code: "el.innerHTML = (0, other.sanitizeNot)(html);",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "[ESL-R2-7.8] a local DOMPurify built from a local function is not the library",
      code: "function makeFake() { return { sanitize: (value) => value }; } const DOMPurify = makeFake(); el.innerHTML = DOMPurify.sanitize(html);",
      errors: [{ messageId: "unsafeAssignment" }],
    },
  ],
});
