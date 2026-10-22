# Changelog

## 1.0.0

### Added

- A TypeScript and JSX parser that does not require the TypeScript compiler API.
- Reactivity, ownership, security and migration rules with flat and legacy configurations.
- Logical direction class checks, safe suggestions, explicit autofix and bounded traversal.
- `configure(config, rules)` to turn a rule off, or on with options, in one place, for the flat and the legacy configs.
- `legacy-dusk` sets `ignorePatterns` from the same list as the flat `dusk` config.
