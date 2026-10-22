import type { ShadowRule } from "../rule";
import { effectCleanupRegistered } from "./effect-cleanup-registered";
import { forKeyRequiredForReorder } from "./for-key-required-for-reorder";
import { hooksInOwner } from "./hooks-in-owner";
import { jsxNoScriptUrl } from "./jsx-no-script-url";
import { jsxNoUnsafeInnerHtml } from "./jsx-no-unsafe-inner-html";
import { noAsyncEffect } from "./no-async-effect";
import { noDestructurePropsOutsideForgiving } from "./no-destructure-props-outside-forgiving";
import { noLowercaseDomAttrsCasing } from "./no-lowercase-dom-attrs-casing";
import { noPhysicalDirectionClasses } from "./no-physical-direction-classes";
import { noReactPatterns } from "./no-react-patterns";
import { noSignalWriteInRenderBody } from "./no-signal-write-in-render-body";
import { noUnkeyedDynamicList } from "./no-unkeyed-dynamic-list";
import { noUnsafeSpreadUserInput } from "./no-unsafe-spread-user-input";
import { noWriteInMemo } from "./no-write-in-memo";
import { preferShowForEarlyReturn } from "./prefer-show-for-early-return";
import { serverOnlyImportInClient } from "./server-only-import-in-client";
import { signalMustBeCalled } from "./signal-must-be-called";
import { validEventNames } from "./valid-event-names";

/**
 * Every rule of the plugin, keyed by its name (the part after `shadow/`), in invariant-id order.
 *
 * The order is part of the contract: the rule registered at position N has the invariant id
 * `ESL-NN` (`meta.docs.id`), which its tests and docs use, so a new rule is added at the end. The
 * configs, the legacy configs and the generated rule index read this map; the severities of each
 * rule per config live in `configs/levels.ts`.
 *
 * @example
 * ```ts
 * import { rules } from "@shadow-js/eslint-plugin";
 *
 * const names: string[] = Object.keys(rules).map((name) => `shadow/${name}`);
 * const id: string | undefined = rules["signal-must-be-called"]?.meta.docs.id; // "ESL-02"
 * ```
 * @since 1.0.0
 * @see docs/rules/README.md
 */
export const rules: Readonly<Record<string, ShadowRule>> = {
  "no-destructure-props-outside-forgiving": noDestructurePropsOutsideForgiving,
  "signal-must-be-called": signalMustBeCalled,
  "no-write-in-memo": noWriteInMemo,
  "no-signal-write-in-render-body": noSignalWriteInRenderBody,
  "effect-cleanup-registered": effectCleanupRegistered,
  "no-async-effect": noAsyncEffect,
  "hooks-in-owner": hooksInOwner,
  "prefer-show-for-early-return": preferShowForEarlyReturn,
  "no-react-patterns": noReactPatterns,
  "jsx-no-script-url": jsxNoScriptUrl,
  "jsx-no-unsafe-inner-html": jsxNoUnsafeInnerHtml,
  "no-unsafe-spread-user-input": noUnsafeSpreadUserInput,
  "for-key-required-for-reorder": forKeyRequiredForReorder,
  "no-unkeyed-dynamic-list": noUnkeyedDynamicList,
  "server-only-import-in-client": serverOnlyImportInClient,
  "valid-event-names": validEventNames,
  "no-lowercase-dom-attrs-casing": noLowercaseDomAttrsCasing,
  "no-physical-direction-classes": noPhysicalDirectionClasses,
};
