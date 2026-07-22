export type CompilerCompatibilityCase = {
  path: string;
  expected: number;
};

export const compiler_compatibility_cases:
  readonly CompilerCompatibilityCase[] = [
    {
      path: "examples/basics/01_arithmetic_and_shadowing.duck",
      expected: 42,
    },
    {
      path: "examples/basics/04_comparisons_and_logic.duck",
      expected: 42,
    },
    {
      path: "examples/basics/06_functions_and_blocks.duck",
      expected: 42,
    },
    {
      path: "examples/basics/10_else_if.duck",
      expected: 42,
    },
    {
      path: "examples/compile_time/03_const_parameter_twice.duck",
      expected: 42,
    },
    {
      path: "examples/compile_time/05_static_recursion_factorial.duck",
      expected: 42,
    },
    {
      path: "examples/functions/01_closure_capture.duck",
      expected: 43,
    },
    {
      path: "examples/functions/02_returned_closure.duck",
      expected: 42,
    },
    {
      path: "examples/functions/03_closure_local_shadow.duck",
      expected: 42,
    },
    {
      path: "examples/functions/04_recursive_fibonacci.duck",
      expected: 8,
    },
  ];
