import { forKeyRequiredForReorder } from "../../src/rules/for-key-required-for-reorder";
import { runRule } from "../support/tester";

const web = [
  'import { For } from "@shadow-js/web";',
  'import { useSignal } from "@shadow-js/core";',
  "const [todos] = useSignal<Array<{ id: number; title: string }>>([]);",
  "const [rows] = useSignal<Array<{ id: number; name: string }>>([]);",
  "const [sel] = useSignal(0);",
  "",
].join("\n");

runRule("ESL-13", "for-key-required-for-reorder", forKeyRequiredForReorder, {
  valid: [
    `${web}const v = <For each={todos()} key={(todo) => todo.id}>{(todo) => <li>{todo().title}</li>}</For>;`,
    // A list that never changes keeps its rows: nothing to match.
    `${web}const TABS = [{ id: "a" }, { id: "b" }];\nconst v = <For each={TABS}>{(tab) => <li>{tab.id}</li>}</For>;`,
    `${web}const v = <For each={[{ id: 1 }]}>{(row) => <li>{row.id}</li>}</For>;`,
    // Primitives have no identity field.
    `${web}const v = <For each={names()}>{(name) => <li>{name}</li>}</For>;`,
    // Objects without an identity field are matched by reference on purpose.
    `${web}const v = <For each={points()}>{(p) => <i>{p.x},{p.y}</i>}</For>;`,
    // Spread props may carry the key.
    `${web}const v = <For each={todos()} {...rest}>{(todo) => <li>{todo.id}</li>}</For>;`,
    // Another library's For.
    'import { For } from "other";\nconst v = <For each={todos()}>{(todo) => <li>{todo.id}</li>}</For>;',
    // A local component named For.
    "function For(props: unknown) { return null; }\nconst v = <For each={todos()}>{(todo) => <li>{todo.id}</li>}</For>;",
    // Lowercase elements are not For.
    `${web}const v = <for each={todos()}>{(todo) => <li>{todo.id}</li>}</for>;`,
    // map without creating objects is fine.
    `${web}const v = <For each={list()}>{(item) => <li>{item}</li>}</For>;`,
    // A comment on a list without identity fields does not change the answer.
    `${web}const v = <For each={names()} /* names only */>{(name) => <li>{name!}</li>}</For>;`,
  ],
  invalid: [
    {
      name: "props are reactive: a list read from props is reported",
      code: `${web}function List(props: { items: Array<{ id: number }> }) {\n  return <For each={props.items}>{(item) => <li>{item.id}</li>}</For>;\n}`,
      errors: [{ messageId: "missingKey", data: { field: "id" }, suggestions: 1 }],
    },
    {
      name: "a constant derived from an accessor is reactive too",
      code: `${web}function List() {\n  const open = todos().filter((t) => t.id > 0);\n  return <For each={open}>{(item) => <li>{item.id}</li>}</For>;\n}`,
      errors: [{ messageId: "missingKey", data: { field: "id" }, suggestions: 1 }],
    },
    {
      name: "id used in the row callback, suggestion adds a keyed accessor form",
      code: `${web}const v = <For each={todos()}>{(todo) => <li>{todo.id}: {todo.title}</li>}</For>;`,
      errors: [
        {
          messageId: "missingKey",
          data: { field: "id" },
          suggestions: [
            {
              messageId: "addKey",
              data: { field: "id" },
              output: `${web}const v = <For key={(todo) => todo.id} each={todos()}>{(todo) => <li>{todo().id}: {todo().title}</li>}</For>;`,
            },
          ],
        },
      ],
    },
    {
      name: "other identity fields",
      code: `${web}const v = <For each={rows()}>{(row) => <tr data-k={row.uuid} />}</For>;`,
      errors: [{ messageId: "missingKey", data: { field: "uuid" }, suggestions: 1 }],
    },
    {
      name: "destructured parameter: report only",
      code: `${web}const v = <For each={rows()}>{({ id, name }) => <tr>{id}{name}</tr>}</For>;`,
      errors: [{ messageId: "missingKey", data: { field: "id" }, suggestions: 0 }],
    },
    {
      name: "each is rebuilt with map",
      code: `${web}const v = <For each={rows().map((r) => ({ ...r, on: r === sel() }))}>{(r) => <Row row={r} />}</For>;`,
      errors: [{ messageId: "missingKeyDerived" }],
    },
    {
      name: "unbound For (snippets)",
      code: `${web.replace('import { For } from "@shadow-js/web";\n', "")}const v = <For each={todos()}>{(todo) => <li>{todo.id}</li>}</For>;`,
      errors: [{ messageId: "missingKey", suggestions: 1 }],
    },
    {
      name: "the index parameter is kept",
      code: `${web}const v = <For each={todos}>{(t, i) => <li>{t.slug}{i()}</li>}</For>;`,
      errors: [{ messageId: "missingKey", data: { field: "slug" }, suggestions: 1 }],
    },
    {
      name: "E1 TypeScript assertion around the item still reads its identity",
      code: `${web}const v = <For each={todos()}>{(todo) => <li>{(todo as Todo).id}</li>}</For>;`,
      errors: [
        {
          messageId: "missingKey",
          data: { field: "id" },
          suggestions: [
            {
              messageId: "addKey",
              data: { field: "id" },
              output: `${web}const v = <For key={(todo) => todo.id} each={todos()}>{(todo) => <li>{(todo() as Todo).id}</li>}</For>;`,
            },
          ],
        },
      ],
    },
    {
      name: "E1 non-null assertion around the item still reads its identity",
      code: `${web}const v = <For each={todos()}>{(todo) => <li>{todo!.id}</li>}</For>;`,
      errors: [{ messageId: "missingKey", data: { field: "id" }, suggestions: 1 }],
    },
    {
      name: "E2 optional access reads the identity too",
      code: `${web}const v = <For each={todos()}>{(todo) => <li>{todo?.id}</li>}</For>;`,
      errors: [{ messageId: "missingKey", data: { field: "id" }, suggestions: 1 }],
    },
    {
      name: "E3 a comment on the reported element is kept by the suggestion",
      code: `${web}const v = <For each={todos()} /* rows by id */>{(todo) => <li>{todo.id}</li>}</For>;`,
      errors: [
        {
          messageId: "missingKey",
          data: { field: "id" },
          suggestions: [
            {
              messageId: "addKey",
              data: { field: "id" },
              output: `${web}const v = <For key={(todo) => todo.id} each={todos()} /* rows by id */>{(todo) => <li>{todo().id}</li>}</For>;`,
            },
          ],
        },
      ],
    },
    {
      name: "E4 a TypeScript assertion on the list is still reactive",
      code: `${web}const v = <For each={todos() as Todo[]}>{(todo) => <li>{todo.id}</li>}</For>;`,
      errors: [{ messageId: "missingKey", data: { field: "id" }, suggestions: 1 }],
    },
  ],
});
