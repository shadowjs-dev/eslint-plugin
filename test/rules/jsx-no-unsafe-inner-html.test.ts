import { jsxNoUnsafeInnerHtml } from "../../src/rules/jsx-no-unsafe-inner-html";
import { runRule } from "../support/tester";

const sanitizers = "sanitize, sanitizeHtml, DOMPurify.sanitize, trusted, trustedHtml";

runRule("ESL-11", "jsx-no-unsafe-inner-html", jsxNoUnsafeInnerHtml, {
  valid: [
    '<div innerHTML="<b>static</b>" />',
    "<div innerHTML={'<b>x</b>'} />",
    "<div innerHTML={`<b>x</b>`} />",
    "<div innerHTML={DOMPurify.sanitize(comment().html)} />",
    "<div innerHTML={sanitize(html)} />",
    "<div innerHTML={trusted(html)} />",
    "<div innerHTML={ok ? '<b>a</b>' : sanitize(b)} />",
    "<div>{comment().text}</div>",
    "<div textContent={text()} />",
    "el.textContent = value;",
    "el.innerHTML = '';",
    "el.innerHTML = sanitize(value);",
    "el.insertAdjacentHTML('beforeend', '<hr>');",
    "writer.write(value);",
    { code: "<div innerHTML={clean(html)} />", options: [{ allowedSanitizers: ["clean"] }] },
    {
      code: "<div innerHTML={DOMPurify.sanitize(html)} />",
      options: [{ allowedSanitizers: ["DOMPurify.sanitize"] }],
    },
    // E1: TypeScript wrappers around a sanitizer call, and a comment before it, do not change its trust.
    "<div innerHTML={(sanitize(html)) as string} />",
    "<div innerHTML={/* sanitized upstream */ sanitize(html)} />",
    // E2: an awaited sanitizer in an async component is still a sanitized value.
    "async function view(html) { return <div innerHTML={await sanitize(html)} />; }",
    // E3: both branches are literals.
    `<div innerHTML={ok ? "<b>a</b>" : "<i>b</i>"} />`,
    // E4: an object spread that sets a different attribute is not a sink.
    "<div {...{ textContent: html }} />",
  ],
  invalid: [
    {
      name: "dynamic innerHTML",
      code: "<div innerHTML={comment().html} />",
      errors: [{ messageId: "unsafeAttribute", data: { attr: "innerHTML", sanitizers } }],
    },
    {
      name: "template literal with substitution",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      code: "<div innerHTML={`<b>${name()}</b>`} />",
      errors: [{ messageId: "unsafeAttribute" }],
    },
    {
      name: "prop: namespace",
      code: "<div prop:innerHTML={html()} />",
      errors: [{ messageId: "unsafeAttribute", data: { attr: "prop:innerHTML", sanitizers } }],
    },
    {
      name: "outerHTML",
      code: "<div outerHTML={html} />",
      errors: [{ messageId: "unsafeAttribute" }],
    },
    {
      name: "unknown sanitizer is not trusted",
      code: "<div innerHTML={clean(html)} />",
      errors: [{ messageId: "unsafeAttribute" }],
    },
    {
      name: "one unsafe branch",
      code: "<div innerHTML={ok ? '<b>a</b>' : html} />",
      errors: [{ messageId: "unsafeAttribute" }],
    },
    {
      name: "React dangerouslySetInnerHTML with a suggestion",
      code: "<div dangerouslySetInnerHTML={{ __html: html }} />",
      errors: [
        {
          messageId: "reactApi",
          suggestions: [{ messageId: "useInnerHtml", output: "<div innerHTML={html} />" }],
        },
      ],
    },
    {
      name: "dangerouslySetInnerHTML with a non-literal object has no suggestion",
      code: "<div dangerouslySetInnerHTML={props.inner} />",
      errors: [{ messageId: "reactApi", suggestions: 0 }],
    },
    {
      name: "innerHTML assignment",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      code: "el.innerHTML = `<b>${name}</b>`;",
      errors: [{ messageId: "unsafeAssignment", data: { property: "innerHTML", sanitizers } }],
    },
    {
      name: "outerHTML assignment",
      code: "el.outerHTML = html;",
      errors: [{ messageId: "unsafeAssignment" }],
    },
    {
      name: "insertAdjacentHTML",
      code: "el.insertAdjacentHTML('beforeend', html);",
      errors: [{ messageId: "unsafeSink", data: { method: "insertAdjacentHTML", sanitizers } }],
    },
    {
      name: "createContextualFragment and document.write",
      code: "range.createContextualFragment(html);\ndocument.write(html);",
      errors: [
        { messageId: "unsafeSink", data: { method: "createContextualFragment", sanitizers } },
        { messageId: "unsafeSink", data: { method: "write", sanitizers } },
      ],
    },
    {
      name: "custom sanitizer list replaces the default",
      code: "<div innerHTML={sanitize(html)} />",
      options: [{ allowedSanitizers: ["clean"] }],
      errors: [{ messageId: "unsafeAttribute", data: { attr: "innerHTML", sanitizers: "clean" } }],
    },
    {
      name: "E1 a TypeScript wrapper does not make the value trusted",
      code: "<div innerHTML={html as string} />",
      errors: [{ messageId: "unsafeAttribute" }],
    },
    {
      name: "E2 innerHTML written in an object spread",
      code: "<div {...{ innerHTML: html }} />",
      errors: [{ messageId: "unsafeAttribute", data: { attr: "innerHTML", sanitizers } }],
    },
    {
      name: "E2 React API written in an object spread has no suggestion",
      code: "<div {...{ dangerouslySetInnerHTML: { __html: html } }} />",
      errors: [{ messageId: "reactApi", suggestions: 0 }],
    },
    {
      name: "E3 the report is on the line of the attribute, below a comment",
      code: "<div\n  // rendered upstream\n  innerHTML={html}\n/>",
      errors: [{ messageId: "unsafeAttribute", line: 3, column: 3 }],
    },
    {
      name: "E4 the suggestion keeps a comment inside the value and one after the attribute",
      code: "<div dangerouslySetInnerHTML={{ __html: /* trusted */ html }} /* keep */ />",
      errors: [
        {
          messageId: "reactApi",
          suggestions: [
            {
              messageId: "useInnerHtml",
              output: "<div innerHTML={/* trusted */ html} /* keep */ />",
            },
          ],
        },
      ],
    },
  ],
});
