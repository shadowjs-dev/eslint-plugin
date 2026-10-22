import { noLowercaseDomAttrsCasing } from "../../src/rules/no-lowercase-dom-attrs-casing";
import { runRule } from "../support/tester";

runRule("ESL-17", "no-lowercase-dom-attrs-casing", noLowercaseDomAttrsCasing, {
  valid: [
    "<div class='a' />",
    "<div className={cls()} />",
    "const a = <div class='a' />;\nconst b = <span class='b' />;",
    "const a = <div className='a' />;\nconst b = <span className='b' />;",
    "<label for='x'>Name</label>",
    "<label htmlFor='x'>Name</label>",
    "<div classList={{ on: x() }} class='a' />",
    "<div class:active={x()} class='a' />",
    // Components are not DOM elements.
    "const a = <Box class='a' className='b' />;",
    "const a = <div class='a' />;\nconst b = <Box className='b' />;",
    "<input tabIndex={1} readonly />",
    // enforce off by default: a consistent file with the alias is fine.
    { code: "<div className='a' />", options: [{}] },
    { code: "<div className='a' />", options: [{ prefer: "react" }] },
    { code: "<div class='a' />\n", options: [{ prefer: "html", enforce: true }] },
    // --- edge cases ------------------------------------------------------------------------
    {
      name: "[ESL-17.E1] a spread, of an object or an identifier, is not an attribute",
      code: "const a = <div {...props} class='a' />;\nconst b = <span {...{ className: 'b' }} class='c' />;",
    },
    {
      name: "[ESL-17.E2] a comment between attributes is not a spelling",
      code: "<div /* legacy */ class='a' // the HTML spelling\n  tabIndex={1} />",
    },
    {
      name: "[ESL-17.E3] TypeScript wrappers around a consistent file are ignored",
      code: "const a = (<div class='a' />) as JSX.Element;\nconst b = <div class={label satisfies string} />;",
    },
    {
      name: "[ESL-17.E4] async components that keep one spelling are valid",
      code: "export const Page = async () => <div class='a' />;\nexport async function Other() { return <p class='x' />; }\nexport const Label = async () => <label for='x' />;",
    },
    {
      name: "[ESL-17.E5] a component's attributes are not counted, even mixed with a DOM element",
      code: "const a = <Card class='a' className='b' />;\nconst b = <section class='c' />;",
    },
  ],
  invalid: [
    {
      name: "both on one element",
      code: "<div class='a' className='b' />",
      output: "<div class='a' class='b' />",
      errors: [
        {
          messageId: "mixedOnElement",
          data: { tag: "div", first: "class", second: "className", preferred: "class" },
        },
      ],
    },
    {
      name: "both on one element, react preferred",
      code: "<div class='a' className='b' />",
      options: [{ prefer: "react" }],
      output: "<div className='a' className='b' />",
      errors: [
        {
          messageId: "mixedOnElement",
          data: { tag: "div", first: "class", second: "className", preferred: "className" },
        },
      ],
    },
    {
      name: "mixed across the file: the alias is reported",
      code: "const a = <div class='a' />;\nconst b = <div className='b' />;",
      output: "const a = <div class='a' />;\nconst b = <div class='b' />;",
      errors: [
        {
          messageId: "mixedInFile",
          data: { html: "class", react: "className", preferred: "class", name: "className" },
        },
      ],
    },
    {
      name: "mixed across the file with prefer react",
      code: "const a = <div class='a' />;\nconst b = <div className='b' />;",
      options: [{ prefer: "react" }],
      output: "const a = <div className='a' />;\nconst b = <div className='b' />;",
      errors: [
        {
          messageId: "mixedInFile",
          data: { html: "class", react: "className", preferred: "className", name: "class" },
        },
      ],
    },
    {
      name: "for and htmlFor",
      code: "const a = <label for='x' />;\nconst b = <label htmlFor='y' />;",
      output: "const a = <label for='x' />;\nconst b = <label for='y' />;",
      errors: [
        {
          messageId: "mixedInFile",
          data: { html: "for", react: "htmlFor", preferred: "for", name: "htmlFor" },
        },
      ],
    },
    {
      name: "enforce reports a consistent file",
      code: "<div className='a' />",
      options: [{ enforce: true }],
      output: "<div class='a' />",
      errors: [
        {
          messageId: "notPreferred",
          data: { preferred: "class", name: "className", html: "class", react: "className" },
        },
      ],
    },
    {
      name: "wrong casings",
      code: "<div classname='a' Class='b' CLASSLIST={{}} htmlfor='x' />",
      // Two spellings of `class` on one element: no fix, since the fix would write the same attribute twice.
      output: "<div classname='a' Class='b' classList={{}} for='x' />",
      errors: [
        { messageId: "wrongCase", data: { name: "classname", preferred: "class" } },
        { messageId: "wrongCase", data: { name: "Class", preferred: "class" } },
        { messageId: "wrongCase", data: { name: "CLASSLIST", preferred: "classList" } },
        { messageId: "wrongCase", data: { name: "htmlfor", preferred: "for" } },
      ],
    },
    // --- edge cases ------------------------------------------------------------------------
    {
      name: "[ESL-17.E6] a wrong casing is not renamed onto a spelling already on the element",
      code: "<div class='a' classname='b' />",
      output: null,
      errors: [{ messageId: "wrongCase", data: { name: "classname", preferred: "class" } }],
    },
    {
      name: "[ESL-17.E7] a wrong casing of classList is not renamed onto an existing classList",
      code: "<div classList={a} CLASSLIST={b} />",
      output: null,
      errors: [{ messageId: "wrongCase", data: { name: "CLASSLIST", preferred: "classList" } }],
    },
    {
      name: "[ESL-17.E8] a comment on the reported line is kept by the fix",
      code: "<div class='a' /* keep */ className='b' />",
      output: "<div class='a' /* keep */ class='b' />",
      errors: [
        {
          messageId: "mixedOnElement",
          data: { tag: "div", first: "class", second: "className", preferred: "class" },
        },
      ],
    },
    {
      name: "[ESL-17.E9] a line comment above a multi-line attribute list is kept",
      code: "<div\n  // the HTML spelling\n  class='a'\n  className='b'\n/>",
      output: "<div\n  // the HTML spelling\n  class='a'\n  class='b'\n/>",
      errors: [
        {
          messageId: "mixedOnElement",
          data: { tag: "div", first: "class", second: "className", preferred: "class" },
        },
      ],
    },
    {
      name: "[ESL-17.E10] a spread between the two spellings does not hide the mix",
      code: "<div {...rest} class='a' {...more} className='b' />",
      output: "<div {...rest} class='a' {...more} class='b' />",
      errors: [
        {
          messageId: "mixedOnElement",
          data: { tag: "div", first: "class", second: "className", preferred: "class" },
        },
      ],
    },
    {
      name: "[ESL-17.E11] the mix is found inside an async function component",
      code: "export async function Page() {\n  return <div class='a' className='b' />;\n}",
      output: "export async function Page() {\n  return <div class='a' class='b' />;\n}",
      errors: [
        {
          messageId: "mixedOnElement",
          data: { tag: "div", first: "class", second: "className", preferred: "class" },
        },
      ],
    },
    {
      name: "[ESL-17.E12] a TypeScript-wrapped JSX element still counts for the file",
      code: "const a = (<div class='a' />) as JSX.Element;\nconst b = <div className='b' /> satisfies unknown;",
      output:
        "const a = (<div class='a' />) as JSX.Element;\nconst b = <div class='b' /> satisfies unknown;",
      errors: [
        {
          messageId: "mixedInFile",
          data: { html: "class", react: "className", preferred: "class", name: "className" },
        },
      ],
    },
    {
      name: "wrong casing with react preference",
      code: "<div classname='a' />",
      options: [{ prefer: "react" }],
      output: "<div className='a' />",
      errors: [{ messageId: "wrongCase", data: { name: "classname", preferred: "className" } }],
    },
    {
      name: "the same attribute twice with different casing",
      code: "<input tabIndex={1} tabindex={2} />",
      errors: [
        {
          messageId: "duplicateCasing",
          data: { tag: "input", name: "tabindex", other: "tabIndex" },
        },
      ],
    },
  ],
});
