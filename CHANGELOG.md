# Changelog

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
