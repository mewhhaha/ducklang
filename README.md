# Binned

Binned is a small Interaction Calculus inspired compiler pipeline written in
Deno. The project is intentionally direct and inspectable: source programs move
through explicit stages instead of a large hidden compiler framework.

```txt
Source -> IC -> Expr -> Mod -> WAT -> Wasm
```

The language is a compact value-oriented playground for compile-time
specialization, affine lowering, explicit sharing/erasure, ownership checks, and
direct WebAssembly output.

## Quick Start

Run the demo compiler pipeline:

```sh
just run
```

This writes `build/out.wat` from the example program in `main.ts`.

Compile the generated WAT to Wasm:

```sh
just wasm
```

Run the test suite:

```sh
just test
```

The tests use Deno and expect `wat2wasm` to be available for Wasm integration
checks.

## Example

```txt
const make_adder = n => {
  x => x + n
}

const add_three = comptime make_adder(3)

let value = add_three(29)
value = value + 1
value
```

This program evaluates to `33`. The demo in `main.ts` parses the source, lowers
it through IC and Expr, wraps it in a Wasm module, and writes WAT.

## Source Language

Programs are sequences of statements. The final expression is the program
result.

```txt
let x = 40
x + 2
```

Runtime values are immutable. Assignment syntax is modeled as shadowing:

```txt
let x = 40
x = x + 2     // same-type shadowing
x := "done"  // type-changing shadowing
```

Compile-time bindings use `const`, and compile-time execution uses `comptime`:

```txt
const factor = 2
const add_factor = comptime (n => x => x + n)(factor)
```

Closures use arrow syntax:

```txt
let add = (x, y) => x + y
let inc = x => x + 1
```

Recursive functions use `let rec`:

```txt
let rec fib = n => {
  if n < 2 {
    n
  } else {
    fib(n - 1) + fib(n - 2)
  }
}

fib(6)
```

## Syntax Snapshot

Common statement forms:

```txt
let name = expr
let name: Type = expr
let rec name = params => body
let !name = expr

const name = expr
const name: Type = expr

name = expr
name := expr
name[index] = expr

if cond { statements }
if let .case(value) = target { statements }

for i in start..end { statements }
for i in start..end by step { statements }
for item in collection { statements }
for i, item in collection { statements }

return expr
break
continue
```

Common expression forms:

```txt
42
42i32
42i64
"text"

x + y
x - y
x * y
x / y
x % y
x == y
x != y
x < y
x <= y
x > y
x >= y
x && y
x || y

x => x + 1
(x: Int, y: Int) => x + y
func(arg1, arg2)

if cond { a } else { b }
if let .ok(value) = result { value } else { 0 }

object.field
object[index]
object with { field: value }
```

Built-in type names:

```txt
Int
I32
U32
I64
Text
Unit
Type
```

## Types, Structs, And Unions

Types are compile-time values.

```txt
const user_type = struct {
  name: Text,
  age: Int
}

let user = user_type {
  name: "Ada",
  age: 36
}

user.age
```

Unions support typed constructors and `if let` matching:

```txt
const option_type = t => union {
  some: t,
  none: Unit
}

const int_option_type = option_type(Int)
let value = int_option_type.some(41)

if let .some(x) = value {
  x + 1
} else {
  0
}
```

## Text

Text literals are UTF-8 strings. Visible text operations can fold during
frontend lowering, while runtime `Text` values are represented as `i32` pointers
to length-prefixed UTF-8 data in generated WAT.

```txt
let greeting = "hello" + " " + "Ada"
len(greeting)
```

Text builtins include:

```txt
len(value)
get(value, index)
slice(value, start, end)
append(left, right)
```

## Ownership And Host Imports

Linear bindings and parameters are marked with `!`.

```txt
let !buffer = make_buffer()
let use_once = (!value) => value
```

Ownership-oriented expressions:

```txt
borrow value
freeze value
scratch { statements }
```

Host imports declare Wasm imports plus scalar or ownership contracts:

```txt
host_import log from "env.log"(Int) => Int
host_import print from "env.print"(bounded_borrow Text) => Int
host_import make_text from "env.make_text"(Int) => unique_heap Text
```

## Compiler Entry Points

The source frontend is exposed through `Source`:

```ts
Source.parse(text); // Source AST
Source.compile(text); // Source -> IC
Source.ic_wat(text); // Source -> IC route -> WAT
Source.core(text); // Source -> structured Core
Source.mod(text, "main"); // Source -> Core -> Mod
Source.wat(text, "main"); // Source -> Core -> WAT
```

Use the IC route for small scalar examples and open terms like `input + 1`. Use
the Core route for larger programs with structured statements, loops, runtime
text, host imports, closures, and aggregate behavior.

## Repository Layout

```txt
main.ts             demo pipeline that writes build/out.wat
test.ts             Wasm integration tests
src/frontend.ts     source frontend public exports
src/ic.ts           Interaction Calculus layer
src/expr.ts         expression layer
src/mod.ts          Wasm module layer
src/core.ts         structured Core path
docs/language.md    longer source-language notes
tasks/              planning notes and task breakdowns
```

## Development

```sh
just fmt
just fmt-check
just lint
just test
just check
```

Style notes that matter in this repository:

- Keep compiler stages small and explicit.
- Do not silently default missing compiler information.
- Prefer direct invariant checks with `expect(value, message)`.
- Keep semantic operations separate from concrete Wasm instructions.
- Keep tests close to the implementation they cover.
