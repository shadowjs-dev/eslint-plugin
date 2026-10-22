import { validEventNames } from "../../src/rules/valid-event-names";
import { runRule } from "../support/tester";

const core =
  'import { useSignal } from "@shadow-js/core";\nconst [open, setOpen] = useSignal(false);\n';

runRule("ESL-16", "valid-event-names", validEventNames, {
  valid: [
    "<button onClick={save}>x</button>",
    "<button onclick={save}>x</button>",
    "<button onKeyDown={a} onDoubleClick={b} onDblClick={c} onMouseEnter={d}>x</button>",
    "<input onInput={a} onChange={b} onFocus={c} onBlur={d} />",
    "<video onTimeUpdate={a} onCanPlayThrough={b} />",
    "<div onPointerDown={a} onTouchStart={b} onWheel={c} onScroll={d} onAnimationEnd={e} />",
    "<button on:click={save} oncapture:click={log}>x</button>",
    // React's capture spelling binds the capture phase (dom-runtime contract, DEC-REACT-NAMES).
    "<button onClickCapture={log} onKeyDownCapture={key} onFocusCapture={focus}>x</button>",
    "<div on:my-custom-event={custom} on:selectionMade={custom} />",
    "<button onClick={[save, id]}>x</button>",
    "<button onClick={() => setOpen(true)}>x</button>",
    "<button onClick={{ handleEvent: save, once: true }}>x</button>",
    // Components define their own on* props.
    "<Dialog onClose={close} onFooBar={x} onClik={y} />",
    // Non-handler attributes starting with "on" letters but not event-like are not checked.
    '<input data-once="x" />',
    // The returned HOF pattern is allowed.
    "<button onClick={makeHandler(id)}>x</button>",
    "<g onClick={a} />",
    // Spread attributes are not judged.
    "<button {...props} />",
    `${core}<button onClick={() => setOpen(false)} />`,
    // [ESL-16.E1] TypeScript wrappers around a function value are not calls.
    `${core}<button onClick={setOpen as Handler} on:input={update!} />`,
    // [ESL-16.E2] A spread is not judged, and the attributes after it still are not spread-checked.
    {
      name: "[ESL-16.E2] a misspelled handler inside a spread object is not an attribute",
      code: "<button {...{ onClik: save }} />",
    },
    // [ESL-16.E3] Async handlers are functions: they are passed, not called.
    {
      name: "[ESL-16.E3] async arrow and async function handlers",
      code: `${core}<button onClick={async () => { await save(); }} onFocus={async function () { await load(); }} />`,
    },
    // [ESL-16.E4] A local named like a global function returns a handler; it is not the global.
    {
      name: "[ESL-16.E4] a local alert() returning a handler is not the global alert",
      code: "const alert = makeHandler();\nconst view = <button onClick={alert(1)}>x</button>;",
    },
  ],
  invalid: [
    {
      name: "typo with a suggestion",
      code: "<button onClik={save}>x</button>",
      errors: [
        {
          messageId: "unknownEvent",
          data: { name: "onClik" },
          suggestions: [
            {
              messageId: "didYouMean",
              data: { replacement: "onClick" },
              output: "<button onClick={save}>x</button>",
            },
          ],
        },
      ],
    },
    {
      name: "typo in a long name",
      code: "<div onMouseOvr={a} />",
      errors: [
        {
          messageId: "unknownEvent",
          suggestions: [
            {
              messageId: "didYouMean",
              data: { replacement: "onMouseOver" },
              output: "<div onMouseOver={a} />",
            },
          ],
        },
      ],
    },
    {
      name: "unknown without a close match has no suggestion",
      code: "<div onSomethingElseEntirely={a} />",
      errors: [{ messageId: "unknownEvent", suggestions: 0 }],
    },
    {
      name: "a capture suffix on a lower-case name is not React's spelling: no capture phase",
      code: "<button onclickCapture={log}>x</button>",
      errors: [
        {
          messageId: "captureSuffix",
          data: { name: "onclickCapture", event: "click" },
          suggestions: [
            {
              messageId: "useCapture",
              data: { event: "click" },
              output: "<button oncapture:click={log}>x</button>",
            },
          ],
        },
      ],
    },
    {
      name: "a capture suffix on an unknown React-spelled name",
      code: "<button onClikCapture={log}>x</button>",
      errors: [{ messageId: "unknownEvent", data: { name: "onClikCapture" } }],
    },
    {
      name: "namespaced name with capital letters is fixed",
      code: "<input on:Input={update} oncapture:KeyDown={k} />",
      output: "<input on:input={update} oncapture:keydown={k} />",
      errors: [
        { messageId: "badCasing", data: { name: "on:Input", replacement: "on:input" } },
        {
          messageId: "badCasing",
          data: { name: "oncapture:KeyDown", replacement: "oncapture:keydown" },
        },
      ],
    },
    {
      name: "string handler",
      code: '<button onClick="save()">x</button>',
      errors: [{ messageId: "stringHandler", data: { name: "onClick" } }],
    },
    {
      name: "template string handler",
      code: "<button onClick={`save()`}>x</button>",
      errors: [{ messageId: "stringHandler" }],
    },
    {
      name: "setter called at render",
      code: `${core}<button onClick={setOpen(true)}>x</button>`,
      errors: [{ messageId: "calledHandler", data: { name: "onClick" } }],
    },
    {
      name: "console and alert called at render",
      code: "<button onClick={console.log('x')} onFocus={alert('hi')}>x</button>",
      errors: [{ messageId: "calledHandler" }, { messageId: "calledHandler" }],
    },
    {
      name: "namespaced attribute with a string",
      code: '<button on:click="go()">x</button>',
      errors: [{ messageId: "stringHandler", data: { name: "on:click" } }],
    },
    // [ESL-16.E5] TypeScript wrappers around the call do not hide it.
    {
      name: "[ESL-16.E5] a setter call under TypeScript wrappers still runs at render",
      code: `${core}<button onClick={setOpen(true) as Handler} onFocus={setOpen(false)!}>x</button>`,
      errors: [
        { messageId: "calledHandler", data: { name: "onClick" } },
        { messageId: "calledHandler", data: { name: "onFocus" } },
      ],
    },
    {
      name: "[ESL-16.E6] a string under TypeScript wrappers is still a string",
      code: '<button onClick={"save()" as string}>x</button>',
      errors: [{ messageId: "stringHandler", data: { name: "onClick" } }],
    },
    // [ESL-16.E7] An optional call runs at render just like a plain call.
    {
      name: "[ESL-16.E7] an optional call of a setter runs at render",
      code: `${core}<button onClick={setOpen?.(true)}>x</button>`,
      errors: [{ messageId: "calledHandler", data: { name: "onClick" } }],
    },
    // [ESL-16.E8] Comments survive the fixes: the rename keeps the comments around the attribute.
    {
      name: "[ESL-16.E8] comments around a misspelled handler are kept by the suggestion",
      code: "<button /* keep */ onClik={save} // trailing\n>x</button>",
      output: null,
      errors: [
        {
          messageId: "unknownEvent",
          suggestions: [
            {
              messageId: "didYouMean",
              data: { replacement: "onClick" },
              output: "<button /* keep */ onClick={save} // trailing\n>x</button>",
            },
          ],
        },
      ],
    },
    {
      name: "[ESL-16.E9] comments inside a namespaced casing fix are kept",
      code: "<input /* a */ on:Input={update} /* b */ />",
      output: "<input /* a */ on:input={update} /* b */ />",
      errors: [{ messageId: "badCasing", data: { name: "on:Input", replacement: "on:input" } }],
    },
    // [ESL-16.E10] A misspelled handler still reported when a spread comes first.
    {
      name: "[ESL-16.E10] a misspelled attribute after a spread is still reported",
      code: "<button {...props} onClik={save} />",
      errors: [
        {
          messageId: "unknownEvent",
          data: { name: "onClik" },
          suggestions: [
            {
              messageId: "didYouMean",
              data: { replacement: "onClick" },
              output: "<button {...props} onClick={save} />",
            },
          ],
        },
      ],
    },
  ],
});
