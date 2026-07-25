# Duck compiler implementation

This directory implements Duck's compiler target. It translates the elaborated
semantic Core into gpufuck's typed functional surface, runs gpufuck's WebGPU
compiler, and emits binary WebAssembly directly.

The frontend retains parsing, module specialization, compile-time evaluation,
type and effect analysis, ownership checks, and source diagnostics. The adapter
supports Duck scalars, closures and recursion, structs, arrays, unions, runtime
indexing, loops, handlers, Text and Bytes operations, host capabilities, and
persistent callable exports. F32x4 uses a portable four-lane aggregate because
gpufuck Functional Core has no target-specific SIMD type.

`DuckCompiler` is publicly re-exported from `src/compiler.ts`. Its `run`,
`run_file`, and asynchronous variants install the source Text/Bytes runtime and
accept remaining Init capabilities from the caller. `prepare_file` retains a
compiled module for repeated execution. Callers must destroy prepared programs
before destroying the compiler.

Compile a file:

```sh
deno task compiler examples/functions/04_recursive_fibonacci.duck
```

Run the target's correctness suite:

```sh
deno task compiler:test
```

`evaluate_comptime` and `evaluate_comptime_file` execute pure Duck programs
through gpufuck's bounded compile-time executor. `plan_storage` exposes
gpufuck's closure, constructor, thunk, and host-boundary lifetime decisions.

The compatibility test compiles every non-failure standalone program in the
example manifest. Focused tests cover numeric values, portable F32x4 values,
structured data, ownership forms, local handlers, value-producing loops,
compile-time-derived functions, aggregate host capabilities, suspending effects,
and callable exports.
