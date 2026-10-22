/** The package a ShadowJS name is imported from. */
export type ShadowModule = "@shadow-js/core" | "@shadow-js/web";

/** A framework whose code is being ported. */
export type Foreign = "react" | "solid";

/** Names that exist unchanged in ShadowJS: only the import path differs. */
export const SAME_NAME: Readonly<Record<Foreign, Readonly<Record<string, ShadowModule>>>> = {
  react: {
    useEffect: "@shadow-js/core",
    useMemo: "@shadow-js/core",
    useContext: "@shadow-js/core",
    useId: "@shadow-js/core",
    useReducer: "@shadow-js/core",
    useImperativeHandle: "@shadow-js/core",
    createContext: "@shadow-js/core",
    createRef: "@shadow-js/core",
    cache: "@shadow-js/core",
    flushSync: "@shadow-js/core",
    Fragment: "@shadow-js/web",
    Suspense: "@shadow-js/web",
    lazy: "@shadow-js/web",
    startTransition: "@shadow-js/core",
    useTransition: "@shadow-js/core",
    useDeferredValue: "@shadow-js/core",
  },
  solid: {
    startTransition: "@shadow-js/core",
    useTransition: "@shadow-js/core",
    batch: "@shadow-js/core",
    untrack: "@shadow-js/core",
    createRoot: "@shadow-js/core",
    getOwner: "@shadow-js/core",
    runWithOwner: "@shadow-js/core",
    onMount: "@shadow-js/core",
    onCleanup: "@shadow-js/core",
    onError: "@shadow-js/core",
    catchError: "@shadow-js/core",
    createContext: "@shadow-js/core",
    useContext: "@shadow-js/core",
    mergeProps: "@shadow-js/core",
    splitProps: "@shadow-js/core",
    children: "@shadow-js/core",
    mapArray: "@shadow-js/core",
    indexArray: "@shadow-js/core",
    reconcile: "@shadow-js/core",
    produce: "@shadow-js/core",
    unwrap: "@shadow-js/core",
    Show: "@shadow-js/web",
    For: "@shadow-js/web",
    Index: "@shadow-js/web",
    Switch: "@shadow-js/web",
    Match: "@shadow-js/web",
    ErrorBoundary: "@shadow-js/web",
    Suspense: "@shadow-js/web",
    lazy: "@shadow-js/web",
    Portal: "@shadow-js/web",
    Dynamic: "@shadow-js/web",
    render: "@shadow-js/web",
    hydrate: "@shadow-js/web",
  },
};

/** Names that exist under another name in ShadowJS. */
export const RENAMED: Readonly<
  Record<Foreign, Readonly<Record<string, { name: string; module: ShadowModule }>>>
> = {
  react: {
    useState: { name: "useSignal", module: "@shadow-js/core" },
    useSyncExternalStore: { name: "useExternalStore", module: "@shadow-js/core" },
    useEffectEvent: { name: "useEvent", module: "@shadow-js/core" },
    useActionState: { name: "useAction", module: "@shadow-js/core" },
    useLayoutEffect: { name: "useRenderEffect", module: "@shadow-js/core" },
  },
  solid: {
    // Solid's createDeferred is useDeferredValue in ShadowJS (DEC-TRANSITIONS).
    createDeferred: { name: "useDeferredValue", module: "@shadow-js/core" },
    createSignal: { name: "useSignal", module: "@shadow-js/core" },
    createMemo: { name: "useMemo", module: "@shadow-js/core" },
    createComputed: { name: "useMemo", module: "@shadow-js/core" },
    createEffect: { name: "useEffect", module: "@shadow-js/core" },
    createRenderEffect: { name: "useRenderEffect", module: "@shadow-js/core" },
    createStore: { name: "useStore", module: "@shadow-js/core" },
    createResource: { name: "useResource", module: "@shadow-js/core" },
    createSelector: { name: "useSelector", module: "@shadow-js/core" },
    createUniqueId: { name: "useId", module: "@shadow-js/core" },
    createReaction: { name: "useReaction", module: "@shadow-js/core" },
  },
};

/** Names with no ShadowJS equivalent, and what to do instead. */
export const UNSUPPORTED: Readonly<Record<Foreign, Readonly<Record<string, string>>>> = {
  react: {
    useRef:
      "declare a plain variable for a value, or `createRef()` for an element ref (`ref={r}`, then `r.current`)",
    useCallback:
      "write a plain function; components run once, so there are no dependency arrays to get wrong",
    memo: "components run once and read props lazily, so there is nothing to memoize; use `useMemo` for values",
    useInsertionEffect: "use `useRenderEffect` (it runs before user effects, in the same flush)",
    useFormStatus:
      "read the form state from `@shadow-js/forms`; there is no context for it in core",
    use: "use `useContext(Ctx)` for context and `useResource(...)` for a promise",
    isValidElement: "there are no element objects: check `node instanceof Node` for a DOM node",
    useDebugValue: "pass `name` in the hook options for devtools",
    forwardRef: "refs are ordinary props: accept `ref` and pass it on",
    createElement: "write JSX; the compiler creates the DOM",
    cloneElement: "pass props explicitly or use context",
    Children: "use the `children` helper from `@shadow-js/core`",
    createPortal: "use `<Portal>` from `@shadow-js/web`",
    createRoot: "use `render(() => <App />, container)` from `@shadow-js/web`",
    hydrateRoot: "use `hydrate(() => <App />, container)` from `@shadow-js/web`",
    StrictMode: "remove it; components run once",
    Component: "write a function component",
    PureComponent: "write a function component",
  },
  solid: {
    on: "pass the dependencies as the first argument of `useEffect(deps, fn)`",
    observable: "wrap the source with `useExternalStore(subscribe, getSnapshot)` (see the recipes)",
    from: "use `useExternalStore(subscribe, getSnapshot)`; `subscribe` is the producer",
    enableExternalSource: "use `useExternalStore` to read another reactive library",
    createMutable: "use `useStore`; write through its setter (`setState((d) => { d.x = 1; })`)",
  },
};
