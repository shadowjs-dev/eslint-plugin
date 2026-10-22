/**
 * Syntax the rules must survive without crashing or false positives: decorators, explicit resource
 * management (`using`), `satisfies`, enums, namespaces, import and export attributes, and the other
 * TypeScript and ECMAScript forms a modern ShadowJS file can contain. Each entry is a file name (its
 * extension selects the language) and a source. Every entry is valid syntax.
 */
export const SYNTAX_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  [
    "decorators.ts",
    `function log(...args: unknown[]): any { return args; }
@log("class") export class Service {
  @log("field") name = "svc";
  @log() @log("stacked") static count = 0;
  constructor(@log("param") private readonly id: string) {}
  @log("method") run(@log("arg") input: string): string { return input; }
  @log("accessor") accessor value = 1;
  get size(): number { return 1; }
}
`,
  ],
  [
    "using.ts",
    `declare const pool: { [Symbol.dispose](): void };
export function work(): void {
  using handle = pool as unknown as { [Symbol.dispose](): void };
  using resource = null;
  console.log(handle, resource);
}
export async function open(): Promise<void> {
  await using stream = null as unknown as AsyncDisposable | null;
  for (using item of []) void item;
}
`,
  ],
  [
    "satisfies.tsx",
    `const config = { port: 3000, host: "localhost" } satisfies { port: number; host: string };
const list = [1, 2, 3] as const satisfies readonly number[];
export function Page(props: { items: readonly string[] }) {
  const label = (props.items satisfies readonly string[])[0] as string;
  return <p data-label={label!}>{label satisfies string}</p>;
}
`,
  ],
  [
    "enums.ts",
    `export enum Status { Idle, Busy = 1, Done = "done" }
export const enum Flags { None = 0, Read = 1 << 0, Write = 1 << 1 }
declare enum Ambient { A }
enum Mixed { A = 1, B = A | 2, C = "x".length }
export const pick = (s: Status): boolean => s === Status.Busy;
`,
  ],
  [
    "namespaces.ts",
    `namespace Outer.Inner { export const value = 1; export namespace Deep { export type T = string; } }
declare namespace Ambient { function f(): void; }
declare module "virtual:thing" { export const x: number; }
declare global { interface Window { shadow?: unknown } }
export {};
`,
  ],
  [
    "import-attributes.ts",
    `import data from "./data.json" with { type: "json" };
import sheet from "./sheet.css" with { type: "css" };
export { default as moved } from "./moved.json" with { type: "json" };
export * from "./all.json" with { type: "json" };
const lazy = import("./lazy.json", { with: { type: "json" } });
export const size = (data as { length?: number }).length ?? 0;
void sheet; void lazy;
`,
  ],
  [
    "type-only.ts",
    `import type { A } from "./a";
import { type B, type C as D } from "./b";
export type { A as AA };
export type * from "./types";
import type Def from "./def";
import fs = require("node:fs");
export import Alias = Outer.Inner;
declare const Outer: { Inner: { value: number } };
export type Fn = <T extends object = {}>(value: T) => asserts value is T & {};
void fs; void Def;
`,
  ],
  [
    "classes.ts",
    `abstract class Base<T> { abstract run(input: T): void; protected override tick?(): void; }
class Derived extends Base<string> {
  declare readonly kind: "d";
  #secret = 1;
  static #count = 0;
  override run(input: string): void { void input; }
  has(other: object): boolean { return #secret in other; }
  static { Derived.#count += 1; }
}
export { Derived };
`,
  ],
  [
    "types.ts",
    `type Tuple = readonly [a: string, b?: number, ...rest: boolean[]];
type Keys = keyof typeof import("./config");
type Path = \`/\${string}/\${number}\`;
type Unwrap<T> = T extends Promise<infer U> ? U : never;
type Brand = string & { readonly __brand: unique symbol };
declare const sym: unique symbol;
let fn: new (...args: never[]) => object = Object;
export type { Tuple, Keys, Path, Unwrap, Brand, sym };
`,
  ],
  [
    "syntax-edge.tsx",
    `const re = /(?<year>\\d{4})-(?<month>\\d{2})/v;
let a: number | undefined;
a ??= 1; a ||= 2; a &&= 3;
const deep = { x: { y: { z: [1] } } }?.x?.y?.z?.[0] ?? null;
label: for (const k of [1]) { if (k) continue label; }
export function Generic<const T extends readonly unknown[]>(items: T) {
  return <ul>{items.map((item) => <li key={String(item)}>{String(item)}</li>)}</ul>;
}
`,
  ],
  [
    "jsx-variants.tsx",
    `export const View = <T,>(props: { value: T }) => (
  <Shell.Panel {...props} aria-hidden="true" data-x={1} xlink:href="#a" on:input={(e) => e}>
    <>
      {/* comment */}
      <svg:rect width={1} />
      {props.value ? <b>yes</b> : null}
    </>
  </Shell.Panel>
);
declare namespace Shell { const Panel: (props: object) => unknown; }
`,
  ],
];
