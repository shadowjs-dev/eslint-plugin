# Changelog

## 1.0.3

### Fixed

- `no-react-patterns` only autofixes the removal of an effect's dependency array when the body does not write a signal it reads; otherwise it offers a suggestion that explains the read-and-write loop.
- `no-react-patterns` unwraps a lazy `useState(() => expression)` to `useSignal(expression)` (and reports other function initializers without a fix), since `useSignal` would store the function.
- `signal-must-be-called` reports an accessor on the right of a compound assignment (`t += count`, `t *= count`).
- `no-physical-direction-classes` rewrites only real Tailwind utilities (`left-panel` and `text-left-aligned` are left alone) and adds `rounded-tl/tr/bl/br-*`, `float-left/right` and `clear-left/right`.
- `hooks-in-owner` reports owner-bound hooks called after an `await` in an async function (`onMount(async () => { await x(); onCleanup(fn) })`).

## 1.0.2

### Fixed

- `jsx-no-unsafe-inner-html` treats an optional call of an allowed sanitizer (`DOMPurify?.sanitize(html)`, `sanitize?.(html)`) as the sanitizer call it is.
- `no-physical-direction-classes` no longer reports or rewrites the bare words `left`, `right`, `ml`, `mr`, `pl` and `pr`: they are utilities only with a value (`left-0`, `ml-2`), and alone they are an author's own class names.
- `jsx-no-unsafe-inner-html` checks the `srcdoc` attribute of an `<iframe>` (also `prop:srcdoc` and `.srcdoc` assignments) like `innerHTML`.
- `jsx-no-unsafe-inner-html` sees through an indirect sanitizer call, `(0, DOMPurify.sanitize)(html)`, and trusts the name `DOMPurify` only when it is the global or comes from an import or `require`: a local object or parameter of that name is reported.
- `jsx-no-unsafe-inner-html` trusts a `DOMPurify` declared with an ambient `declare const DOMPurify`, which only states the type of the global, instead of reporting `DOMPurify.sanitize(html)` as unsanitized.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- A TypeScript and JSX parser that does not require the TypeScript compiler API.
- Reactivity, ownership, security and migration rules with flat and legacy configurations.
- Logical direction class checks, safe suggestions, explicit autofix and bounded traversal.
- `configure(config, rules)` to turn a rule off, or on with options, in one place, for the flat and the legacy configs.
- `legacy-dusk` sets `ignorePatterns` from the same list as the flat `dusk` config.
