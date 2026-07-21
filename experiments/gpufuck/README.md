# Experimental gpufuck compiler

This directory translates Duck's elaborated semantic Core into the functional
surface from the sibling `../gpufuck` repository, runs gpufuck's WebGPU semantic
compiler, and emits runnable WebAssembly.

The adapter is validated against gpufuck `main` revision
`8347bddb37c8c1778bcbd75860928db52d5b93a2` (2026-07-21). That was the current
upstream head when this experiment was last refreshed.

The adapter explicitly selects gpufuck's strict-eager evaluation profile to
match Duck's source semantics.

The Core adapter supports Duck's i32, i64, f32, and f64 surface; closures and
recursion; structs, arrays, unions, and runtime indexing; range, collection,
break, continue, and loop-expression control flow; local handlers; and the
Text/Bytes operations used by the examples. F32x4 lowers to a portable four-lane
f32 aggregate because gpufuck's Functional Core intentionally has no
target-specific SIMD type. Duck Bool remains its source ABI i32 and is converted
to gpufuck Bool only at control-flow conditions.

Duck's frontend retains parsing, module specialization, type-level evaluation,
ownership and linearity validation, effect analysis, and source diagnostics.
Borrow, freeze, scratch, and owned aggregates lower to gpufuck's immutable
values, while effect and Init declarations lower to typed gpufuck host
capabilities with their borrow, transfer, and frozen-shareable contracts. The
`run`, `run_file`, and `run_async` methods install the adapter's Text/Bytes
runtime automatically and accept the remaining Init capabilities from the
caller. Operations declared with `suspending` require `run_async`; the
synchronous runner rejects them before invoking the host. Managed source
callables become gpufuck persistent WebAssembly exports. `prepare_file` retains
one compiled module for repeated `run` or `run_async` calls; callers destroy the
returned program before destroying its compiler. The lowered program is linked
from a typed gpufuck module artifact. File compilation continues to use Duck's
source-module specialization; batch compilation uses gpufuck's ordered GPU
lanes.

`evaluate_comptime` and `evaluate_comptime_file` send a pure Duck program's
`main` export through gpufuck's required compile-time executor. They return its
structured constant result or its compile, execution, and comptime diagnostics;
callers can set compiler fuel, evaluator fuel, heap, stack, and output limits
through gpufuck's comptime options. Duck still performs its source-level type
and module elaboration before the typed artifact reaches this boundary.

`plan_storage` exposes gpufuck's storage decisions for a lowered Duck program.
The standard runners apply the plan's automatic invocation-arena reset, while
embedders can inspect closure, constructor, thunk, and host-boundary lifetimes
before emitting or instantiating Wasm. Calls made directly through the returned
WebAssembly instance are outside the runner's boundary; when
`automaticArenaReset` is true, wrap each such call with
`beginFunctionalWasmArena` and reset it after decoding the result.

Compile a supported Duck file:

```sh
deno task compiler:gpufuck examples/functions/04_recursive_fibonacci.duck
```

Run the correctness suite and the before/after benchmark:

```sh
deno task compiler:gpufuck:test
deno task compiler:gpufuck:bench
deno task compiler:gpufuck:runtime
deno task compiler:gpufuck:codex
```

The benchmark preloads ten source files, warms both routes, then reports the
median of 20 rounds. Both routes are measured from Duck source through binary
Wasm and execute their outputs for verification. The current route reports Duck
parsing, frontend work, lowering, and WAT generation separately from `wat2wasm`
emission. The experimental route reports Duck parsing, Core lowering and surface
encoding separately from GPU semantic compilation and binary Wasm emission. GPU
device/compiler startup is reported but excluded from the warm total. WAT and
Wasm byte counts are included as context, not compared as equivalent encodings.

The same command also reports seven-round medians for generated straight-line
programs with 100, 500, 1,000, and 2,000 bindings. This makes the fixed GPU cost
and any larger-module crossover visible instead of extrapolating from tiny
examples.

On the July 2026 development checkout, the ten-file warm median was 18.16 ms
through gpufuck versus 7.92 ms through the current routes. The gpufuck frontend
spent 0.74 ms parsing Duck and 3.86 ms lowering Core and encoding the functional
surface, for a combined 4.48 ms median. GPU semantic compilation took 13.04 ms
and binary emission took 0.84 ms. Its ten binaries occupied 582 bytes after
immediately consumed returned closures entered the compact backend. WebGPU
compiler startup took 228.30 ms and the first ten-file compilation took 49.47
ms. At 500 generated bindings gpufuck took 39.98 ms versus 35.52 ms through the
current compiler. At 1,000 bindings gpufuck took 88.76 ms versus 91.28 ms. The
2,000-binding result remains sensitive to frontend garbage collection; that run
measured 318.11 ms through gpufuck and 268.94 ms through the current route.
These figures are local measurements, not stable performance guarantees.

The runtime benchmark uses the modular program in `workload/main.duck`. Four
parameterized modules specialize constants used by three recursive 512-round
kernels. The current Core backend cannot emit the linked modular form yet, so
`workload/current.duck` is the checked-in flattened equivalent used for the
runtime baseline. `workload/current_callable.duck` separately exposes the same
kernels as a managed callable. The benchmark verifies every contract before
measuring fresh first execution, instantiation plus first execution, and warm
calls on one instance.

The output separates recomputing entries, recomputing callables, and retained
values. Recomputing measurements execute all three kernels on every call; the
retained-value measurement intentionally evaluates once and measures lookup on
later calls. This prevents retained lookup from being presented as kernel
execution speed. In the July 2026 checkout, the compact modular gpufuck entry
was 234 bytes versus 204 bytes and repeated the workload in 996 ns versus 992
ns. Its fresh execution took 982 ns versus 959 ns, and instantiation plus first
execution took 3.08 us versus 2.49 us. The managed callable recomputed in 995 ns
after initialization versus 998 ns, while instantiation plus first execution
took 12.36 us versus 10.70 us. The explicit retained fixture took 6.21 ns after
its first evaluation. These are local measurements, not stable performance
guarantees.

The Codex-derived benchmark compiles the shared incremental citation parser in
`case-studies/codex/`, including its source-defined generic list, parser state,
UTF-8 byte access, delimiter matching, branches, loops, and list traversal. On
the July 2026 development checkout, gpufuck compiled the Duck source to binary
Wasm in 147.93 ms versus 6,371.46 ms for the current route, a 43.07x
compile-time speedup. The current route emitted 124,350 bytes of WAT and 5,932
bytes of Wasm; gpufuck emitted 56,118 bytes of Wasm. Warm execution took 30.64
us through gpufuck versus 4.91 us through the current route. Both routes
recompute and return the independently verified digest `474580703`. Direct
gpufuck calls run inside invocation arenas so temporary parser buffers are
reclaimed after each call. These figures are local measurements, not stable
performance guarantees.

The compatibility test compiles all 73 non-failure, standalone programs in the
current `examples/` manifest through gpufuck. The focused tests also execute
wide numeric values, portable F32x4 operations, structured values, ownership
forms, local handlers, value-producing loops, compile-time-derived functions,
aggregate effect capabilities, suspending effects, and multi-argument managed
callable exports. A local recursive-call fixture also checks scalar-local and
invocation-arena closure decisions through gpufuck's storage planner.

The experiment now covers Duck's source-level semantic capabilities, but it is
not a byte-for-byte replacement for the `duck-js-1` backend. Persistent callable
arguments use gpufuck's versioned tagged value ABI, while DuckHost expects
`duck-js-1`; imported Duck source modules are specialized by Duck before the
resulting typed artifact reaches gpufuck; and F32x4 is scalarized instead of
using native Wasm SIMD. Raw linear-memory loads and stores remain Duck backend
instructions rather than portable Functional Core operations. None of those
boundaries prevents the standalone source suite from compiling, but a host that
requires the exact DuckHost ABI still needs the current backend.
