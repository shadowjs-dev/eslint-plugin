import { noDestructurePropsOutsideForgiving as rule } from "../../src/rules/no-destructure-props-outside-forgiving";
import { runRule } from "../support/tester";

const off = [{ autoReactive: false }];

runRule("ESL-01", "no-destructure-props-outside-forgiving", rule, {
  valid: [
    // The compiler rewrites these (autoReactive on by default).
    "function Row({ id, name = 'anon' }) { return <li data-id={id}>{name}</li>; }",
    "const Row = ({ title, size: s = 3 }) => <li>{title}{s}</li>;",
    "function Row(props) { const { title, size = 3, label: text } = props; return <li>{title}{size}{text}</li>; }",
    "function Row({ title }: { title: string }) { return <li>{title}</li>; }",
    // Reading props directly is always fine.
    "function Row(props) { return <li>{props.title}</li>; }",
    "function Row(p) { return <li>{p.title}</li>; }",
    // Destructuring in later-running callbacks reads at that time.
    "function Row(props) { useEffect(() => { const { title } = props; log(title); }); return <li />; }",
    "function Row(props) { const m = useMemo(() => { const { a } = props; return a; }); return <li>{m()}</li>; }",
    "function Row(props) { return <li onClick={() => { const { id } = props; go(id); }} />; }",
    // Render callbacks and lower-case helpers destructure plain values, not props.
    "function Page(props) { return <ul>{props.items.map(({ id, name }) => <li data-id={id}>{name}</li>)}</ul>; }",
    "const renderRow = ({ id, name }) => <li data-id={id}>{name}</li>;",
    "items.forEach(({ id }) => { document.body.append(<i>{id}</i>); });",
    // Not a component (no JSX): helpers may destructure freely.
    "function pick({ a, ...rest }) { return rest; }",
    "const sum = ({ a, b }) => a + b;",
    // Other destructuring sources.
    "function Row(props) { const { a } = other; const [x, y] = props.pair; return <li>{a}{x}{y}</li>; }",
    // Arrays and non-first parameters are out of scope.
    "function Row(props, [a, b]) { return <li>{a}{b}</li>; }",
    // With autoReactive off, reading props directly is still fine.
    { code: "function Row(props) { return <li>{props.title}</li>; }", options: off },
    // With autoReactive off, helpers that do not render are untouched.
    { code: "function pick({ a }) { return a; }", options: off },
    // Callback destructuring is fine with autoReactive off too.
    {
      code: "function Row(props) { useEffect(() => { const { a } = props; log(a); }); return <li />; }",
      options: off,
    },
    // [ESL-01.E1] A default export with a name is a declared component: the compiler rewrites it.
    {
      name: "[ESL-01.E1] a named default-exported function component",
      code: "export default function Row({ title }) { return <li>{title}</li>; }",
    },
    // [ESL-01.E2] Destructuring props in a nested function that declares its own props is not props.
    {
      name: "[ESL-01.E2] a destructuring of a non-props value inside a render callback",
      code: "function Row(props) { return items.map((item) => { const { id } = item; return <i>{id}{props.x}</i>; }); }",
    },
  ],
  invalid: [
    {
      name: "rest element in the parameter list",
      code: "function Row({ id, ...rest }) { return <li data-id={id} {...rest} />; }",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason: "the pattern has a rest element (use `splitProps(props, [...])` instead)",
          },
        },
      ],
    },
    {
      name: "nested pattern",
      code: "function Row({ user: { name } }) { return <li>{name}</li>; }",
      errors: [{ messageId: "frozenParam", data: { reason: "the pattern is nested" } }],
    },
    {
      name: "computed key",
      code: "function Row({ [key]: v }) { return <li>{v}</li>; }",
      errors: [{ messageId: "frozenParam", data: { reason: "the pattern has computed keys" } }],
    },
    {
      name: "a component wrapped in memo() is not rewritten by the compiler",
      code: "const Row = memo(({ title }) => <li>{title}</li>);",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason:
              "the component is wrapped in a call such as memo(...); the compiler only rewrites components declared directly",
          },
          suggestions: [
            {
              messageId: "useProps",
              output: "const Row = memo((props) => <li>{props.title}</li>);",
            },
          ],
        },
      ],
    },
    {
      name: "an anonymous default export has no name for the compiler",
      code: "export default ({ title }) => <h1>{title}</h1>;",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason: "an anonymous default export has no name, so the compiler leaves it alone",
          },
          suggestions: 1,
        },
      ],
    },
    {
      name: "forwardRef wrapper with a rest element",
      code: "export const Input = forwardRef(function Input({ id, ...rest }, ref) { return <input id={id} {...rest} ref={ref} />; });",
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    {
      name: "async component",
      code: "async function Row({ title }) { return <li>{title}</li>; }",
      errors: [
        {
          messageId: "frozenParam",
          data: { reason: "async and generator functions are not rewritten" },
          suggestions: 1,
        },
      ],
    },
    {
      name: "two parameters",
      code: "function Row({ title }, extra) { return <li>{title}{extra}</li>; }",
      errors: [
        {
          messageId: "frozenParam",
          data: { reason: "the compiler only rewrites components with a single parameter" },
          suggestions: 1,
        },
      ],
    },
    {
      name: "let declaration",
      code: "function Row(props) { let { title } = props; return <li>{title}</li>; }",
      errors: [
        {
          messageId: "frozenDeclaration",
          data: { props: "props", reason: "only top-level `const` declarations are rewritten" },
          suggestions: [
            {
              messageId: "useProps",
              output: "function Row(props) { return <li>{props.title}</li>; }",
            },
          ],
        },
      ],
    },
    {
      name: "declaration in a nested block",
      code: "function Row(props) {\n  if (props.on) {\n    const { title } = props;\n    log(title);\n  }\n  return <li />;\n}",
      errors: [
        {
          messageId: "frozenDeclaration",
          data: {
            props: "props",
            reason: "only declarations at the top level of the component body are rewritten",
          },
          suggestions: [
            {
              messageId: "useProps",
              output:
                "function Row(props) {\n  if (props.on) {\n    log(props.title);\n  }\n  return <li />;\n}",
            },
          ],
        },
      ],
    },
    {
      name: "rest in a top-level const",
      code: "function Row(props) { const { id, ...rest } = props; return <li data-id={id} {...rest} />; }",
      errors: [{ messageId: "frozenDeclaration", suggestions: 0 }],
    },
    // [ESL-01.E3] An async arrow component is not rewritten; the reason says why.
    {
      name: "[ESL-01.E3] an async arrow component",
      code: "const Row = async ({ title }) => <li>{title}</li>;",
      errors: [
        {
          messageId: "frozenParam",
          data: { reason: "async and generator functions are not rewritten" },
          suggestions: 1,
        },
      ],
    },
    // [ESL-01.E4] A comment on a line the suggestion keeps survives the rewrite.
    {
      name: "[ESL-01.E4] a comment on the body line is kept by the parameter suggestion",
      code: "function Row({ id }) { // keep\n  return <li>{id}</li>;\n}",
      options: off,
      errors: [
        {
          messageId: "frozenParam",
          suggestions: [
            {
              messageId: "useProps",
              output: "function Row(props) { // keep\n  return <li>{props.id}</li>;\n}",
            },
          ],
        },
      ],
    },
    // [ESL-01.E5] A trailing comment on a removed declaration line stays in the suggestion.
    {
      name: "[ESL-01.E5] a trailing comment on a removed declaration is kept",
      code: "function Row(props) {\n  let { title } = props; // keep\n  return <li>{title}</li>;\n}",
      errors: [
        {
          messageId: "frozenDeclaration",
          suggestions: [
            {
              messageId: "useProps",
              output: "function Row(props) {\n // keep\n  return <li>{props.title}</li>;\n}",
            },
          ],
        },
      ],
    },
    // [ESL-01.E6] A comment inside the pattern would be deleted by the rewrite: no suggestion.
    {
      name: "[ESL-01.E6] a comment inside the pattern withholds the suggestion",
      code: "function Row({ id, /* the title */ title }) { return <li>{id}{title}</li>; }",
      options: off,
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    // [ESL-01.E7] A callback parameter named props would capture the rewritten `props.id`.
    {
      name: "[ESL-01.E7] a nested parameter named props withholds the suggestion",
      code: "function Row({ id }) { return items.map((props) => <i>{id}{props.label}</i>); }",
      options: off,
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    // [ESL-01.E8] A module-level props read in the body would be captured by the parameter.
    {
      name: "[ESL-01.E8] a read of an outer props binding withholds the suggestion",
      code: "const props = { x: 1 };\nfunction Row({ id }) { return <i>{id}{props.x}</i>; }",
      options: off,
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    // [ESL-01.E9] A declaration's rewrite is captured by a nested callback parameter named like props.
    {
      name: "[ESL-01.E9] a nested parameter named like the props withholds the declaration suggestion",
      code: "function Row(p) { const { a } = p; return items.map((p) => <i>{a}</i>); }",
      options: off,
      errors: [{ messageId: "frozenDeclaration", suggestions: 0 }],
    },
    // [ESL-01.E10] `as` on the initializer: the compiler only rewrites a plain `props` initializer.
    {
      name: "[ESL-01.E10] a TypeScript wrapper on the initializer is not rewritten",
      code: "function Row(props) { const { title } = props as Props; return <li>{title}</li>; }",
      errors: [
        {
          messageId: "frozenDeclaration",
          data: {
            props: "props",
            reason:
              "the initializer is not a plain `props` (a TypeScript wrapper such as `as` is not looked through)",
          },
          suggestions: [
            {
              messageId: "useProps",
              output: "function Row(props) { return <li>{props.title}</li>; }",
            },
          ],
        },
      ],
    },
    // [ESL-01.E11] A component wrapped in `as` is not a declared component for the compiler.
    {
      name: "[ESL-01.E11] a component wrapped in a TypeScript cast is not rewritten",
      code: "const Row = (({ title }) => <li>{title}</li>) as FC;",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason:
              "the compiler only rewrites components that are function declarations or functions assigned to a variable",
          },
          suggestions: [
            {
              messageId: "useProps",
              output: "const Row = ((props) => <li>{props.title}</li>) as FC;",
            },
          ],
        },
      ],
    },
    {
      name: "autoReactive off: parameter pattern, with a suggestion that keeps the annotation",
      code: "function Row({ id, title: text }: { id: number; title: string }) { return <li data-id={id}>{text}</li>; }",
      options: off,
      errors: [
        {
          messageId: "frozenParam",
          data: { reason: "autoReactive is off" },
          suggestions: [
            {
              messageId: "useProps",
              output:
                "function Row(props: { id: number; title: string }) { return <li data-id={props.id}>{props.title}</li>; }",
            },
          ],
        },
      ],
    },
    {
      name: "autoReactive off: shorthand object property usage",
      code: "function Row({ id }) { return <Child {...{ id }} />; }",
      options: off,
      errors: [
        {
          messageId: "frozenParam",
          suggestions: [
            {
              messageId: "useProps",
              output: "function Row(props) { return <Child {...{ id: props.id }} />; }",
            },
          ],
        },
      ],
    },
    {
      name: "autoReactive off: top-level const",
      code: "function Row(props) {\n  const { title, size } = props;\n  return <li>{title}{size}</li>;\n}",
      options: off,
      errors: [
        {
          messageId: "frozenDeclaration",
          data: { props: "props", reason: "autoReactive is off" },
          suggestions: [
            {
              messageId: "useProps",
              output: "function Row(props) {\n  return <li>{props.title}{props.size}</li>;\n}",
            },
          ],
        },
      ],
    },
    {
      name: "autoReactive off: defaults get no suggestion",
      code: "function Row({ size = 3 }) { return <li>{size}</li>; }",
      options: off,
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    {
      name: "a variable named props blocks the suggestion",
      code: "function Row({ id }) { const props = 1; return <li>{id}{props}</li>; }",
      options: off,
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    {
      name: "custom props parameter name",
      code: "function Row(p) { let { a } = p; return <li>{a}</li>; }",
      errors: [
        {
          messageId: "frozenDeclaration",
          data: { props: "p", reason: "only top-level `const` declarations are rewritten" },
          suggestions: [
            { messageId: "useProps", output: "function Row(p) { return <li>{p.a}</li>; }" },
          ],
        },
      ],
    },
    {
      name: "written destructured names block the suggestion",
      code: "function Row({ id }) { id = 2; return <li>{id}</li>; }",
      options: off,
      errors: [{ messageId: "frozenParam", suggestions: 0 }],
    },
    // The compiler's `components()` (derive.ts) only finds function declarations and functions
    // assigned to a variable; any other PascalCase function keeps its destructuring frozen.
    {
      name: "[ESL-01.B1] a component defined as an object property is not rewritten",
      code: "const parts = { Row: ({ title }) => <li>{title}</li> };",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason:
              "the compiler only rewrites components that are function declarations or functions assigned to a variable",
          },
          suggestions: 1,
        },
      ],
    },
    {
      name: "[ESL-01.B2] a component assigned to an existing variable is not rewritten",
      code: "let Row;\nRow = ({ title }) => <li>{title}</li>;",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason:
              "the compiler only rewrites components that are function declarations or functions assigned to a variable",
          },
          suggestions: 1,
        },
      ],
    },
    {
      name: "[ESL-01.B3] a named function expression wrapped in memo() is not rewritten",
      code: "const Row = memo(function Row({ title }) { return <li>{title}</li>; });",
      errors: [
        {
          messageId: "frozenParam",
          data: {
            reason:
              "the component is wrapped in a call such as memo(...); the compiler only rewrites components declared directly",
          },
          suggestions: 1,
        },
      ],
    },
    {
      // A read wrapped in `as` or `!` is a value read: it must be rewritten like any other.
      name: "reads under TypeScript expression wrappers are rewritten",
      code: "function Row(props) { let { title } = props; return <li>{(title as string) + title!}</li>; }",
      errors: [
        {
          messageId: "frozenDeclaration",
          data: { props: "props", reason: "only top-level `const` declarations are rewritten" },
          suggestions: [
            {
              messageId: "useProps",
              output:
                "function Row(props) { return <li>{(props.title as string) + props.title!}</li>; }",
            },
          ],
        },
      ],
    },
  ],
});
