/**
 * The name flat configs register the plugin under: rules read `shadow/<name>`.
 *
 * @example
 * const key = `${PLUGIN_NAMESPACE}/no-async-effect`; // "shadow/no-async-effect"
 * @since 1.0.0
 */
export const PLUGIN_NAMESPACE = "shadow";
/**
 * The name eslintrc derives from the package `@shadow-js/eslint-plugin`: rules read `@shadow-js/<name>`.
 *
 * @example
 * const key = `${LEGACY_NAMESPACE}/no-async-effect`; // "@shadow-js/no-async-effect"
 * @since 1.0.0
 */
export const LEGACY_NAMESPACE = "@shadow-js";
