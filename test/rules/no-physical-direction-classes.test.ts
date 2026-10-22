import { noPhysicalDirectionClasses } from "../../src/rules/no-physical-direction-classes";
import { runRule } from "../support/tester";

runRule("ESL-18", "no-physical-direction-classes", noPhysicalDirectionClasses, {
  valid: [
    '<div class="ms-2 pe-4 start-0 text-start rounded-e-md border-s" />',
    '<div class="rtl:ml-2 ltr:mr-3 data-[side=left]:left-0" />',
    '<div class="hover:[&_.left-2]:ms-2 bg-left text-leftover" />',
    '<div title="ml-2" data-side="right-2" />',
    '<div class={mode === "left-2" ? "ms-2" : "me-2"} />',
    '<div class={customClasses("ml-2")} />',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source code passed to the parser
    "<div class={`left-${offset}`} />",
  ],
  invalid: [
    {
      name: "[ESL-18.B1] a wide class expression hits the node bound without overflowing the stack",
      code: `<div class={[${Array.from({ length: 10_001 }, () => '"ms-2"').join(",")}]} />`,
      errors: [{ messageId: "limit" }],
      output: null,
    },
    {
      code: '<div class="ml-2 pl-4 left-0 text-left" />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            { messageId: "logical", output: '<div class="ms-2 ps-4 start-0 text-start" />' },
          ],
        },
      ],
      output: null,
    },
    {
      code: '<Card className={"hover:-mr-2 !pr-4 rounded-r-lg border-l-2"} />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            {
              messageId: "logical",
              output: '<Card className={"hover:-me-2 !pe-4 rounded-e-lg border-s-2"} />',
            },
          ],
        },
      ],
      output: null,
    },
    {
      code: '<div class={active ? "ml-2" : "right-4"} />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            { messageId: "logical", output: '<div class={active ? "ms-2" : "right-4"} />' },
          ],
        },
        {
          messageId: "physical",
          suggestions: [
            { messageId: "logical", output: '<div class={active ? "ml-2" : "end-4"} />' },
          ],
        },
      ],
      output: null,
    },
    {
      code: '<div class={cn("pl-2", ["mr-1"], { "text-right": active })} />',
      errors: [
        { messageId: "physical", suggestions: 1 },
        { messageId: "physical", suggestions: 1 },
        { messageId: "physical", suggestions: 1 },
      ],
      output: null,
    },
    {
      code: '<div classList={{ "border-r": active }} />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            { messageId: "logical", output: '<div classList={{ "border-e": active }} />' },
          ],
        },
      ],
      output: null,
    },
    {
      code: "<div class={`focus:pl-2`} />",
      errors: [
        {
          messageId: "physical",
          suggestions: [{ messageId: "logical", output: "<div class={`focus:ps-2`} />" }],
        },
      ],
      output: null,
    },
    {
      code: '<div class={"ml-\\u0032"} />',
      errors: [{ messageId: "physical", suggestions: 0 }],
      output: null,
    },
    {
      code: '<div class="hover:ml-2" />',
      options: [{ fix: true }],
      errors: [{ messageId: "physical", suggestions: 0 }],
      output: '<div class="hover:ms-2" />',
    },
  ],
});
