import { assert_equals } from "../assert.ts";
import {
  integer_maximum,
  integer_minimum,
  normalize_integer,
} from "../integer.ts";
import {
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  type_sort,
} from "./kernel_terms.ts";
import { check_proof, type Proposition } from "./proof_kernel.ts";

Deno.test("omega reflection exhaustively matches tiny machine integers", () => {
  for (
    const [type_name, type] of [
      ["I3", { signed: true, width: 3 }],
      ["U3", { signed: false, width: 3 }],
    ] as const
  ) {
    const kernel_type: KernelType = { tag: "constant", name: type_name };
    const function_type: KernelType = {
      tag: "pi",
      domain: kernel_type,
      codomain: {
        tag: "pi",
        domain: kernel_type,
        codomain: kernel_type,
      },
    };
    const declarations = new Map<string, KernelType>([
      [type_name, type_sort(0)],
    ]);
    for (
      let value = integer_minimum(type);
      value <= integer_maximum(type);
      value += 1n
    ) {
      declarations.set(
        "literal:" + type_name + ":" + value.toString(),
        kernel_type,
      );
    }
    for (const operation of ["add", "subtract", "multiply", "remainder"]) {
      declarations.set(
        "primitive:" + operation + ":" + type_name,
        function_type,
      );
    }
    const environment = KernelEnvironment.from(declarations);
    const fixture: TinyMachineFixture = {
      type_name,
      kernel_type,
      function_type,
      environment,
    };
    for (
      let left = integer_minimum(type);
      left <= integer_maximum(type);
      left += 1n
    ) {
      for (
        let right = integer_minimum(type);
        right <= integer_maximum(type);
        right += 1n
      ) {
        check_operation(
          "add",
          left,
          right,
          normalize_integer(type, left + right),
          fixture,
        );
        check_operation(
          "subtract",
          left,
          right,
          normalize_integer(type, left - right),
          fixture,
        );
        check_operation(
          "multiply",
          left,
          right,
          normalize_integer(type, left * right),
          fixture,
        );
        if (right === 0n) continue;
        check_operation(
          "remainder",
          left,
          right,
          normalize_integer(type, left % right),
          fixture,
        );
      }
    }
  }
});

function check_operation(
  operation: "add" | "subtract" | "multiply" | "remainder",
  left: bigint,
  right: bigint,
  expected: bigint,
  fixture: TinyMachineFixture,
): void {
  const application: KernelTerm = {
    tag: "app",
    function: {
      tag: "app",
      function: {
        tag: "constant",
        name: "primitive:" + operation + ":" + fixture.type_name,
        type: fixture.function_type,
      },
      argument: literal(left, fixture.type_name, fixture.kernel_type),
    },
    argument: literal(right, fixture.type_name, fixture.kernel_type),
  };
  const goal: Proposition = {
    tag: "equal",
    type: fixture.kernel_type,
    left: application,
    right: literal(expected, fixture.type_name, fixture.kernel_type),
  };
  const certificate = check_proof(
    { tag: "omega_reflect", proposition: goal, hypotheses: [] },
    goal,
    { allow_unsafe: false, environment: fixture.environment },
  );
  assert_equals(certificate.safety, { tag: "safe" });
}

type TinyMachineFixture = {
  type_name: string;
  kernel_type: KernelType;
  function_type: KernelType;
  environment: KernelEnvironment;
};

function literal(
  value: bigint,
  type_name: string,
  type: KernelType,
): KernelTerm {
  return {
    tag: "constant",
    name: "literal:" + type_name + ":" + value.toString(),
    type,
  };
}
