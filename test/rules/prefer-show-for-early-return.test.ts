import { preferShowForEarlyReturn } from "../../src/rules/prefer-show-for-early-return";
import { runRule } from "../support/tester";

const web = 'import { Show } from "@shadow-js/web";\n';

runRule("ESL-08", "prefer-show-for-early-return", preferShowForEarlyReturn, {
  valid: [
    // A returned ternary is made live by the compiler.
    "function Page(props) { return props.loading ? <Spinner /> : <Content />; }",
    // Static guards.
    "function Page() { if (typeof window === 'undefined') return null; return <Content />; }",
    "function Page() { if (DEV) return <Dev />; return <Prod />; }",
    // Guards that do not return.
    "function Page(props) { if (props.debug) console.log(1); return <Content />; }",
    // Not a component.
    "function pick(props) { if (props.a) return 1; return 2; }",
    "function page(props) { if (props.a) return <A />; return <B />; }",
    // Nothing JSX-like returned.
    "function Page(props) { if (props.a) return null; return null; }",
    // Already using Show.
    "function Page(props) { return <Show when={props.on} fallback={<B />}><A /></Show>; }",
    // Early return in a nested callback is not the component's.
    "function Page(props) { const f = () => { if (props.a) return 1; return 2; }; return <b>{f()}</b>; }",
    // Guard whose condition reads only plain locals.
    "function Page() { const ready = true; if (ready) return <A />; return <B />; }",
    // [ESL-08.SSR] import.meta.env is replaced at build time, so a guard on it never changes while
    // the component lives: it is a build-time branch, not a reactive early return.
    {
      name: "[ESL-08.SSR1] import.meta.env.SSR guard is a build-time branch",
      code: "function Page() {\n  if (import.meta.env.SSR) return null;\n  return <Content />;\n}",
    },
    {
      name: "[ESL-08.SSR2] negated import.meta.env.SSR guard",
      code: "function Page() {\n  if (!import.meta.env.SSR) return <Client />;\n  return <Server />;\n}",
    },
    {
      name: "[ESL-08.SSR3] optional chain and bracket spellings of the env read",
      code: 'function Page() {\n  if (import.meta.env?.SSR) return <Server />;\n  if (import.meta.env["SSR"]) return <Server />;\n  return <Client />;\n}',
    },
    {
      name: "[ESL-08.SSR4] a derived constant read from import.meta.env is still static",
      code: "function Page() {\n  const server = import.meta.env.SSR;\n  if (server) return <Server />;\n  return <Client />;\n}",
    },
    {
      name: "[ESL-08.SSR5] destructured env flag is still static",
      code: "function Page() {\n  const { SSR } = import.meta.env;\n  if (SSR) return <Server />;\n  return <Client />;\n}",
    },
    {
      name: "[ESL-08.SSR6] env flag combined with a parenthesized and wrapped expression",
      code: "function Page() {\n  if ((import.meta.env.SSR as boolean)) return <Server />;\n  return <Client />;\n}",
    },
  ],
  invalid: [
    {
      name: "reactive prop guard with suggestion",
      code: "function Page(props) {\n  if (props.loading) return <Spinner />;\n  return <Content />;\n}",
      errors: [
        {
          messageId: "preferShow",
          data: { condition: "props.loading" },
          suggestions: [
            {
              messageId: "wrapInShow",
              output: `${web}function Page(props) {\n  return <Show when={props.loading} fallback={<Content />}><Spinner /></Show>;\n}`,
            },
          ],
        },
      ],
    },
    {
      name: "negated guard returning null",
      code: "function Page() {\n  if (!user()) return null;\n  return <Profile user={user()} />;\n}",
      errors: [
        {
          messageId: "preferShow",
          suggestions: [
            {
              messageId: "wrapInShow",
              output: `${web}function Page() {\n  return <Show when={user()}><Profile user={user()} /></Show>;\n}`,
            },
          ],
        },
      ],
    },
    {
      name: "negated guard with a fallback",
      code: "function Page(props) {\n  if (!props.user) return <Login />;\n  return <Home />;\n}",
      errors: [
        {
          messageId: "preferShow",
          suggestions: [
            {
              messageId: "wrapInShow",
              output: `${web}function Page(props) {\n  return <Show when={props.user} fallback={<Login />}><Home /></Show>;\n}`,
            },
          ],
        },
      ],
    },
    {
      name: "block consequent and else branch",
      code: "function Page(props) {\n  if (props.on) {\n    return <A />;\n  } else {\n    return <B />;\n  }\n}",
      errors: [
        {
          messageId: "preferShow",
          suggestions: [
            {
              messageId: "wrapInShow",
              output: `${web}function Page(props) {\n  return <Show when={props.on} fallback={<B />}><A /></Show>;\n}`,
            },
          ],
        },
      ],
    },
    {
      name: "accessor condition",
      code: "import { useSignal } from '@shadow-js/core';\nconst [open] = useSignal(false);\nfunction Page() {\n  if (open) return <A />;\n  return <B />;\n}",
      errors: [{ messageId: "preferShow", suggestions: 1 }],
    },
    {
      name: "derived constant condition",
      code: "function Page(props) {\n  const empty = props.items.length === 0;\n  if (empty) return <Empty />;\n  return <List />;\n}",
      errors: [{ messageId: "preferShow", suggestions: 1 }],
    },
    {
      name: "statements between the guard and the final return: report only",
      code: "function Page(props) {\n  if (props.loading) return <Spinner />;\n  const x = 1;\n  return <Content x={x} />;\n}",
      errors: [{ messageId: "preferShow", suggestions: 0 }],
    },
    {
      name: "non-JSX result is wrapped in braces; existing Show import is reused",
      code: "import { Show } from '@shadow-js/web';\nfunction Page(props) {\n  if (props.ok) return 'yes';\n  return <b />;\n}",
      errors: [
        {
          messageId: "preferShow",
          suggestions: [
            {
              messageId: "wrapInShow",
              output:
                "import { Show } from '@shadow-js/web';\nfunction Page(props) {\n  return <Show when={props.ok} fallback={<b />}>{'yes'}</Show>;\n}",
            },
          ],
        },
      ],
    },
    {
      name: "arrow component",
      code: "const Page = (props) => {\n  if (props.loading) return <Spinner />;\n  return <Content />;\n};",
      errors: [{ messageId: "preferShow", suggestions: 1 }],
    },
    {
      // [ESL-08.SSR] a reactive read next to the build-time flag still makes the guard reactive.
      name: "[ESL-08.SSR7] env flag or a prop is reactive: reported with its suggestion",
      code: "function Page(props) {\n  if (import.meta.env.SSR || props.loading) return <Spinner />;\n  return <Content />;\n}",
      errors: [
        {
          messageId: "preferShow",
          data: { condition: "import.meta.env.SSR || props.loading" },
          suggestions: [
            {
              messageId: "wrapInShow",
              output: `${web}function Page(props) {\n  return <Show when={import.meta.env.SSR || props.loading} fallback={<Content />}><Spinner /></Show>;\n}`,
            },
          ],
        },
      ],
    },
    {
      name: "[ESL-08.SSR8] an env read with a computed, non-literal key is not static",
      code: "function Page(props) {\n  if (import.meta.env[props.key]) return <A />;\n  return <B />;\n}",
      errors: [{ messageId: "preferShow", suggestions: 1 }],
    },
    {
      name: "[ESL-08.SSR9] a derived constant mixing an env flag and a call is reactive",
      code: "function Page() {\n  const mode = import.meta.env.SSR || isOpen();\n  if (mode) return <A />;\n  return <B />;\n}",
      errors: [{ messageId: "preferShow", suggestions: 1 }],
    },
    {
      name: "multi-statement consequent: report only",
      code: "function Page(props) {\n  if (props.loading) {\n    log();\n    return <Spinner />;\n  }\n  return <Content />;\n}",
      errors: [{ messageId: "preferShow", suggestions: 0 }],
    },
  ],
});
