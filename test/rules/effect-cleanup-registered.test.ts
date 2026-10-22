import { effectCleanupRegistered } from "../../src/rules/effect-cleanup-registered";
import { runRule } from "../support/tester";

const imp = 'import { useEffect, onMount, onCleanup } from "@shadow-js/core";\n';
const impNoCleanup = 'import { useEffect, onMount } from "@shadow-js/core";\n';

runRule("ESL-05", "effect-cleanup-registered", effectCleanupRegistered, {
  valid: [
    // Returned cleanup removes the listener.
    `${imp}useEffect(() => {\n  window.addEventListener("resize", onResize);\n  return () => window.removeEventListener("resize", onResize);\n});`,
    // onCleanup registered.
    `${imp}useEffect(() => {\n  window.addEventListener("resize", onResize);\n  onCleanup(() => window.removeEventListener("resize", onResize));\n});`,
    `${imp}onMount(() => {\n  const id = setInterval(tick, 1000);\n  onCleanup(() => clearInterval(id));\n});`,
    // Self-releasing listeners.
    `${imp}useEffect(() => { window.addEventListener("load", go, { once: true }); });`,
    `${imp}useEffect(() => { window.addEventListener("load", go, { signal: controller.signal }); });`,
    // Opaque cleanup (not written inline) is trusted.
    `${imp}useEffect(() => {\n  const stop = store.subscribe(render);\n  return stop;\n});`,
    `${imp}onMount(() => {\n  const unsubscribe = store.subscribe(render);\n  onCleanup(unsubscribe);\n});`,
    // A concise body that returns the unsubscribe function is a cleanup.
    `${imp}useEffect(() => store.subscribe(render));`,
    // Effects with nothing to release.
    `${imp}useEffect(() => { document.title = title(); });`,
    // Not an effect: component bodies and plain functions are out of scope.
    `${imp}function f() { window.addEventListener("resize", onResize); }`,
    // setTimeout is not checked by default.
    `${imp}useEffect(() => { setTimeout(run, 10); });`,
    // Deps form: the apply callback holds the work.
    `${imp}useEffect(id, () => {\n  const timer = setInterval(tick, 1);\n  return () => clearInterval(timer);\n});`,
    // The cleanup of observers.
    `${imp}onMount(() => {\n  const ro = new ResizeObserver(cb);\n  ro.observe(el);\n  return () => ro.disconnect();\n});`,
    // Another library's useEffect.
    'import { useEffect } from "react";\nuseEffect(() => { window.addEventListener("resize", onResize); });',
    // A nested effect is judged on its own.
    `${imp}useEffect(() => {\n  useEffect(() => {\n    const id = setInterval(a, 1);\n    return () => clearInterval(id);\n  });\n});`,
    // timeouts and frames when the options ask for them and they are cleaned.
    {
      code: `${imp}useEffect(() => {\n  const t = setTimeout(a, 1);\n  onCleanup(() => clearTimeout(t));\n});`,
      options: [{ checkTimeouts: true }],
    },
    {
      code: `${imp}useEffect(() => {\n  const t = requestAnimationFrame(a);\n  onCleanup(() => cancelAnimationFrame(t));\n});`,
      options: [{ checkAnimationFrames: true }],
    },
    // Edge cases: `once: true as const` still releases the listener on its own.
    `${imp}useEffect(() => { window.addEventListener("load", go, { once: true as const }); });`,
    // Edge cases: a cleanup written as a function expression (not an arrow) is inline.
    `${imp}onMount(function () {\n  const id = setInterval(tick, 1);\n  return function () {\n    clearInterval(id);\n  };\n});`,
    // Edge cases: the outer effect releases its own timer even when a nested effect registers an
    // unrelated cleanup.
    `${imp}useEffect(() => {\n  const id = setInterval(tick, 1);\n  onCleanup(() => clearInterval(id));\n  useEffect(() => { onCleanup(stop); });\n});`,
  ],
  invalid: [
    {
      name: "listener without cleanup, suggestion removes it",
      code: `${imp}useEffect(() => {\n  window.addEventListener("resize", onResize);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: 'addEventListener("resize")', api: "useEffect" },
          suggestions: [
            {
              messageId: "addCleanup",
              output: `${imp}useEffect(() => {\n  window.addEventListener("resize", onResize);\n  onCleanup(() => window.removeEventListener("resize", onResize));\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "suggestion adds the missing import",
      code: `${impNoCleanup}useEffect(() => {\n  window.addEventListener("keydown", handler, true);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          suggestions: [
            {
              messageId: "addCleanup",
              output: `import { useEffect, onMount, onCleanup } from "@shadow-js/core";\nuseEffect(() => {\n  window.addEventListener("keydown", handler, true);\n  onCleanup(() => window.removeEventListener("keydown", handler, true));\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "interval in onMount",
      code: `${imp}onMount(() => {\n  const id = setInterval(tick, 1000);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: "setInterval()", api: "onMount" },
          suggestions: [
            {
              messageId: "addCleanup",
              output: `${imp}onMount(() => {\n  const id = setInterval(tick, 1000);\n  onCleanup(() => clearInterval(id));\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "interval whose result is unused has no suggestion",
      code: `${imp}onMount(() => {\n  setInterval(tick, 1000);\n});`,
      errors: [{ messageId: "missingCleanup", suggestions: 0 }],
    },
    {
      name: "inline handler cannot be removed: no suggestion",
      code: `${imp}useEffect(() => {\n  window.addEventListener("resize", () => run());\n});`,
      errors: [{ messageId: "missingCleanup", suggestions: 0 }],
    },
    {
      name: "subscription",
      code: `${imp}useEffect(() => {\n  const unsubscribe = store.subscribe(render);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: "subscribe()", api: "useEffect" },
          suggestions: [
            {
              messageId: "addCleanup",
              output: `${imp}useEffect(() => {\n  const unsubscribe = store.subscribe(render);\n  onCleanup(unsubscribe);\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "cleanup exists but does not release the listener",
      code: `${imp}useEffect(() => {\n  const id = setInterval(tick, 1);\n  window.addEventListener("blur", onBlur);\n  return () => clearInterval(id);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: 'addEventListener("blur")', api: "useEffect" },
          suggestions: 1,
        },
      ],
    },
    {
      name: "observer and socket",
      code: `${imp}onMount(() => {\n  const ro = new ResizeObserver(cb);\n  const ws = new WebSocket(url);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: "new ResizeObserver()", api: "onMount" },
          suggestions: 1,
        },
        {
          messageId: "missingCleanup",
          data: { what: "new WebSocket()", api: "onMount" },
          suggestions: 1,
        },
      ],
    },
    {
      name: "listener in a nested callback of the effect",
      code: `${imp}useEffect(() => {\n  queueMicrotask(() => {\n    document.addEventListener("click", onClick);\n  });\n});`,
      errors: [{ messageId: "missingCleanup", suggestions: 0 }],
    },
    {
      name: "returning nothing is not a cleanup",
      code: `${imp}useEffect(() => {\n  window.addEventListener("resize", onResize);\n  return;\n});`,
      errors: [{ messageId: "missingCleanup", suggestions: 1 }],
    },
    {
      name: "expression bodied effect",
      code: `${imp}useEffect(() => window.addEventListener("resize", onResize));`,
      errors: [{ messageId: "missingCleanup", suggestions: 0 }],
    },
    {
      name: "setTimeout when enabled",
      code: `${imp}useEffect(() => {\n  const t = setTimeout(a, 1);\n});`,
      options: [{ checkTimeouts: true }],
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: "setTimeout()", api: "useEffect" },
          suggestions: 1,
        },
      ],
    },
    {
      name: "animation frame when enabled",
      code: `${imp}useEffect(() => {\n  const t = window.requestAnimationFrame(a);\n});`,
      options: [{ checkAnimationFrames: true }],
      errors: [{ messageId: "missingCleanup", suggestions: 1 }],
    },
    {
      name: "onCleanup name bound to something else blocks the import suggestion",
      code: 'import { useEffect } from "@shadow-js/core";\nconst onCleanup = 1;\nuseEffect(() => {\n  window.addEventListener("resize", onResize);\n});',
      errors: [{ messageId: "missingCleanup", suggestions: 0 }],
    },
    // Edge cases: a TypeScript cast around the effect callback is still the callback.
    {
      name: "cast around the effect callback",
      code: `${imp}useEffect((() => {\n  window.addEventListener("resize", onResize);\n}) as EffectFn);`,
      errors: [
        {
          messageId: "missingCleanup",
          suggestions: [
            {
              messageId: "addCleanup",
              output: `${imp}useEffect((() => {\n  window.addEventListener("resize", onResize);\n  onCleanup(() => window.removeEventListener("resize", onResize));\n}) as EffectFn);`,
            },
          ],
        },
      ],
    },
    // Edge cases: a cast on the global object (`(window as Window).setInterval`) is still window.
    {
      name: "cast on the global object",
      code: `${imp}useEffect(() => {\n  const id = (window as Window).setInterval(tick, 1000);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: "setInterval()", api: "useEffect" },
          suggestions: 1,
        },
      ],
    },
    // Edge cases: a cleanup registered by a nested effect does not release the outer listener.
    {
      name: "cleanup in a nested effect does not count for the outer effect",
      code: `${imp}useEffect(() => {\n  window.addEventListener("resize", onResize);\n  useEffect(() => { onCleanup(stop); });\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: 'addEventListener("resize")', api: "useEffect" },
          suggestions: 1,
        },
      ],
    },
    // Edge cases: the suggestion names the declarator that holds the timer, not the first one.
    {
      name: "timer in a second declarator",
      code: `${imp}onMount(() => {\n  const label = "tick", id = setInterval(tick, 1000);\n  show(label);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          suggestions: [
            {
              messageId: "addCleanup",
              output: `${imp}onMount(() => {\n  const label = "tick", id = setInterval(tick, 1000);\n  onCleanup(() => clearInterval(id));\n  show(label);\n});`,
            },
          ],
        },
      ],
    },
    // Edge cases: a timer that is only an argument of another call is not stored, so there is no
    // safe cleanup to suggest.
    {
      name: "timer passed to another call has no suggestion",
      code: `${imp}onMount(() => {\n  const id = wrap(setInterval(tick, 1000));\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          data: { what: "setInterval()", api: "onMount" },
          suggestions: 0,
        },
      ],
    },
    // Edge cases: a listener returned from the effect never reaches a statement after it, so the
    // suggestion would be unreachable code.
    {
      name: "listener in a return statement has no suggestion",
      code: `${imp}useEffect(() => {\n  return window.addEventListener("resize", onResize);\n});`,
      errors: [{ messageId: "missingCleanup", suggestions: 0 }],
    },
    // Edge cases: optional chaining on the receiver is still a listener.
    {
      name: "optional chaining on the receiver",
      code: `${imp}useEffect(() => {\n  document?.addEventListener("click", onClick);\n});`,
      errors: [
        {
          messageId: "missingCleanup",
          suggestions: [
            {
              messageId: "addCleanup",
              output: `${imp}useEffect(() => {\n  document?.addEventListener("click", onClick);\n  onCleanup(() => document.removeEventListener("click", onClick));\n});`,
            },
          ],
        },
      ],
    },
  ],
});
