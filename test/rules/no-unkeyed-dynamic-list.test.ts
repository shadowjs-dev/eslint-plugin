import { noUnkeyedDynamicList } from "../../src/rules/no-unkeyed-dynamic-list";
import { runRule } from "../support/tester";

const reactive = [
  'import { useSignal } from "@shadow-js/core";',
  "const [todos] = useSignal<Array<{ id: number; title: string }>>([]);",
  "const [rows] = useSignal<Array<{ id: number; name: string }>>([]);",
  "const [obj] = useSignal<Record<string, number>>({});",
  "",
].join("\n");
const web = `import { For } from "@shadow-js/web";\n${reactive}`;

runRule("ESL-14", "no-unkeyed-dynamic-list", noUnkeyedDynamicList, {
  valid: [
    "<ul><For each={todos()}>{(todo) => <li>{todo.title}</li>}</For></ul>",
    // Constants never change: the rows are built once, as with any static markup.
    'const ROLES = ["a", "b"];\nconst v = <ul>{ROLES.map((role) => <li>{role}</li>)}</ul>;',
    "function Menu() { const groups = [{ name: 'a' }]; return <ul>{groups.map((g) => <li>{g.name}</li>)}</ul>; }",
    // A callback parameter is not the component's props.
    "function Menu() { const groups = [{ routes: ['a'] }]; return <ul>{groups.map((g) => <li>{g.routes.map((r) => <b>{r}</b>)}</li>)}</ul>; }",
    // Static lists.
    "<ul>{[1, 2, 3].map((n) => <li>{n}</li>)}</ul>",
    "<ul>{Array.from({ length: 3 }).map((_, i) => <li>{i}</li>)}</ul>",
    "<ul>{Array(3).fill(0).map((_, i) => <li>{i}</li>)}</ul>",
    // map that does not produce JSX.
    "<p>{items().map((x) => x.name).join(', ')}</p>",
    // map outside JSX children.
    "const rows = items().map((x) => <li>{x}</li>);",
    // Attribute position.
    "<Table rows={items().map((x) => <li>{x}</li>)} />",
    // Not Array.prototype.map on a data list (a Map-like with a different name is still `.map`, but no JSX returned).
    "<p>{maybe.map((v) => v + 1)}</p>",
    // E1: a TypeScript assertion around a fixed list is still a fixed list.
    '<ul>{(["a", "b"] as string[]).map((s) => <li>{s}</li>)}</ul>',
    // E2: a comment inside a fixed list does not make it reactive.
    "<ul>{/* fixed */ [1, 2].map((n) => <li>{n}</li>)}</ul>",
  ],
  invalid: [
    {
      name: "plain map with a suggestion that converts to For",
      code: `${web}const v = <ul>{todos().map((todo) => <li>{todo.title}</li>)}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${web}const v = <ul><For each={todos()}>{(todo) => <li>{todo.title}</li>}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "index becomes an accessor",
      code: `${web}const v = <ul>{todos().map((todo, i) => <li>{i}:{todo.title}</li>)}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${web}const v = <ul><For each={todos()}>{(todo, i) => <li>{i()}:{todo.title}</li>}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "key attribute becomes the key function, item becomes an accessor",
      code: `${web}const v = <ul>{rows().map((row) => <li key={row.id}>{row.name}</li>)}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${web}const v = <ul><For each={rows()} key={(row) => row.id}>{(row) => <li>{row().name}</li>}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "block body with a single return",
      code: `${web}const v = <ul>{rows().map((row) => { return <li>{row.name}</li>; })}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${web}const v = <ul><For each={rows()}>{(row) => { return <li>{row.name}</li>; }}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "adds the For import",
      code: `${reactive}const v = <ul>{rows().map((row) => <li>{row}</li>)}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${reactive.replace('import { useSignal } from "@shadow-js/core";', 'import { useSignal } from "@shadow-js/core";\nimport { For } from "@shadow-js/web";')}const v = <ul><For each={rows()}>{(row) => <li>{row}</li>}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "props and destructured props are reactive",
      code: `${web}function A(props: { labels: string[] }) { return <ul>{props.labels.map((l) => <li>{l}</li>)}</ul>; }\nfunction B({ labels }: { labels: string[] }) { return <ul>{labels.map((l) => <li>{l}</li>)}</ul>; }`,
      errors: [
        { messageId: "useFor", suggestions: 1 },
        { messageId: "useFor", suggestions: 1 },
      ],
    },
    {
      name: "a derived constant is followed",
      code: `${web}function A() { const open = rows().filter((r) => r.id > 0); return <ul>{open.map((r) => <li>{r.name}</li>)}</ul>; }`,
      errors: [{ messageId: "useFor", suggestions: 1 }],
    },
    {
      name: "reactiveOnly: false reports static lists as well",
      code: 'const ROLES = ["a", "b"];\nconst v = <ul>{ROLES.map((role) => <li>{role}</li>)}</ul>;',
      options: [{ reactiveOnly: false }],
      errors: [{ messageId: "useFor", suggestions: 1 }],
    },
    {
      name: "optional chain receivers get no suggestion",
      code: `${web}const v = <ul>{rows()?.map((row) => <li>{row}</li>)}</ul>;`,
      errors: [{ messageId: "useFor", suggestions: 0 }],
    },
    {
      name: "destructured parameters get no suggestion",
      code: `${web}const v = <ul>{rows().map(({ name }) => <li>{name}</li>)}</ul>;`,
      errors: [{ messageId: "useFor", suggestions: 0 }],
    },
    {
      name: "multi-statement callbacks get no suggestion",
      code: `${web}const v = <ul>{rows().map((row) => { const n = row.name; return <li>{n}</li>; })}</ul>;`,
      errors: [{ messageId: "useFor", suggestions: 0 }],
    },
    {
      name: "in a fragment and with Object.entries",
      code: `${web}const v = <>{Object.entries(obj()).map(([k, v]) => <b>{k}{v}</b>)}</>;`,
      errors: [{ messageId: "useFor", suggestions: 0 }],
    },
    {
      name: "function expression callbacks are reported without a suggestion",
      code: `${web}const v = <ul>{rows().map(function (row) { return <li>{row}</li>; })}</ul>;`,
      errors: [{ messageId: "useFor", suggestions: 0 }],
    },
    {
      name: "E1 TypeScript assertion on the receiver is kept in the suggestion",
      code: `${web}const v = <ul>{(todos() as Todo[]).map((t) => <li>{t.title}</li>)}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${web}const v = <ul><For each={todos() as Todo[]}>{(t) => <li>{t.title}</li>}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "E1 non-null assertion on the receiver is reactive",
      code: `${web}const v = <ul>{todos()!.map((t) => <li>{t.title}</li>)}</ul>;`,
      errors: [{ messageId: "useFor", suggestions: 1 }],
    },
    {
      name: "E2 an async component is inspected like any other function",
      code: `${web}async function List() { return <ul>{todos().map((t) => <li>{t.title}</li>)}</ul>; }`,
      errors: [{ messageId: "useFor", suggestions: 1 }],
    },
    {
      name: "E3 a comment inside the row callback survives the suggestion",
      code: `${web}const v = <ul>{todos().map((t) => (\n  // one row\n  <li>{t.title}</li>\n))}</ul>;`,
      errors: [
        {
          messageId: "useFor",
          suggestions: [
            {
              messageId: "convertToFor",
              output: `${web}const v = <ul><For each={todos()}>{(t) => (\n  // one row\n  <li>{t.title}</li>\n)}</For></ul>;`,
            },
          ],
        },
      ],
    },
    {
      name: "E4 a comment before the list is not lost: no suggestion",
      code: `${web}const v = <ul>{/* the list */ todos().map((t) => <li>{t.title}</li>)}</ul>;`,
      errors: [{ messageId: "useFor", suggestions: 0 }],
    },
  ],
});
