import { jsxNoScriptUrl } from "../../src/rules/jsx-no-script-url";
import { runRule } from "../support/tester";

runRule("ESL-10", "jsx-no-script-url", jsxNoScriptUrl, {
  valid: [
    '<a href="/home">Home</a>',
    '<a href="https://example.com/javascript:">x</a>',
    "<a href={url()}>Link</a>",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
    "<a href={`/users/${id}`}>User</a>",
    '<a href={"mailto:" + address}>Mail</a>',
    // A dynamic value before the scheme cannot be judged statically.
    '<a href={address + "javascript:"}>Mail</a>',
    "<button onClick={go}>Go</button>",
    '<a title="javascript:void(0)">not a URL attribute</a>',
    '<div data-href="javascript:x" />',
    '<img src="data:image/png;base64,AAAA" />',
    'link.setAttribute("title", "javascript:go()");',
    'link.href = "/ok";',
    "<a href={cond ? '/a' : '/b'}>x</a>",
    "<a href={user.url}>x</a>",
    // E1: an encoded ampersand decodes to `&`, which is not a scheme.
    '<a href="&amp;javascript:go()">x</a>',
    // E2: entities inside a JavaScript string are not decoded: the value is the text as written.
    '<a href={"&#106;avascript:x"}>x</a>',
    // E3: `javascript-docs` has no colon after the name, so it is a relative path.
    '<a href="javascript-docs/intro">Docs</a>',
    // E4: a template literal that starts with a dynamic part cannot be judged statically.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
    "<a href={`${base}javascript:x`}>x</a>",
    // E5: a non-URL key inside a spread object is not checked.
    '<a {...{ title: "javascript:x" }} />',
  ],
  invalid: [
    {
      code: '<a href="javascript:void(0)">x</a>',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
    {
      name: "mixed case and whitespace are normalized",
      code: '<a href="  JaVa\tScRiPt:alert(1)">x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "template literal prefix",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      code: "<a href={`javascript:${code}`}>x</a>",
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "string concatenation prefix",
      code: '<a href={"javascript:" + code}>x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "either branch of a conditional",
      code: '<a href={ok ? "/x" : "javascript:void(0)"}>x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "fallback of a logical expression",
      code: '<a href={url || "javascript:void(0)"}>x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "other URL attributes",
      code: '<form action="javascript:go()"><iframe src="vbscript:x" /><object data="data:text/html,<b>" /></form>',
      errors: [
        { messageId: "scriptUrl", data: { attr: "action", scheme: "javascript:" } },
        { messageId: "scriptUrl", data: { attr: "src", scheme: "vbscript:" } },
        { messageId: "scriptUrl", data: { attr: "data", scheme: "data:text/html" } },
      ],
    },
    {
      name: "namespaced attribute",
      code: '<svg><a xlink:href="javascript:go()" /></svg>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "component props are checked too (they are forwarded to links)",
      code: '<Link href="javascript:void(0)">x</Link>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "setAttribute",
      code: 'link.setAttribute("href", "javascript:go()");',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
    {
      name: "property assignment",
      code: 'frame.src = "javascript:go()";',
      errors: [{ messageId: "scriptUrl", data: { attr: "src", scheme: "javascript:" } }],
    },
    {
      name: "E1 decimal entity hides the first letter of the scheme",
      code: '<a href="&#106;avascript:alert(1)">x</a>',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
    {
      name: "E1 named entity for the colon",
      code: '<a href="javascript&colon;alert(1)">x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "E2 entities and a line break before the scheme",
      code: '<a href="&#x20;\n&#x09;JavaScript:go()">x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "E2 leading spaces in a template literal",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      code: "<a href={`  JAVASCRIPT:${code}`}>x</a>",
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "E3 concatenation of several static parts",
      code: '<a href={"javascript" + ":" + code}>x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    // [ESL-10.E5] A complete static string on the left joins with what follows, at any depth.
    {
      name: "E5 static parts joined on the left, then a dynamic tail",
      code: '<a href={"java" + "script:" + code}>x</a>',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
    {
      name: "E6 static parts joined on the right of a dynamic-free head",
      code: '<a href={"java" + ("script:" + code)}>x</a>',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
    {
      name: "E7 setAttribute with a joined static value",
      code: 'link.setAttribute("href", "java" + "script:" + go());',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
    {
      name: "E4 TypeScript assertion around a conditional",
      code: '<a href={(ok ? "/x" : "javascript:void(0)") as string}>x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "E4 non-null assertion around a logical expression",
      code: '<a href={(url || "javascript:void(0)")!}>x</a>',
      errors: [{ messageId: "scriptUrl" }],
    },
    {
      name: "E5 URL attribute written in an object spread",
      code: '<a {...{ href: "javascript:go()" }} />',
      errors: [{ messageId: "scriptUrl", data: { attr: "href", scheme: "javascript:" } }],
    },
  ],
});
