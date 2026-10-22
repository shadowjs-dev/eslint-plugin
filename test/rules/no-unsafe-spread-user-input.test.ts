import { noUnsafeSpreadUserInput } from "../../src/rules/no-unsafe-spread-user-input";
import { runRule } from "../support/tester";

runRule("ESL-12", "no-unsafe-spread-user-input", noUnsafeSpreadUserInput, {
  valid: [
    "<div {...props} />",
    "<div {...props.rest} />",
    "<div {...local} class='x' />",
    // Components decide for themselves.
    "<Widget {...JSON.parse(text)} />",
    "<Widget.Inner {...location} />",
    // Sanitizers restrict the keys.
    "<div {...pick(JSON.parse(text), ['id', 'title'])} />",
    "<div {...splitProps(props, ['a'])[1]} />",
    // Trusted values.
    "const attrs = { id: 'x' };\n<div {...attrs} />",
    "<div {...config.attrs} />",
    "<div {...{ id: 'x' }} />",
    // Spread of a local, trusted parse result is still flagged only through init analysis; a plain call is not.
    "<div {...makeAttrs()} />",
    { code: "<div {...getAttrs()} />", options: [{ sources: ["^fetchAttrs$"] }] },
    // E1: both branches are checked, and a sanitized branch is trusted.
    "<div {...(ok ? pick(JSON.parse(text), ['id']) : {})} />",
    // E2: a spread on a component is never checked, even through an await.
    "async function view(req) { return <Widget {...(await readFormData(req))} />; }",
    // E3: the value of a non-spread attribute is not the spread's source.
    "<div id={JSON.parse(text)} />",
  ],
  invalid: [
    {
      name: "JSON.parse",
      code: "<div {...JSON.parse(text)} />",
      errors: [{ messageId: "unsafeSpread", data: { source: "JSON.parse(text)", tag: "div" } }],
    },
    {
      name: "form data entries",
      code: "<input {...Object.fromEntries(new FormData(form))} />",
      errors: [
        {
          messageId: "unsafeSpread",
          data: { source: "Object.fromEntries(new FormData(form))", tag: "input" },
        },
      ],
    },
    {
      name: "search params",
      code: "<a {...searchParams} />",
      errors: [{ messageId: "unsafeSpread", data: { source: "searchParams", tag: "a" } }],
    },
    {
      name: "router hooks",
      code: "<a {...useSearchParams()} />",
      errors: [{ messageId: "unsafeSpread" }],
    },
    {
      name: "location and event members",
      code: "<div {...location.hash} {...event.detail} />",
      errors: [{ messageId: "unsafeSpread" }, { messageId: "unsafeSpread" }],
    },
    {
      name: "variable initialized from untrusted data",
      code: "const attrs = JSON.parse(raw);\nconst view = <div {...attrs} />;",
      errors: [{ messageId: "unsafeSpread", data: { source: "attrs", tag: "div" } }],
    },
    {
      name: "alias chain",
      code: "const a = JSON.parse(raw);\nconst b = a;\nconst view = <span {...b} />;",
      errors: [{ messageId: "unsafeSpread", data: { source: "b", tag: "span" } }],
    },
    {
      name: "object spread keeps the taint",
      code: "<div {...{ ...JSON.parse(text), id: 'x' }} />",
      errors: [{ messageId: "unsafeSpread" }],
    },
    {
      name: "TypeScript assertion does not hide it",
      code: "<div {...(JSON.parse(text) as Record<string, string>)} />",
      errors: [{ messageId: "unsafeSpread" }],
    },
    {
      name: "custom sources",
      code: "<div {...fetchAttrs()} />",
      options: [{ sources: ["^fetchAttrs$"] }],
      errors: [{ messageId: "unsafeSpread" }],
    },
    {
      name: "custom sanitizer list replaces the default",
      code: "<div {...pick(JSON.parse(text), ['id'])} />",
      options: [{ sanitizers: ["allowOnly"] }],
      errors: [{ messageId: "unsafeSpread" }],
    },
    {
      name: "E1 optional chain on untrusted data",
      code: "<div {...searchParams?.filters} />",
      errors: [
        {
          messageId: "unsafeSpread",
          data: { source: "searchParams.filters", tag: "div" },
        },
      ],
    },
    {
      name: "E1 untrusted branch of a conditional",
      code: "<div {...(ok ? JSON.parse(text) : {})} />",
      errors: [{ messageId: "unsafeSpread", data: { source: "JSON.parse(text)", tag: "div" } }],
    },
    {
      name: "E1 untrusted fallback of a logical expression",
      code: "<div {...(input || JSON.parse(text))} />",
      errors: [{ messageId: "unsafeSpread" }],
    },
    {
      name: "E2 await inside an async function",
      code: "async function view(req) {\n  const attrs = await readFormData(req);\n  return <div {...attrs} />;\n}",
      errors: [{ messageId: "unsafeSpread", data: { source: "attrs", tag: "div" } }],
    },
    {
      name: "E3 the report is on the line of the spread, not the element",
      code: "<div // from the request\n  id='x'\n  {...searchParams}\n/>",
      errors: [{ messageId: "unsafeSpread", line: 3, column: 3 }],
    },
  ],
});
