import { assert_equals, assert_throws } from "../assert.ts";
import { type_sort } from "./kernel_terms.ts";
import {
  type KernelPattern,
  KernelPatternSolution,
  unify_kernel_patterns,
} from "./kernel_unification.ts";

const i32: KernelPattern = { tag: "constant", name: "I32" };

Deno.test("kernel pattern unification solves first-order applications", () => {
  const left: KernelPattern = {
    tag: "app",
    function: { tag: "constant", name: "Vector" },
    argument: { tag: "meta", id: 0, scope: 0 },
  };
  const right: KernelPattern = {
    tag: "app",
    function: { tag: "constant", name: "Vector" },
    argument: i32,
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), i32);
  assert_equals(solution.apply(left), solution.apply(right));
  assert_equals(solution.resolved_type(left), {
    tag: "app",
    function: { tag: "constant", name: "Vector" },
    argument: { tag: "constant", name: "I32" },
  });
});

Deno.test("kernel metavariable orientation is deterministic", () => {
  const lower: KernelPattern = { tag: "meta", id: 1, scope: 0 };
  const higher: KernelPattern = { tag: "meta", id: 2, scope: 0 };
  const forward = unify_kernel_patterns(higher, lower);
  const reverse = unify_kernel_patterns(lower, higher);

  assert_equals(forward.substitution(1), undefined);
  assert_equals(forward.substitution(2), lower);
  assert_equals(reverse.substitution(1), undefined);
  assert_equals(reverse.substitution(2), lower);
});

Deno.test("narrower metavariable scopes orient wider solutions", () => {
  const left: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "meta", id: 2, scope: 1 },
  };
  const right: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "meta", id: 1, scope: 0 },
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(1), undefined);
  assert_equals(solution.substitution(2), {
    tag: "meta",
    id: 1,
    scope: 0,
  });
  assert_equals(solution.apply(left), solution.apply(right));
});

Deno.test("one kernel metavariable cannot claim conflicting scopes", () => {
  const conflicting: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: {
      tag: "app",
      function: { tag: "meta", id: 0, scope: 0 },
      argument: { tag: "meta", id: 0, scope: 1 },
    },
  };

  assert_throws(
    () => unify_kernel_patterns(conflicting, conflicting),
    "Kernel metavariable ?0 has conflicting scopes 0 and 1.",
  );
});

Deno.test("kernel pattern unification applies transitive solutions", () => {
  const left: KernelPattern = {
    tag: "app",
    function: { tag: "meta", id: 1, scope: 0 },
    argument: { tag: "meta", id: 0, scope: 0 },
  };
  const right: KernelPattern = {
    tag: "app",
    function: { tag: "meta", id: 0, scope: 0 },
    argument: i32,
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), i32);
  assert_equals(solution.substitution(1), i32);
  assert_equals(solution.apply(left), {
    tag: "app",
    function: i32,
    argument: i32,
  });
});

Deno.test("kernel pattern unification rejects recursive solutions", () => {
  const metavariable: KernelPattern = { tag: "meta", id: 0, scope: 0 };

  assert_throws(
    () =>
      unify_kernel_patterns(metavariable, {
        tag: "app",
        function: { tag: "constant", name: "F" },
        argument: metavariable,
      }),
    "Kernel pattern occurs check failed for ?0.",
  );
});

Deno.test("unresolved kernel metavariables cannot enter checked types", () => {
  const metavariable: KernelPattern = { tag: "meta", id: 0, scope: 0 };
  const solution = unify_kernel_patterns(metavariable, metavariable);

  assert_throws(
    () => solution.resolved_type(metavariable),
    "Kernel metavariable ?0 remains unresolved.",
  );
});

Deno.test("kernel patterns solve variables inside their declared scope", () => {
  const left: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "meta", id: 0, scope: 1 },
  };
  const right: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "var", index: 0 },
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), { tag: "var", index: 0 });
  assert_equals(solution.apply(left), solution.apply(right));
});

Deno.test("outer metavariables weaken beneath local binders", () => {
  const left: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "meta", id: 0, scope: 0 },
  };
  const right: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: i32,
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), i32);
  assert_equals(solution.apply(left), solution.apply(right));
});

Deno.test("outer metavariables cannot capture later binders", () => {
  assert_throws(
    () =>
      unify_kernel_patterns({
        tag: "pi",
        domain: { tag: "sort", universe: { tag: "type", level: 0 } },
        codomain: { tag: "meta", id: 0, scope: 0 },
      }, {
        tag: "pi",
        domain: { tag: "sort", universe: { tag: "type", level: 0 } },
        codomain: { tag: "var", index: 0 },
      }),
    "Kernel pattern variable 0 escapes scope 0.",
  );
});

Deno.test("kernel lowering does not capture ambient metavariables under lambdas", () => {
  const sort: KernelPattern = { tag: "constant", name: "S" };
  const left: KernelPattern = {
    tag: "pi",
    domain: sort,
    codomain: {
      tag: "app",
      function: { tag: "meta", id: 0, scope: 0 },
      argument: { tag: "meta", id: 1, scope: 1 },
    },
  };
  const right: KernelPattern = {
    tag: "pi",
    domain: sort,
    codomain: {
      tag: "app",
      function: {
        tag: "lam",
        domain: sort,
        body: { tag: "meta", id: 1, scope: 1 },
      },
      argument: { tag: "var", index: 0 },
    },
  };

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel metavariable ?1 escapes scope 0.",
  );
});

Deno.test("kernel lowering preserves lambda-local metavariables without scope removal", () => {
  const sort: KernelPattern = { tag: "constant", name: "S" };
  const left: KernelPattern = { tag: "meta", id: 0, scope: 0 };
  const right: KernelPattern = {
    tag: "lam",
    domain: sort,
    body: { tag: "meta", id: 1, scope: 1 },
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), right);
  assert_equals(solution.apply(left), solution.apply(right));
});

Deno.test("kernel lowering resolves closed nested metavariables before scope checks", () => {
  const sort: KernelPattern = { tag: "constant", name: "S" };
  const left: KernelPattern = {
    tag: "pi",
    domain: sort,
    codomain: {
      tag: "app",
      function: { tag: "meta", id: 1, scope: 1 },
      argument: { tag: "meta", id: 0, scope: 0 },
    },
  };
  const right: KernelPattern = {
    tag: "pi",
    domain: sort,
    codomain: {
      tag: "app",
      function: i32,
      argument: {
        tag: "app",
        function: { tag: "constant", name: "F" },
        argument: { tag: "meta", id: 1, scope: 1 },
      },
    },
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), {
    tag: "app",
    function: { tag: "constant", name: "F" },
    argument: i32,
  });
  assert_equals(solution.substitution(1), i32);
  assert_equals(solution.apply(left), solution.apply(right));
});

Deno.test("kernel raising resolves nested metavariables before crossing binders", () => {
  const sort: KernelPattern = { tag: "constant", name: "S" };
  const first_left: KernelPattern = {
    tag: "lam",
    domain: sort,
    body: { tag: "meta", id: 1, scope: 1 },
  };
  const first_right: KernelPattern = {
    tag: "lam",
    domain: sort,
    body: { tag: "var", index: 0 },
  };
  const second_left: KernelPattern = { tag: "meta", id: 0, scope: 0 };
  const second_right: KernelPattern = {
    tag: "lam",
    domain: sort,
    body: { tag: "meta", id: 1, scope: 1 },
  };
  const third_left: KernelPattern = {
    tag: "lam",
    domain: { tag: "constant", name: "D" },
    body: { tag: "meta", id: 0, scope: 0 },
  };
  const third_right: KernelPattern = {
    tag: "lam",
    domain: { tag: "constant", name: "D" },
    body: {
      tag: "lam",
      domain: sort,
      body: { tag: "var", index: 0 },
    },
  };
  const left: KernelPattern = {
    tag: "app",
    function: first_left,
    argument: {
      tag: "app",
      function: second_left,
      argument: third_left,
    },
  };
  const right: KernelPattern = {
    tag: "app",
    function: first_right,
    argument: {
      tag: "app",
      function: second_right,
      argument: third_right,
    },
  };
  const solution = unify_kernel_patterns(left, right);

  assert_equals(solution.substitution(0), {
    tag: "lam",
    domain: sort,
    body: { tag: "var", index: 0 },
  });
  assert_equals(solution.substitution(1), { tag: "var", index: 0 });
  assert_equals(solution.apply(left), solution.apply(right));
});

Deno.test("kernel raising rejects unresolved binder-order ambiguity", () => {
  const left: KernelPattern = {
    tag: "app",
    function: { tag: "meta", id: 0, scope: 0 },
    argument: {
      tag: "lam",
      domain: { tag: "constant", name: "D" },
      body: { tag: "meta", id: 0, scope: 0 },
    },
  };
  const right: KernelPattern = {
    tag: "app",
    function: {
      tag: "lam",
      domain: { tag: "constant", name: "S" },
      body: { tag: "meta", id: 1, scope: 1 },
    },
    argument: {
      tag: "lam",
      domain: { tag: "constant", name: "D" },
      body: {
        tag: "lam",
        domain: { tag: "constant", name: "S" },
        body: { tag: "var", index: 1 },
      },
    },
  };

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel metavariable ?1 cannot be weakened across reordered binders.",
  );
});

Deno.test("kernel solutions raise outer variables under later binders", () => {
  const solution = unify_kernel_patterns(
    { tag: "meta", id: 0, scope: 1 },
    { tag: "var", index: 0 },
    { scope: 1 },
  );
  const pattern: KernelPattern = {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "meta", id: 0, scope: 1 },
  };

  assert_equals(solution.apply(pattern), {
    tag: "pi",
    domain: { tag: "sort", universe: { tag: "type", level: 0 } },
    codomain: { tag: "var", index: 1 },
  });
});

Deno.test("kernel patterns reject variables outside lexical scope", () => {
  assert_throws(
    () =>
      unify_kernel_patterns(
        { tag: "meta", id: 0, scope: 1 },
        { tag: "var", index: 1 },
        { scope: 1 },
      ),
    "Kernel pattern variable 1 is outside scope 1.",
  );
});

Deno.test("kernel pattern unification remains first order", () => {
  assert_throws(
    () =>
      unify_kernel_patterns(
        {
          tag: "app",
          function: { tag: "meta", id: 0, scope: 1 },
          argument: { tag: "var", index: 0 },
        },
        { tag: "var", index: 0 },
        { scope: 1 },
      ),
    "Cannot unify kernel pattern app with var.",
  );
});

Deno.test("kernel pattern unification rejects constructor mismatches", () => {
  assert_throws(
    () =>
      unify_kernel_patterns(
        { tag: "constant", name: "I32" },
        { tag: "constant", name: "Bool" },
      ),
    "Cannot unify kernel constants I32 and Bool.",
  );
  assert_throws(
    () =>
      unify_kernel_patterns(
        { tag: "sort", universe: { tag: "prop" } },
        { tag: "sort", universe: { tag: "type", level: 0 } },
      ),
    "Cannot unify different kernel universes.",
  );
});

Deno.test("kernel pattern inputs are snapshotted before solving", () => {
  let name_reads = 0;
  const changing = new Proxy({
    tag: "constant" as const,
    name: "I32",
  }, {
    get(target, key, receiver) {
      if (key === "name") {
        name_reads += 1;
        if (name_reads === 1) return "I32";
        return "Bool";
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const solution = unify_kernel_patterns(
    { tag: "meta", id: 0, scope: 0 },
    changing,
  );

  assert_equals(solution.substitution(0), i32);
  assert_equals(name_reads, 0);
});

Deno.test("kernel pattern snapshots reject cyclic graphs", () => {
  const cyclic: {
    tag: "app";
    function: KernelPattern;
    argument: KernelPattern;
  } = {
    tag: "app",
    function: i32,
    argument: i32,
  };
  cyclic.argument = cyclic;

  assert_throws(
    () => unify_kernel_patterns(cyclic, i32),
    "Kernel pattern graph must be acyclic.",
  );
});

Deno.test("kernel pattern solutions are independent of caller mutation", () => {
  const candidate = {
    tag: "sort" as const,
    universe: { tag: "type" as const, level: 0 },
  };
  const solution = unify_kernel_patterns(
    { tag: "meta", id: 0, scope: 0 },
    candidate,
  );
  candidate.universe.level = 4;

  assert_equals(solution.substitution(0), type_sort(0));
  assert_throws(
    () => {
      const substitution = solution.substitution(0);
      if (substitution === undefined || substitution.tag !== "sort") {
        throw new Error("Missing sort substitution.");
      }
      if (substitution.universe.tag !== "type") {
        throw new Error("Unexpected proposition substitution.");
      }
      substitution.universe.level = 3;
    },
    "read only",
  );
});

Deno.test("kernel pattern solution construction is sealed", () => {
  assert_throws(
    () =>
      new KernelPatternSolution(
        Symbol("forged"),
        new Map(),
        new Map(),
        0,
      ),
    "Kernel pattern solutions can only be created by the unifier.",
  );
});

Deno.test("kernel unification options are snapshotted once", () => {
  let scope_reads = 0;
  const options = new Proxy({ scope: 0 }, {
    get(target, key, receiver) {
      if (key === "scope") {
        scope_reads += 1;
        if (scope_reads === 1) return 0;
        return 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const solution = unify_kernel_patterns(
    { tag: "meta", id: 0, scope: 0 },
    i32,
    options,
  );

  assert_equals(solution.substitution(0), i32);
  assert_equals(scope_reads, 0);
});

Deno.test("kernel pattern unification has a structural step budget", () => {
  let left: KernelPattern = i32;
  let right: KernelPattern = i32;
  for (let depth = 0; depth < 13; depth += 1) {
    left = { tag: "app", function: left, argument: left };
    right = { tag: "app", function: right, argument: right };
  }

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel pattern unification exceeded 10000 steps.",
  );
});

Deno.test("kernel substitution expansion has a structural node budget", () => {
  let left: KernelPattern = { tag: "meta", id: 24, scope: 0 };
  let right: KernelPattern = { tag: "meta", id: 24, scope: 0 };
  for (let id = 23; id >= 0; id -= 1) {
    const metavariable: KernelPattern = { tag: "meta", id, scope: 0 };
    const next: KernelPattern = { tag: "meta", id: id + 1, scope: 0 };
    left = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: metavariable,
      },
      argument: left,
    };
    right = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: { tag: "app", function: next, argument: next },
      },
      argument: right,
    };
  }

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel substitution exceeded 20000 nodes.",
  );
});

Deno.test("kernel occurs checks have a structural expansion budget", () => {
  const unresolved: KernelPattern = { tag: "meta", id: 24, scope: 0 };
  let left: KernelPattern = { tag: "meta", id: 25, scope: 0 };
  let right: KernelPattern = {
    tag: "app",
    function: { tag: "constant", name: "G" },
    argument: { tag: "meta", id: 0, scope: 0 },
  };
  for (let id = 23; id >= 0; id -= 1) {
    const metavariable: KernelPattern = { tag: "meta", id, scope: 0 };
    const next: KernelPattern = { tag: "meta", id: id + 1, scope: 0 };
    left = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: metavariable,
      },
      argument: left,
    };
    right = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: { tag: "app", function: next, argument: next },
      },
      argument: right,
    };
  }
  left = {
    tag: "app",
    function: {
      tag: "app",
      function: { tag: "constant", name: "Pair" },
      argument: unresolved,
    },
    argument: left,
  };
  right = {
    tag: "app",
    function: {
      tag: "app",
      function: { tag: "constant", name: "Pair" },
      argument: unresolved,
    },
    argument: right,
  };

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel occurs check exceeded 20000 nodes.",
  );
});

Deno.test("kernel solution normalization has one aggregate node budget", () => {
  const left_chains: KernelPattern[] = [];
  const right_chains: KernelPattern[] = [];
  for (let chain = 0; chain < 2; chain += 1) {
    const first_id = chain * 13;
    let left: KernelPattern = {
      tag: "meta",
      id: first_id + 12,
      scope: 0,
    };
    let right: KernelPattern = {
      tag: "meta",
      id: first_id + 12,
      scope: 0,
    };
    for (let offset = 11; offset >= 0; offset -= 1) {
      const id = first_id + offset;
      const metavariable: KernelPattern = { tag: "meta", id, scope: 0 };
      const next: KernelPattern = { tag: "meta", id: id + 1, scope: 0 };
      left = {
        tag: "app",
        function: {
          tag: "app",
          function: { tag: "constant", name: "Pair" },
          argument: metavariable,
        },
        argument: left,
      };
      right = {
        tag: "app",
        function: {
          tag: "app",
          function: { tag: "constant", name: "Pair" },
          argument: { tag: "app", function: next, argument: next },
        },
        argument: right,
      };
    }
    left_chains.push(left);
    right_chains.push(right);
  }
  const left: KernelPattern = {
    tag: "app",
    function: left_chains[0],
    argument: left_chains[1],
  };
  const right: KernelPattern = {
    tag: "app",
    function: right_chains[0],
    argument: right_chains[1],
  };

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel substitution exceeded 20000 nodes.",
  );
});

Deno.test("kernel binding expansion has one aggregate work budget", () => {
  let left: KernelPattern = { tag: "constant", name: "End" };
  let right: KernelPattern = { tag: "constant", name: "End" };
  for (let alias = 99; alias >= 0; alias -= 1) {
    const fresh: KernelPattern = {
      tag: "meta",
      id: 13 + alias,
      scope: 0,
    };
    left = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: fresh,
      },
      argument: left,
    };
    right = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: { tag: "meta", id: 0, scope: 0 },
      },
      argument: right,
    };
  }
  for (let id = 11; id >= 0; id -= 1) {
    const metavariable: KernelPattern = { tag: "meta", id, scope: 0 };
    const next: KernelPattern = { tag: "meta", id: id + 1, scope: 0 };
    left = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: metavariable,
      },
      argument: left,
    };
    right = {
      tag: "app",
      function: {
        tag: "app",
        function: { tag: "constant", name: "Pair" },
        argument: { tag: "app", function: next, argument: next },
      },
      argument: right,
    };
  }

  assert_throws(
    () => unify_kernel_patterns(left, right),
    "Kernel occurs check exceeded 20000 nodes.",
  );
});
