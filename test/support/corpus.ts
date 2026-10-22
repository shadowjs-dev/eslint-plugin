/** Source files the parser tests parse with both parsers: `[file name, source]`. */
export const CORPUS: ReadonlyArray<readonly [string, string]> = [
  [
    "a.tsx",
    `import { a } from "./a.server";
import type { T } from "./t";
import def, * as ns from "x";
export { a as b } from "y";
export * from "z";
export default function App(props: { n: number }) { return <div class="c" {...props}>text {props.n} <b/><></></div>; }
`,
  ],
  [
    "b.ts",
    `/** doc */
enum E { A = 1, B }
namespace N { export const x = 1 }
declare module "m" { export function f(): void }
abstract class C<T extends object = {}> extends D implements I { #p = 1; static s = 2; abstract m(): void; constructor(private readonly x: number, public y?: string) { super(); } get g() { return this.#p } @dec() prop!: string; }
function over(a: string): void;
function over(a: number): void;
function over(a: any): void {}
const v = <const T,>(x: T) => x satisfies unknown as never;
type M = { [K in keyof T]?: T[K] } & Record<string, Array<Array<number>>>;
type Tpl = \`a\${string}b\`;
let t: typeof import("x") = null!;
export = foo;
import fs = require("fs");
label: for (const x of y) { if (x) continue label; else break label }
`,
  ],
  [
    "c.js",
    `const re = /ab+c/giu, d = 1 / 2 / 3;
async function* g() { for await (const x of y) yield* x; }
const o = { a, b: 1, [c]: 2, get d() { return 1 }, ...e, async *f() {} };
const t = \`a\${b + \`n\${c}\`}d\`;
x ??= y?.z?.[0]?.(1);
class K { static #q = 1; static { init(); } }
if (a) { } else if (b) { } // trailing
var abc = 0x1F + 1_000 + 10n + .5e3;
`,
  ],
  [
    "d.tsx",
    `const el = (
  <Foo.Bar a="1" b={x} c:d="e" {...rest}>
    {/* comment */}
    {cond ? <i>1</i> : null}
    text and more
  </Foo.Bar>
);
const g = <T,>(x: T) => <div>{x}</div>;
`,
  ],
  [
    "e.ts",
    `let a = b < c > d;
let s = x as unknown as Array<Array<string>>;
const f = (a: number): a is 1 => true;
for (let i = 0; i < 10; i++) {}
do { x++ } while (x < 5)
switch (a) { case 1: default: break }
try { throw new Error("x") } catch { } finally { }
let u: unique symbol;
export type { T };
export declare const q: number;
a = b ? c : d;
x = a! + b!.c;
const p = a?.5:1;
`,
  ],
  ["f.ts", "const a = 1;\r\nconst b = `x`;\r\n// c\r\n/* m\r\nn */\r\n"],
  ["g.ts", "// leading\n\n/* block */\nconst a = 1; /* t */ // e\n"],
  ["h.ts", ""],
  [
    "l.ts",
    `let a: string | null = null;
type T = true | false;
a.null; a.true;
const o = { default: 1, class: 2, if: 3 };
function f() { return [import.meta.url, new.target]; }
const re = a / b / c, g = x ? /re/ : y;
const tpl = \`\${a}\${{ b: \`\${c}\` }}\`;
class Z { declare x: number; accessor y = 1; static async *gen() {} }
`,
  ],
  ["m.d.ts", "declare const x: number;\ndeclare function f(a: string): void;\n"],
  ["k.ts", "var \\u0061bc = 1;\nconst \u00e9t\u00e9 = abc;\n"],
  ["i.ts", "// only comment"],
];
