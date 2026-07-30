import { assert_equals, assert_throws } from "../assert.ts";
import {
  assume_fact,
  assume_machine_bitmask,
  assume_machine_congruence,
  assume_machine_difference,
  assume_machine_disequality,
  assume_machine_equality,
  assume_machine_fact,
  assume_state,
  establish_fact,
  exclude_fact,
  exclude_machine_fact,
  exclude_state,
  type FactEnvironment,
  implies_fact,
  implies_machine_bitmask,
  implies_machine_congruence,
  implies_machine_difference,
  implies_machine_disequality,
  implies_machine_equality,
  implies_machine_fact,
  join_facts,
  join_machine_domains,
  join_states,
  machine_bitmask,
  machine_congruences,
  machine_differences,
  machine_disequalities,
  machine_excludes_equal,
  machine_fact_domain,
  machine_fact_evidence,
  machine_range,
  meet_facts,
  normalize_machine_integer,
  reachable_state,
  transfer_machine_bitwise,
  transfer_machine_offset,
  unreachable_state,
  widen_facts,
  widen_machine_facts,
} from "./fact_graph.ts";
import type { ValueId } from "./semantic_identity.ts";
import type { ScalarFact } from "./fact_graph.ts";

const value = "stable:value" as ValueId;

Deno.test("fact meet narrows an interval to an exact value", () => {
  assert_equals(
    meet_facts(
      { tag: "interval", minimum: 0n, maximum: 10n },
      { tag: "exact", value: 4n },
    ),
    { tag: "exact", value: 4n },
  );
});

Deno.test("fact join computes a sound interval hull", () => {
  assert_equals(
    join_facts(
      { tag: "exact", value: 2n },
      { tag: "exact", value: 8n },
    ),
    { tag: "interval", minimum: 2n, maximum: 8n },
  );
});

Deno.test("fact assumptions accumulate in an environment", () => {
  let environment: FactEnvironment = new Map();
  environment = assume_fact(environment, {
    tag: "greater_equal",
    value,
    bound: 2n,
  });
  environment = assume_fact(environment, {
    tag: "less_equal",
    value,
    bound: 8n,
  });

  assert_equals(
    implies_fact(environment, { tag: "greater_equal", value, bound: 2n }),
    true,
  );
  assert_equals(
    implies_fact(environment, { tag: "less_equal", value, bound: 8n }),
    true,
  );
  assert_equals(
    implies_fact(environment, { tag: "equal", value, expected: 4n }),
    false,
  );
});

Deno.test("fact exclusion marks an exact contradiction as bottom", () => {
  let environment: FactEnvironment = new Map();
  environment = assume_fact(environment, { tag: "equal", value, expected: 3n });
  environment = exclude_fact(environment, {
    tag: "equal",
    value,
    expected: 3n,
  });
  assert_equals(environment.get(value), { tag: "bottom" });
});

Deno.test("false inequality branches retain the complementary bound", () => {
  const state = exclude_state(reachable_state, {
    tag: "less_than",
    value,
    bound: 4n,
  });
  assert_equals(
    implies_fact(state.facts, { tag: "greater_equal", value, bound: 4n }),
    true,
  );
});

Deno.test("impossible inequality assumptions make a state unreachable", () => {
  const state = assume_state(reachable_state, {
    tag: "greater_than",
    value,
    bound: MAX_INTEGER_FOR_TEST,
  });
  assert_equals(state, unreachable_state);
});

Deno.test("fact widening preserves an expanding interval soundly", () => {
  assert_equals(
    widen_facts(
      { tag: "interval", minimum: 0n, maximum: 4n },
      { tag: "interval", minimum: -2n, maximum: 8n },
    ),
    {
      tag: "interval",
      minimum: -MAX_INTEGER_FOR_TEST,
      maximum: MAX_INTEGER_FOR_TEST,
    },
  );
});

Deno.test("contradictory assumptions make a state unreachable", () => {
  let state = reachable_state;
  state = assume_state(state, { tag: "greater_equal", value, bound: 4n });
  state = assume_state(state, { tag: "less_than", value, bound: 4n });

  assert_equals(state, unreachable_state);
});

Deno.test("state joins ignore unreachable predecessors", () => {
  const reachable = assume_state(reachable_state, {
    tag: "equal",
    value,
    expected: 7n,
  });
  assert_equals(join_states(unreachable_state, reachable), reachable);
});

Deno.test("state joins drop facts absent from one reachable predecessor", () => {
  const constrained = assume_state(reachable_state, {
    tag: "equal",
    value,
    expected: 7n,
  });
  const joined = join_states(constrained, reachable_state);

  assert_equals(joined.facts.has(value), false);
});

Deno.test("widening never shrinks a previous interval", () => {
  assert_equals(
    widen_facts(
      { tag: "interval", minimum: 0n, maximum: 10n },
      { tag: "interval", minimum: 2n, maximum: 8n },
    ),
    { tag: "interval", minimum: 0n, maximum: 10n },
  );
});

Deno.test("malformed intervals canonicalize to bottom", () => {
  assert_equals(
    meet_facts(
      { tag: "interval", minimum: 2n, maximum: 1n },
      { tag: "unknown" },
    ),
    { tag: "bottom" },
  );
});

Deno.test("fact evidence preserves proposition origins and safety", () => {
  const evidence = establish_fact(
    { tag: "greater_equal", value, bound: 1n },
    [{ start: 4, end: 12 }],
    { tag: "unsafe", origins: [{ start: 1, end: 3 }] },
  );

  assert_equals(evidence.fact, {
    tag: "interval",
    minimum: 1n,
    maximum: (1n << 127n) - 1n,
  });
  assert_equals(evidence.origins, [{ start: 4, end: 12 }]);
  assert_equals(evidence.safety.tag, "unsafe");
});

Deno.test("machine integer facts normalize signed and unsigned wrapping", () => {
  assert_equals(machine_range({ width: 3, signed: true }), {
    minimum: -4n,
    maximum: 3n,
  });
  assert_equals(machine_range({ width: 3, signed: false }), {
    minimum: 0n,
    maximum: 7n,
  });
  assert_equals(normalize_machine_integer(7n, { width: 3, signed: true }), -1n);
  assert_equals(
    normalize_machine_integer(-1n, { width: 3, signed: false }),
    7n,
  );
});

Deno.test("machine congruences normalize and imply weaker moduli", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 4, signed: false }]]),
  );
  domain = assume_machine_congruence(domain, value, 4n, -1n);
  assert_equals(machine_congruences(domain, value), [{
    modulus: 4n,
    residue: 3n,
  }]);
  assert_equals(implies_machine_congruence(domain, value, 2n, 1n), true);
  assert_equals(implies_machine_congruence(domain, value, 4n, 1n), false);
  assert_equals(machine_excludes_equal(domain, value, 2n), true);
  const exact = assume_machine_fact(
    machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    ),
    { tag: "equal", value, expected: 0n },
  );
  assert_equals(implies_machine_congruence(exact, value, 9n, 0n), true);

  let singleton = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  singleton = assume_machine_congruence(singleton, value, 8n, 3n);
  assert_equals(
    implies_machine_fact(singleton, {
      tag: "equal",
      value,
      expected: 3n,
    }),
    true,
  );
  assert_equals(
    implies_machine_fact(singleton, {
      tag: "greater_equal",
      value,
      bound: 3n,
    }),
    true,
  );
  assert_equals(
    implies_machine_fact(singleton, {
      tag: "less_equal",
      value,
      bound: 3n,
    }),
    true,
  );

  domain = assume_machine_congruence(domain, value, 8n, 7n);
  assert_equals(machine_congruences(domain, value), [{
    modulus: 8n,
    residue: 7n,
  }]);
  assert_equals(
    Object.isFrozen(machine_congruences(domain, value)[0]),
    true,
  );
  assert_equals(Object.isFrozen(machine_congruences(domain, value)), true);
});

Deno.test("machine congruences detect scalar and modular contradictions", () => {
  let narrowed = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  narrowed = assume_machine_fact(narrowed, {
    tag: "greater_equal",
    value,
    bound: 2n,
  });
  narrowed = assume_machine_fact(narrowed, {
    tag: "less_equal",
    value,
    bound: 3n,
  });
  narrowed = assume_machine_congruence(narrowed, value, 4n, 1n);
  assert_equals(narrowed.reachable, false);

  let modular = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  modular = assume_machine_congruence(modular, value, 4n, 1n);
  modular = assume_machine_congruence(modular, value, 2n, 0n);
  assert_equals(modular.reachable, false);

  let reversed = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  reversed = assume_machine_congruence(reversed, value, 4n, 1n);
  reversed = assume_machine_fact(reversed, {
    tag: "greater_equal",
    value,
    bound: 2n,
  });
  reversed = assume_machine_fact(reversed, {
    tag: "less_equal",
    value,
    bound: 3n,
  });
  assert_equals(reversed.reachable, false);

  let conjunction_first = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  conjunction_first = assume_machine_congruence(
    conjunction_first,
    value,
    2n,
    0n,
  );
  conjunction_first = assume_machine_congruence(
    conjunction_first,
    value,
    3n,
    1n,
  );
  assert_equals(
    implies_machine_congruence(conjunction_first, value, 6n, 4n),
    true,
  );
  conjunction_first = assume_machine_fact(conjunction_first, {
    tag: "less_equal",
    value,
    bound: 2n,
  });
  assert_equals(conjunction_first.reachable, false);

  let interval_first = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  interval_first = assume_machine_fact(interval_first, {
    tag: "less_equal",
    value,
    bound: 2n,
  });
  interval_first = assume_machine_congruence(interval_first, value, 2n, 0n);
  interval_first = assume_machine_congruence(interval_first, value, 3n, 1n);
  assert_equals(interval_first.reachable, false);
});

Deno.test("machine congruence reduction accounts for finite exclusions", () => {
  for (const exclusion_first of [false, true]) {
    let domain = machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    );
    if (exclusion_first) {
      domain = exclude_machine_fact(domain, {
        tag: "equal",
        value,
        expected: 4n,
      });
    }
    domain = assume_machine_congruence(domain, value, 2n, 0n);
    domain = assume_machine_congruence(domain, value, 3n, 1n);
    if (!exclusion_first) {
      domain = exclude_machine_fact(domain, {
        tag: "equal",
        value,
        expected: 4n,
      });
    }
    assert_equals(domain.reachable, false);
  }
});

Deno.test("machine congruence joins retain the weakest shared modulus", () => {
  const ranges = new Map([[value, { width: 4, signed: false }]]);
  let left = machine_fact_domain(ranges);
  let right = machine_fact_domain(ranges);
  left = assume_machine_fact(left, { tag: "equal", value, expected: 1n });
  right = assume_machine_fact(right, { tag: "equal", value, expected: 5n });
  const exact_join = join_machine_domains(left, right);
  assert_equals(machine_congruences(exact_join, value), [{
    modulus: 4n,
    residue: 1n,
  }]);

  left = assume_machine_congruence(
    machine_fact_domain(ranges),
    value,
    4n,
    1n,
  );
  right = assume_machine_congruence(
    machine_fact_domain(ranges),
    value,
    4n,
    3n,
  );
  const modular_join = join_machine_domains(left, right);
  assert_equals(machine_congruences(modular_join, value), [{
    modulus: 2n,
    residue: 1n,
  }]);
  assert_equals(
    machine_congruences(
      join_machine_domains(left, machine_fact_domain(ranges)),
      value,
    ),
    [],
  );
});

Deno.test("machine congruence joins are exhaustive for three-bit integers", () => {
  for (const signed of [false, true]) {
    const type = { width: 3 as const, signed };
    const range = machine_range(type);
    const cases: {
      modulus: bigint;
      residue: bigint;
      domain: ReturnType<typeof machine_fact_domain>;
    }[] = [];
    for (let modulus = 1n; modulus <= 10n; modulus += 1n) {
      for (let residue = 0n; residue < modulus; residue += 1n) {
        cases.push({
          modulus,
          residue,
          domain: assume_machine_congruence(
            machine_fact_domain(new Map([[value, type]])),
            value,
            modulus,
            residue,
          ),
        });
      }
    }
    for (const left of cases) {
      for (const right of cases) {
        const joined = join_machine_domains(left.domain, right.domain);
        const reversed = join_machine_domains(right.domain, left.domain);
        assert_equals(
          machine_congruences(joined, value),
          machine_congruences(reversed, value),
        );
        for (
          let concrete = range.minimum;
          concrete <= range.maximum;
          concrete += 1n
        ) {
          let left_residue = concrete % left.modulus;
          if (left_residue < 0n) left_residue += left.modulus;
          let right_residue = concrete % right.modulus;
          if (right_residue < 0n) right_residue += right.modulus;
          const belongs_to_union = left_residue === left.residue ||
            right_residue === right.residue;
          if (!belongs_to_union) continue;
          for (const congruence of machine_congruences(joined, value)) {
            let joined_residue = concrete % congruence.modulus;
            if (joined_residue < 0n) {
              joined_residue += congruence.modulus;
            }
            assert_equals(joined_residue, congruence.residue);
          }
        }
      }
    }
  }
});

Deno.test("machine offset transfer preserves non-wrapping congruences", () => {
  const input = "congruent-offset-input" as ValueId;
  const offset = "congruent-offset-constant" as ValueId;
  const result = "congruent-offset-result" as ValueId;
  const ranges = new Map([
    [input, { width: 4, signed: true }],
    [offset, { width: 4, signed: true }],
    [result, { width: 4, signed: true }],
  ]);
  let domain = machine_fact_domain(ranges);
  domain = assume_machine_fact(domain, {
    tag: "greater_equal",
    value: input,
    bound: -4n,
  });
  domain = assume_machine_fact(domain, {
    tag: "less_equal",
    value: input,
    bound: 4n,
  });
  domain = assume_machine_congruence(domain, input, 4n, 3n);
  domain = assume_machine_fact(domain, {
    tag: "equal",
    value: offset,
    expected: 1n,
  });
  const added = transfer_machine_offset(
    domain,
    "add",
    input,
    offset,
    result,
  );
  assert_equals(machine_congruences(added, result), [{
    modulus: 4n,
    residue: 0n,
  }]);
  const subtracted = transfer_machine_offset(
    domain,
    "subtract",
    input,
    offset,
    result,
  );
  assert_equals(machine_congruences(subtracted, result), [{
    modulus: 4n,
    residue: 2n,
  }]);

  const wrapping = assume_machine_fact(domain, {
    tag: "greater_equal",
    value: input,
    bound: 7n,
  });
  assert_equals(
    machine_congruences(
      transfer_machine_offset(
        wrapping,
        "add",
        input,
        offset,
        result,
      ),
      result,
    ),
    [],
  );
});

Deno.test("machine congruence assumptions are exhaustive for three-bit integers", () => {
  for (const signed of [false, true]) {
    const type = { width: 3 as const, signed };
    const range = machine_range(type);
    for (let modulus = 1n; modulus <= 8n; modulus += 1n) {
      for (let residue = -10n; residue <= 10n; residue += 1n) {
        const domain = assume_machine_congruence(
          machine_fact_domain(new Map([[value, type]])),
          value,
          modulus,
          residue,
        );
        let has_witness = false;
        for (
          let concrete = range.minimum;
          concrete <= range.maximum;
          concrete += 1n
        ) {
          let concrete_residue = concrete % modulus;
          if (concrete_residue < 0n) concrete_residue += modulus;
          let expected_residue = residue % modulus;
          if (expected_residue < 0n) expected_residue += modulus;
          if (concrete_residue === expected_residue) has_witness = true;
        }
        assert_equals(domain.reachable, has_witness);
        if (!has_witness) continue;
        assert_equals(
          implies_machine_congruence(
            domain,
            value,
            modulus,
            residue,
          ),
          true,
        );
      }
    }
  }
});

Deno.test("machine congruence normalization is assumption-order independent", () => {
  const moduli = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n];
  const assume_all = (ordered_moduli: readonly bigint[]) => {
    let domain = machine_fact_domain(
      new Map([[value, { width: 128, signed: false }]]),
    );
    for (const modulus of ordered_moduli) {
      domain = assume_machine_congruence(domain, value, modulus, 0n);
    }
    return domain;
  };
  const forward = assume_all(moduli);
  const reverse = assume_all([...moduli].reverse());
  assert_equals(
    machine_congruences(forward, value),
    machine_congruences(reverse, value),
  );
  assert_equals(machine_congruences(forward, value).length, 1);
  for (const modulus of moduli) {
    assert_equals(
      implies_machine_congruence(forward, value, modulus, 0n),
      true,
    );
  }
  const nonzero_atoms = [
    { modulus: 3n, residue: 2n },
    { modulus: 4n, residue: 3n },
    { modulus: 5n, residue: 4n },
  ];
  const assume_nonzero = (
    atoms: readonly { modulus: bigint; residue: bigint }[],
  ) => {
    let domain = machine_fact_domain(
      new Map([[value, { width: 128, signed: false }]]),
    );
    for (const atom of atoms) {
      domain = assume_machine_congruence(
        domain,
        value,
        atom.modulus,
        atom.residue,
      );
    }
    return machine_congruences(domain, value);
  };
  assert_equals(assume_nonzero(nonzero_atoms), [{
    modulus: 60n,
    residue: 59n,
  }]);
  assert_equals(
    assume_nonzero(nonzero_atoms),
    assume_nonzero([...nonzero_atoms].reverse()),
  );
  assert_throws(
    () => assume_machine_congruence(forward, value, 0n, 0n),
    "Machine congruence modulus must be positive: 0.",
  );
});

Deno.test("machine differences close transitively and detect negative cycles", () => {
  const middle = "difference:middle" as ValueId;
  const upper = "difference:upper" as ValueId;
  let domain = machine_fact_domain(
    new Map([
      [value, { width: 3, signed: true }],
      [middle, { width: 3, signed: true }],
      [upper, { width: 3, signed: true }],
    ]),
  );
  domain = assume_machine_difference(domain, value, middle, -1n);
  domain = assume_machine_difference(domain, middle, upper, 0n);
  assert_equals(
    implies_machine_difference(domain, value, upper, -1n),
    true,
  );
  assert_equals(
    implies_machine_difference(domain, value, upper, -2n),
    false,
  );
  assert_equals(
    machine_differences(domain).some((difference) =>
      difference.left === value &&
      difference.right === upper &&
      difference.maximum === -1n
    ),
    true,
  );
  let reverse = machine_fact_domain(
    new Map([
      [value, { width: 3, signed: true }],
      [middle, { width: 3, signed: true }],
      [upper, { width: 3, signed: true }],
    ]),
  );
  reverse = assume_machine_difference(reverse, middle, upper, 0n);
  reverse = assume_machine_difference(reverse, value, middle, -1n);
  assert_equals(machine_differences(domain), machine_differences(reverse));
  domain = assume_machine_difference(domain, upper, value, 0n);
  assert_equals(domain.reachable, false);

  let exhausted = machine_fact_domain(
    new Map([
      [value, { width: 3, signed: false }],
      [middle, { width: 3, signed: false }],
      [upper, { width: 3, signed: false }],
    ]),
  );
  exhausted = assume_machine_difference(exhausted, value, middle, -7n);
  exhausted = assume_machine_difference(exhausted, middle, upper, -7n);
  assert_equals(exhausted.reachable, false);
  assert_throws(
    () =>
      assume_machine_difference(
        exhausted,
        value,
        middle,
        "invalid" as unknown as bigint,
      ),
    "Machine difference maximum must be an integer: invalid.",
  );
});

Deno.test("machine equalities close transitively and contradict disequalities", () => {
  const middle = "equality:middle" as ValueId;
  const right = "equality:right" as ValueId;
  const separate = "equality:separate" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: false }],
    [middle, { width: 3, signed: false }],
    [right, { width: 3, signed: false }],
    [separate, { width: 3, signed: false }],
  ]);
  let equal = machine_fact_domain(ranges);
  equal = assume_machine_equality(equal, value, middle);
  equal = assume_machine_equality(equal, middle, right);
  assert_equals(implies_machine_equality(equal, value, right), true);
  assert_equals(implies_machine_disequality(equal, value, right), false);
  assert_equals(
    assume_machine_disequality(equal, value, right).reachable,
    false,
  );

  let disequal = machine_fact_domain(ranges);
  disequal = assume_machine_disequality(disequal, value, right);
  assert_equals(implies_machine_disequality(disequal, right, value), true);
  assert_equals(machine_disequalities(disequal), [{
    left: right,
    right: value,
  }]);
  assert_equals(
    assume_machine_equality(disequal, right, value).reachable,
    false,
  );

  let substituted = machine_fact_domain(ranges);
  substituted = assume_machine_disequality(substituted, middle, separate);
  substituted = assume_machine_equality(substituted, value, middle);
  assert_equals(
    implies_machine_disequality(substituted, value, separate),
    true,
  );
});

Deno.test("machine equalities survive nonconvex refinements in either order", () => {
  const right = "equality:nonconvex:right" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: false }],
    [right, { width: 3, signed: false }],
  ]);
  for (const relation_first of [false, true]) {
    for (const refinement of ["congruence", "bitmask", "exclusion"]) {
      let domain = machine_fact_domain(ranges);
      if (relation_first) {
        domain = assume_machine_equality(domain, value, right);
      }
      if (refinement === "congruence") {
        domain = assume_machine_congruence(domain, value, 2n, 0n);
      } else if (refinement === "bitmask") {
        domain = assume_machine_bitmask(domain, value, 0b001n, 0n);
      } else {
        domain = exclude_machine_fact(domain, {
          tag: "equal",
          value,
          expected: 1n,
        });
      }
      if (!relation_first) {
        domain = assume_machine_equality(domain, value, right);
      }
      assert_equals(domain.reachable, true);
      assert_equals(implies_machine_equality(domain, value, right), true);
    }
  }
  let equal = assume_machine_equality(
    machine_fact_domain(ranges),
    value,
    right,
  );
  equal = assume_machine_congruence(equal, value, 2n, 0n);
  assert_equals(
    implies_machine_equality(
      join_machine_domains(equal, equal),
      value,
      right,
    ),
    true,
  );
  assert_equals(
    implies_machine_equality(
      join_machine_domains(equal, machine_fact_domain(ranges)),
      value,
      right,
    ),
    false,
  );
});

Deno.test("nonconvex equalities retain direct join provenance", () => {
  const middle_left = "equality:join:middle-left" as ValueId;
  const middle_right = "equality:join:middle-right" as ValueId;
  const right = "equality:join:right" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: false }],
    [middle_left, { width: 3, signed: false }],
    [middle_right, { width: 3, signed: false }],
    [right, { width: 3, signed: false }],
  ]);
  let left = machine_fact_domain(ranges);
  left = assume_machine_equality(left, value, middle_left);
  left = assume_machine_equality(left, middle_left, right);
  left = assume_machine_bitmask(left, value, 0b001n, 0n);
  let other = machine_fact_domain(ranges);
  other = assume_machine_equality(other, value, middle_right);
  other = assume_machine_equality(other, middle_right, right);
  other = assume_machine_bitmask(other, value, 0b001n, 0n);
  assert_equals(implies_machine_equality(left, value, right), true);
  assert_equals(implies_machine_equality(other, value, right), true);
  assert_equals(
    implies_machine_equality(
      join_machine_domains(left, other),
      value,
      right,
    ),
    false,
  );
  const explicit = assume_machine_equality(left, value, right);
  let direct = assume_machine_equality(
    machine_fact_domain(ranges),
    value,
    right,
  );
  direct = assume_machine_bitmask(direct, value, 0b001n, 0n);
  assert_equals(
    implies_machine_equality(
      join_machine_domains(explicit, direct),
      value,
      right,
    ),
    true,
  );
});

Deno.test("machine disequalities reduce against scalar facts", () => {
  const right = "disequality:scalar:right" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: true }],
    [right, { width: 3, signed: true }],
  ]);
  for (const relation_first of [false, true]) {
    let domain = machine_fact_domain(ranges);
    if (relation_first) {
      domain = assume_machine_disequality(domain, value, right);
    }
    domain = assume_machine_fact(domain, {
      tag: "equal",
      value,
      expected: 1n,
    });
    domain = assume_machine_fact(domain, {
      tag: "equal",
      value: right,
      expected: 1n,
    });
    if (!relation_first) {
      domain = assume_machine_disequality(domain, value, right);
    }
    assert_equals(domain.reachable, false);
  }

  let disjoint = machine_fact_domain(ranges);
  disjoint = assume_machine_fact(disjoint, {
    tag: "less_than",
    value,
    bound: 0n,
  });
  disjoint = assume_machine_fact(disjoint, {
    tag: "greater_equal",
    value: right,
    bound: 0n,
  });
  assert_equals(implies_machine_disequality(disjoint, value, right), true);
});

Deno.test("machine disequality joins and rebuilt values preserve identity", () => {
  const input = "disequality:join:input" as ValueId;
  const offset = "disequality:join:offset" as ValueId;
  const right = "disequality:join:right" as ValueId;
  const ranges = new Map([
    [input, { width: 3, signed: true }],
    [offset, { width: 3, signed: true }],
    [value, { width: 3, signed: true }],
    [right, { width: 3, signed: true }],
  ]);
  const excluded = assume_machine_disequality(
    machine_fact_domain(ranges),
    value,
    right,
  );
  excluded.disequalities.forEach((rights) => {
    assert_equals(Object.isFrozen(rights), true);
    assert_throws(
      () => (rights as ValueId[]).push(value),
      "Cannot add property",
    );
  });
  assert_throws(
    () =>
      (excluded.disequalities as Map<ValueId, readonly ValueId[]>).set(
        value,
        [right],
      ),
    "set is not a function",
  );
  assert_equals(
    implies_machine_disequality(
      join_machine_domains(excluded, excluded),
      value,
      right,
    ),
    true,
  );
  assert_equals(
    implies_machine_disequality(
      join_machine_domains(excluded, machine_fact_domain(ranges)),
      value,
      right,
    ),
    false,
  );

  let rebuilt = assume_machine_fact(excluded, {
    tag: "equal",
    value: input,
    expected: 1n,
  });
  rebuilt = assume_machine_fact(rebuilt, {
    tag: "equal",
    value: offset,
    expected: 1n,
  });
  rebuilt = transfer_machine_offset(
    rebuilt,
    "add",
    input,
    offset,
    value,
  );
  assert_equals(
    implies_machine_disequality(rebuilt, value, right),
    false,
  );
});

Deno.test("machine differences reduce against scalar facts in either order", () => {
  const right = "difference:scalar:right" as ValueId;
  for (const relation_first of [false, true]) {
    let domain = machine_fact_domain(
      new Map([
        [value, { width: 3, signed: false }],
        [right, { width: 3, signed: false }],
      ]),
    );
    if (relation_first) {
      domain = assume_machine_difference(domain, value, right, -1n);
    }
    domain = assume_machine_fact(domain, {
      tag: "equal",
      value,
      expected: 0n,
    });
    domain = assume_machine_fact(domain, {
      tag: "equal",
      value: right,
      expected: 0n,
    });
    if (!relation_first) {
      domain = assume_machine_difference(domain, value, right, -1n);
    }
    assert_equals(domain.reachable, false);
  }

  let bounded = machine_fact_domain(
    new Map([
      [value, { width: 3, signed: false }],
      [right, { width: 3, signed: false }],
    ]),
  );
  bounded = assume_machine_fact(bounded, {
    tag: "less_equal",
    value,
    bound: 2n,
  });
  bounded = assume_machine_fact(bounded, {
    tag: "greater_equal",
    value: right,
    bound: 3n,
  });
  assert_equals(
    implies_machine_difference(bounded, value, right, -1n),
    true,
  );
});

Deno.test("machine differences reduce against finite value domains", () => {
  const right = "difference:finite:right" as ValueId;
  for (const relation_first of [false, true]) {
    let bitmask = machine_fact_domain(
      new Map([
        [value, { width: 3, signed: false }],
        [right, { width: 3, signed: false }],
      ]),
    );
    if (relation_first) {
      bitmask = assume_machine_difference(bitmask, value, right, -1n);
    }
    bitmask = assume_machine_bitmask(bitmask, value, 0b111n, 0n);
    bitmask = assume_machine_bitmask(bitmask, right, 0b111n, 0n);
    if (!relation_first) {
      bitmask = assume_machine_difference(bitmask, value, right, -1n);
    }
    assert_equals(bitmask.reachable, false);

    let congruence = machine_fact_domain(
      new Map([
        [value, { width: 3, signed: false }],
        [right, { width: 3, signed: false }],
      ]),
    );
    if (relation_first) {
      congruence = assume_machine_difference(
        congruence,
        value,
        right,
        -1n,
      );
    }
    congruence = assume_machine_congruence(
      congruence,
      value,
      8n,
      0n,
    );
    congruence = assume_machine_congruence(
      congruence,
      right,
      8n,
      0n,
    );
    if (!relation_first) {
      congruence = assume_machine_difference(
        congruence,
        value,
        right,
        -1n,
      );
    }
    assert_equals(congruence.reachable, false);

    let exclusion = machine_fact_domain(
      new Map([
        [value, { width: 3, signed: false }],
        [right, { width: 3, signed: false }],
      ]),
    );
    if (relation_first) {
      exclusion = assume_machine_difference(
        exclusion,
        value,
        right,
        -7n,
      );
    }
    exclusion = exclude_machine_fact(exclusion, {
      tag: "equal",
      value,
      expected: 0n,
    });
    if (!relation_first) {
      exclusion = assume_machine_difference(
        exclusion,
        value,
        right,
        -7n,
      );
    }
    assert_equals(exclusion.reachable, false);
  }
});

Deno.test("nonconvex value domains discard affine precision", () => {
  const right = "difference:nonconvex:right" as ValueId;
  for (const finite_domain of ["bitmask", "congruence"]) {
    for (const relation_first of [false, true]) {
      let domain = machine_fact_domain(
        new Map([
          [value, { width: 3, signed: false }],
          [right, { width: 3, signed: false }],
        ]),
      );
      if (relation_first) {
        domain = assume_machine_difference(domain, value, right, 1n);
        domain = assume_machine_difference(domain, right, value, -1n);
      }
      if (finite_domain === "bitmask") {
        domain = assume_machine_bitmask(domain, value, 0b001n, 0n);
        domain = assume_machine_bitmask(domain, right, 0b001n, 0n);
      } else {
        domain = assume_machine_congruence(domain, value, 2n, 0n);
        domain = assume_machine_congruence(domain, right, 2n, 0n);
      }
      if (!relation_first) {
        domain = assume_machine_difference(domain, value, right, 1n);
        domain = assume_machine_difference(domain, right, value, -1n);
      }
      assert_equals(domain.reachable, true);
      assert_equals(
        implies_machine_difference(domain, value, right, 1n),
        false,
      );
      assert_equals(
        implies_machine_difference(domain, right, value, -1n),
        false,
      );
    }
  }
  for (const relation_first of [false, true]) {
    let domain = machine_fact_domain(
      new Map([
        [value, { width: 3, signed: false }],
        [right, { width: 3, signed: false }],
      ]),
    );
    if (relation_first) {
      domain = assume_machine_difference(domain, value, right, 0n);
    }
    domain = exclude_machine_fact(domain, {
      tag: "equal",
      value,
      expected: 3n,
    });
    if (!relation_first) {
      domain = assume_machine_difference(domain, value, right, 0n);
    }
    assert_equals(domain.reachable, true);
    assert_equals(
      implies_machine_difference(domain, value, right, 0n),
      false,
    );
  }
});

Deno.test("nonconvex values discard only their relational assumptions", () => {
  const middle = "difference:nonconvex-order:middle" as ValueId;
  const upper = "difference:nonconvex-order:upper" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: false }],
    [middle, { width: 3, signed: false }],
    [upper, { width: 3, signed: false }],
  ]);
  let relation_first = machine_fact_domain(ranges);
  relation_first = assume_machine_difference(
    relation_first,
    value,
    middle,
    0n,
  );
  relation_first = assume_machine_difference(
    relation_first,
    middle,
    upper,
    0n,
  );
  relation_first = assume_machine_bitmask(
    relation_first,
    value,
    0b001n,
    0n,
  );

  let nonconvex_first = machine_fact_domain(ranges);
  nonconvex_first = assume_machine_bitmask(
    nonconvex_first,
    value,
    0b001n,
    0n,
  );
  nonconvex_first = assume_machine_difference(
    nonconvex_first,
    value,
    middle,
    0n,
  );
  nonconvex_first = assume_machine_difference(
    nonconvex_first,
    middle,
    upper,
    0n,
  );

  assert_equals(
    machine_differences(relation_first),
    machine_differences(nonconvex_first),
  );
  assert_equals(
    implies_machine_difference(relation_first, middle, upper, 0n),
    true,
  );
  assert_equals(
    implies_machine_difference(relation_first, value, upper, 0n),
    false,
  );
});

Deno.test("machine difference joins retain the weakest shared bound", () => {
  const right = "difference:join:right" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: false }],
    [right, { width: 3, signed: false }],
  ]);
  const strict = assume_machine_difference(
    machine_fact_domain(ranges),
    value,
    right,
    -1n,
  );
  const weak = assume_machine_difference(
    machine_fact_domain(ranges),
    value,
    right,
    0n,
  );
  const joined = join_machine_domains(strict, weak);
  assert_equals(
    implies_machine_difference(joined, value, right, 0n),
    true,
  );
  assert_equals(
    implies_machine_difference(joined, value, right, -1n),
    false,
  );
  const dropped = join_machine_domains(
    strict,
    machine_fact_domain(ranges),
  );
  assert_equals(
    implies_machine_difference(dropped, value, right, 0n),
    false,
  );
});

Deno.test("machine difference joins preserve direct-edge provenance", () => {
  const input = "difference:join-provenance:input" as ValueId;
  const offset = "difference:join-provenance:offset" as ValueId;
  const middle = "difference:join-provenance:middle" as ValueId;
  const upper = "difference:join-provenance:upper" as ValueId;
  let domain = machine_fact_domain(
    new Map([
      [input, { width: 3, signed: true }],
      [offset, { width: 3, signed: true }],
      [value, { width: 3, signed: true }],
      [middle, { width: 3, signed: true }],
      [upper, { width: 3, signed: true }],
    ]),
  );
  domain = assume_machine_difference(domain, value, middle, 0n);
  domain = assume_machine_difference(domain, middle, upper, 0n);
  domain = join_machine_domains(domain, domain);
  assert_equals(
    implies_machine_difference(domain, value, upper, 0n),
    true,
  );
  domain = assume_machine_fact(domain, {
    tag: "equal",
    value: input,
    expected: 1n,
  });
  domain = assume_machine_fact(domain, {
    tag: "equal",
    value: offset,
    expected: 1n,
  });
  domain = transfer_machine_offset(
    domain,
    "add",
    input,
    offset,
    middle,
  );
  assert_equals(
    implies_machine_difference(domain, value, upper, 0n),
    false,
  );
});

Deno.test("machine difference joins discard nonconvex endpoints", () => {
  const right = "difference:join-nonconvex:right" as ValueId;
  const ranges = new Map([
    [value, { width: 3, signed: false }],
    [right, { width: 3, signed: false }],
  ]);
  const points: readonly (readonly [bigint, bigint])[] = [
    [1n, 0n],
    [2n, 1n],
    [5n, 4n],
  ];
  const paths = points.map(([left_value, right_value]) => {
    let domain = machine_fact_domain(ranges);
    domain = assume_machine_fact(domain, {
      tag: "equal",
      value,
      expected: left_value,
    });
    domain = assume_machine_fact(domain, {
      tag: "equal",
      value: right,
      expected: right_value,
    });
    domain = assume_machine_difference(domain, value, right, 1n);
    domain = assume_machine_difference(domain, right, value, -1n);
    return domain;
  });
  const first = paths[0];
  const second = paths[1];
  const third = paths[2];
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("Missing machine difference join path.");
  }
  let joined = join_machine_domains(first, second);
  joined = join_machine_domains(joined, third);
  assert_equals(
    implies_machine_difference(joined, value, right, 1n),
    false,
  );
  joined = assume_machine_fact(joined, {
    tag: "equal",
    value,
    expected: 3n,
  });
  assert_equals(joined.reachable, true);
  assert_equals(
    implies_machine_difference(joined, right, value, -1n),
    false,
  );
});

Deno.test("machine differences honor the structural term budget", () => {
  const values = Array.from(
    { length: 65 },
    (_, index) => `difference:budget:${index}` as ValueId,
  );
  let domain = machine_fact_domain(
    new Map(values.map((term) => [term, { width: 3, signed: false }])),
  );
  for (let index = 1; index < 64; index += 1) {
    const left = values[index - 1];
    const right = values[index];
    if (left === undefined || right === undefined) {
      throw new Error(`Missing difference budget term ${index}.`);
    }
    domain = assume_machine_difference(domain, left, right, 0n);
  }
  const previous = domain;
  const final_left = values[63];
  const final_right = values[64];
  if (final_left === undefined || final_right === undefined) {
    throw new Error("Missing final difference budget terms.");
  }
  domain = assume_machine_difference(domain, final_left, final_right, 0n);
  assert_equals(domain === previous, true);
  assert_equals(
    implies_machine_difference(domain, final_left, final_right, 0n),
    false,
  );
});

Deno.test("machine relation kinds share one structural term budget", () => {
  const values = Array.from(
    { length: 66 },
    (_, index) => `relation-budget:${index}` as ValueId,
  );
  const ranges = new Map(
    values.map((candidate) => [
      candidate,
      { width: 3, signed: false },
    ]),
  );
  const anchor = values[0];
  if (anchor === undefined) throw new Error("Expected relation anchor.");
  let disequalities = machine_fact_domain(ranges);
  for (let index = 1; index < 64; index += 1) {
    const candidate = values[index];
    if (candidate === undefined) {
      throw new Error(`Expected relation budget value ${index}.`);
    }
    disequalities = assume_machine_disequality(
      disequalities,
      anchor,
      candidate,
    );
  }
  const difference_left = values[64];
  const difference_right = values[65];
  if (difference_left === undefined || difference_right === undefined) {
    throw new Error("Expected difference budget endpoints.");
  }
  const rejected_difference = assume_machine_difference(
    disequalities,
    difference_left,
    difference_right,
    0n,
  );
  assert_equals(
    implies_machine_difference(
      rejected_difference,
      difference_left,
      difference_right,
      0n,
    ),
    false,
  );

  let differences = machine_fact_domain(ranges);
  for (let index = 1; index < 64; index += 1) {
    const previous = values[index - 1];
    const candidate = values[index];
    if (previous === undefined || candidate === undefined) {
      throw new Error(`Expected affine budget value ${index}.`);
    }
    differences = assume_machine_difference(
      differences,
      previous,
      candidate,
      0n,
    );
  }
  const rejected_disequality = assume_machine_disequality(
    differences,
    difference_left,
    difference_right,
  );
  assert_equals(machine_disequalities(rejected_disequality), []);
});

Deno.test("machine difference snapshots do not expose mutable rows", () => {
  const right = "difference:immutable:right" as ValueId;
  const domain = assume_machine_difference(
    machine_fact_domain(
      new Map([
        [value, { width: 3, signed: true }],
        [right, { width: 3, signed: true }],
      ]),
    ),
    value,
    right,
    0n,
  );
  domain.differences.forEach((bounds) => {
    assert_throws(
      () => (bounds as Map<ValueId, bigint>).set(right, -7n),
      "set is not a function",
    );
  });
  domain.difference_assumptions.forEach((bounds) => {
    assert_throws(
      () => (bounds as Map<ValueId, bigint>).set(right, -7n),
      "set is not a function",
    );
  });
  assert_equals(
    implies_machine_difference(domain, value, right, 0n),
    true,
  );
});

Deno.test("machine transfers discard relations for rebuilt values", () => {
  const input = "difference:transfer:input" as ValueId;
  const offset = "difference:transfer:offset" as ValueId;
  const result = "difference:transfer:result" as ValueId;
  const right = "difference:transfer:right" as ValueId;
  let domain = machine_fact_domain(
    new Map([
      [input, { width: 3, signed: true }],
      [offset, { width: 3, signed: true }],
      [result, { width: 3, signed: true }],
      [right, { width: 3, signed: true }],
    ]),
  );
  domain = assume_machine_difference(domain, result, right, 0n);
  domain = assume_machine_fact(domain, {
    tag: "equal",
    value: input,
    expected: 1n,
  });
  domain = assume_machine_fact(domain, {
    tag: "equal",
    value: offset,
    expected: 1n,
  });
  domain = transfer_machine_offset(
    domain,
    "add",
    input,
    offset,
    result,
  );
  assert_equals(
    implies_machine_difference(domain, result, right, 0n),
    false,
  );
});

Deno.test("machine difference closure is exhaustive for three-bit integers", () => {
  const middle = "difference:exhaustive:middle" as ValueId;
  const upper = "difference:exhaustive:upper" as ValueId;
  for (const signed of [false, true]) {
    const range = { width: 3, signed };
    const bounds = machine_range(range);
    for (
      let first_maximum = -8n;
      first_maximum <= 6n;
      first_maximum += 1n
    ) {
      for (
        let second_maximum = -8n;
        second_maximum <= 6n;
        second_maximum += 1n
      ) {
        let domain = machine_fact_domain(
          new Map([
            [value, range],
            [middle, range],
            [upper, range],
          ]),
        );
        domain = assume_machine_difference(
          domain,
          value,
          middle,
          first_maximum,
        );
        domain = assume_machine_difference(
          domain,
          middle,
          upper,
          second_maximum,
        );
        if (!domain.reachable) continue;
        const implied = first_maximum + second_maximum;
        assert_equals(
          implies_machine_difference(
            domain,
            value,
            upper,
            implied,
          ),
          true,
        );
        for (
          let left_value = bounds.minimum;
          left_value <= bounds.maximum;
          left_value += 1n
        ) {
          for (
            let middle_value = bounds.minimum;
            middle_value <= bounds.maximum;
            middle_value += 1n
          ) {
            if (left_value - middle_value > first_maximum) continue;
            for (
              let upper_value = bounds.minimum;
              upper_value <= bounds.maximum;
              upper_value += 1n
            ) {
              if (middle_value - upper_value > second_maximum) continue;
              assert_equals(left_value - upper_value <= implied, true);
            }
          }
        }
      }
    }
  }
});

Deno.test("machine bitmasks reduce scalar facts in either assumption order", () => {
  for (const bitmask_first of [false, true]) {
    let domain = machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    );
    if (bitmask_first) {
      domain = assume_machine_bitmask(domain, value, 0b100n, 0b001n);
    }
    domain = assume_machine_fact(domain, {
      tag: "greater_equal",
      value,
      bound: 4n,
    });
    if (!bitmask_first) {
      domain = assume_machine_bitmask(domain, value, 0b100n, 0b001n);
    }
    assert_equals(domain.reachable, false);
  }

  let singleton = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  singleton = assume_machine_bitmask(singleton, value, 0b100n, 0b001n);
  singleton = assume_machine_fact(singleton, {
    tag: "less_equal",
    value,
    bound: 1n,
  });
  assert_equals(
    implies_machine_fact(singleton, {
      tag: "equal",
      value,
      expected: 1n,
    }),
    true,
  );
  assert_equals(
    implies_machine_bitmask(singleton, value, 0b110n, 0b001n),
    true,
  );
  assert_equals(machine_excludes_equal(singleton, value, 3n), true);

  let power_of_two = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  power_of_two = assume_machine_bitmask(
    power_of_two,
    value,
    0b001n,
    0b010n,
  );
  assert_equals(
    implies_machine_congruence(power_of_two, value, 4n, 2n),
    true,
  );
  assert_equals(
    implies_machine_congruence(power_of_two, value, 8n, 2n),
    false,
  );
  const fully_known = assume_machine_bitmask(
    machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    ),
    value,
    0b110n,
    0b001n,
  );
  assert_equals(
    implies_machine_congruence(fully_known, value, 9n, 1n),
    true,
  );

  const contradictory = assume_machine_bitmask(
    machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    ),
    value,
    0b001n,
    0b001n,
  );
  assert_equals(contradictory.reachable, false);
  for (const bitmask_first of [false, true]) {
    let parity_conflict = machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    );
    if (bitmask_first) {
      parity_conflict = assume_machine_bitmask(
        parity_conflict,
        value,
        0b001n,
        0n,
      );
    }
    parity_conflict = assume_machine_congruence(
      parity_conflict,
      value,
      2n,
      1n,
    );
    if (!bitmask_first) {
      parity_conflict = assume_machine_bitmask(
        parity_conflict,
        value,
        0b001n,
        0n,
      );
    }
    assert_equals(parity_conflict.reachable, false);

    let singleton_conflict = machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    );
    if (bitmask_first) {
      singleton_conflict = assume_machine_bitmask(
        singleton_conflict,
        value,
        0n,
        0b100n,
      );
    }
    singleton_conflict = assume_machine_congruence(
      singleton_conflict,
      value,
      8n,
      3n,
    );
    if (!bitmask_first) {
      singleton_conflict = assume_machine_bitmask(
        singleton_conflict,
        value,
        0n,
        0b100n,
      );
    }
    assert_equals(singleton_conflict.reachable, false);

    let non_power_conflict = machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    );
    if (bitmask_first) {
      non_power_conflict = assume_machine_bitmask(
        non_power_conflict,
        value,
        0b011n,
        0n,
      );
    }
    non_power_conflict = assume_machine_congruence(
      non_power_conflict,
      value,
      3n,
      2n,
    );
    if (!bitmask_first) {
      non_power_conflict = assume_machine_bitmask(
        non_power_conflict,
        value,
        0b011n,
        0n,
      );
    }
    assert_equals(non_power_conflict.reachable, false);
  }
  assert_throws(
    () =>
      assume_machine_bitmask(
        machine_fact_domain(
          new Map([[value, { width: 3, signed: false }]]),
        ),
        value,
        0b1000n,
        0n,
      ),
    "Machine bitmask 8/0 exceeds U3.",
  );
});

Deno.test("machine bitmask reduction accounts for finite exclusions", () => {
  for (const exclusion_first of [false, true]) {
    let domain = machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    );
    if (exclusion_first) {
      domain = exclude_machine_fact(domain, {
        tag: "equal",
        value,
        expected: 1n,
      });
      domain = exclude_machine_fact(domain, {
        tag: "equal",
        value,
        expected: 3n,
      });
    }
    domain = assume_machine_bitmask(domain, value, 0b100n, 0b001n);
    if (!exclusion_first) {
      domain = exclude_machine_fact(domain, {
        tag: "equal",
        value,
        expected: 1n,
      });
      domain = exclude_machine_fact(domain, {
        tag: "equal",
        value,
        expected: 3n,
      });
    }
    assert_equals(domain.reachable, false);
  }

  let reduced = machine_fact_domain(
    new Map([[value, { width: 3, signed: false }]]),
  );
  reduced = assume_machine_bitmask(reduced, value, 0b011n, 0n);
  reduced = assume_machine_congruence(reduced, value, 3n, 1n);
  assert_equals(reduced.reachable, true);
  const narrowed = assume_machine_fact(reduced, {
    tag: "less_equal",
    value,
    bound: 3n,
  });
  assert_equals(narrowed.reachable, false);
  const excluded = exclude_machine_fact(reduced, {
    tag: "equal",
    value,
    expected: 4n,
  });
  assert_equals(excluded.reachable, false);
});

Deno.test("machine bitmask assumptions are exhaustive for three-bit integers", () => {
  for (const signed of [false, true]) {
    const range = machine_range({ width: 3, signed });
    for (let known_zero = 0n; known_zero <= 0b111n; known_zero += 1n) {
      for (let known_one = 0n; known_one <= 0b111n; known_one += 1n) {
        const domain = assume_machine_bitmask(
          machine_fact_domain(
            new Map([[value, { width: 3, signed }]]),
          ),
          value,
          known_zero,
          known_one,
        );
        const compatible = (known_zero & known_one) === 0n;
        assert_equals(domain.reachable, compatible);
        if (!compatible) continue;
        assert_equals(
          implies_machine_bitmask(
            domain,
            value,
            known_zero,
            known_one,
          ),
          true,
        );
        for (
          let concrete = range.minimum;
          concrete <= range.maximum;
          concrete += 1n
        ) {
          let bits = concrete;
          if (bits < 0n) bits += 8n;
          const matches = (bits & known_zero) === 0n &&
            (bits & known_one) === known_one;
          assert_equals(
            machine_excludes_equal(domain, value, concrete),
            !matches,
          );
        }
      }
    }
  }
});

Deno.test("machine bitmask joins retain exactly the path-independent bits", () => {
  for (const signed of [false, true]) {
    const range = machine_range({ width: 3, signed });
    const cases: ReturnType<typeof machine_fact_domain>[] = [];
    for (let known_zero = 0n; known_zero <= 0b111n; known_zero += 1n) {
      for (let known_one = 0n; known_one <= 0b111n; known_one += 1n) {
        if ((known_zero & known_one) !== 0n) continue;
        cases.push(
          assume_machine_bitmask(
            machine_fact_domain(
              new Map([[value, { width: 3, signed }]]),
            ),
            value,
            known_zero,
            known_one,
          ),
        );
      }
    }
    for (const left of cases) {
      for (const right of cases) {
        const joined = join_machine_domains(left, right);
        const reversed = join_machine_domains(right, left);
        assert_equals(
          machine_bitmask(joined, value),
          machine_bitmask(reversed, value),
        );
        const joined_mask = machine_bitmask(joined, value);
        const left_mask = machine_bitmask(left, value);
        const right_mask = machine_bitmask(right, value);
        for (
          let concrete = range.minimum;
          concrete <= range.maximum;
          concrete += 1n
        ) {
          let bits = concrete;
          if (bits < 0n) bits += 8n;
          const belongs_to_left = (bits & left_mask.known_zero) === 0n &&
            (bits & left_mask.known_one) === left_mask.known_one;
          const belongs_to_right = (bits & right_mask.known_zero) === 0n &&
            (bits & right_mask.known_one) === right_mask.known_one;
          if (!belongs_to_left && !belongs_to_right) continue;
          assert_equals((bits & joined_mask.known_zero) === 0n, true);
          assert_equals(
            (bits & joined_mask.known_one) === joined_mask.known_one,
            true,
          );
        }
      }
    }
  }
});

Deno.test("machine bitwise transfer preserves known zero and one bits", () => {
  const left = "bitmask-left" as ValueId;
  const right = "bitmask-right" as ValueId;
  const result = "bitmask-result" as ValueId;
  const ranges = new Map([
    [left, { width: 3, signed: false }],
    [right, { width: 3, signed: false }],
    [result, { width: 3, signed: false }],
  ]);
  let domain = machine_fact_domain(ranges);
  domain = assume_machine_bitmask(domain, left, 0b100n, 0b001n);
  domain = assume_machine_bitmask(domain, right, 0b010n, 0b100n);
  assert_equals(
    machine_bitmask(
      transfer_machine_bitwise(domain, "and", left, right, result),
      result,
    ),
    { known_zero: 0b110n, known_one: 0n },
  );
  assert_equals(
    machine_bitmask(
      transfer_machine_bitwise(domain, "or", left, right, result),
      result,
    ),
    { known_zero: 0n, known_one: 0b101n },
  );
  assert_equals(
    machine_bitmask(
      transfer_machine_bitwise(domain, "xor", left, right, result),
      result,
    ),
    { known_zero: 0n, known_one: 0b100n },
  );
});

Deno.test("machine bitwise transfer is exhaustive for three-bit integers", () => {
  const left = "bitmask-exhaustive-left" as ValueId;
  const right = "bitmask-exhaustive-right" as ValueId;
  const result = "bitmask-exhaustive-result" as ValueId;
  for (const signed of [false, true]) {
    const type = { width: 3 as const, signed };
    const range = machine_range(type);
    const ranges = new Map([
      [left, type],
      [right, type],
      [result, type],
    ]);
    for (
      let left_value = range.minimum;
      left_value <= range.maximum;
      left_value += 1n
    ) {
      for (
        let right_value = range.minimum;
        right_value <= range.maximum;
        right_value += 1n
      ) {
        let domain = machine_fact_domain(ranges);
        domain = assume_machine_fact(domain, {
          tag: "equal",
          value: left,
          expected: left_value,
        });
        domain = assume_machine_fact(domain, {
          tag: "equal",
          value: right,
          expected: right_value,
        });
        for (const operation of ["and", "or", "xor"] as const) {
          let concrete = left_value & right_value;
          if (operation === "or") concrete = left_value | right_value;
          if (operation === "xor") concrete = left_value ^ right_value;
          concrete = normalize_machine_integer(concrete, type);
          const transferred = transfer_machine_bitwise(
            domain,
            operation,
            left,
            right,
            result,
          );
          assert_equals(
            implies_machine_fact(transferred, {
              tag: "equal",
              value: result,
              expected: concrete,
            }),
            true,
          );
        }
      }
    }
  }
});

Deno.test("machine bitmask snapshots are immutable", () => {
  const domain = assume_machine_bitmask(
    machine_fact_domain(
      new Map([[value, { width: 3, signed: false }]]),
    ),
    value,
    0b100n,
    0b001n,
  );
  assert_equals(Object.isFrozen(machine_bitmask(domain, value)), true);
  domain.bitmasks.forEach((_bitmask, key, map) => {
    assert_equals(key, value);
    assert_throws(
      () =>
        (map as Map<ValueId, { known_zero: bigint; known_one: bigint }>).set(
          value,
          { known_zero: 0n, known_one: 0n },
        ),
      "set is not a function",
    );
  });
});

Deno.test("machine offset transfer retains only non-wrapping intervals", () => {
  const input = "offset-input" as ValueId;
  const offset = "offset-constant" as ValueId;
  const result = "offset-result" as ValueId;
  const ranges = new Map([
    [input, { width: 3, signed: true }],
    [offset, { width: 3, signed: true }],
    [result, { width: 3, signed: true }],
  ]);
  let domain = machine_fact_domain(ranges);
  domain = assume_machine_fact(domain, {
    tag: "greater_equal",
    value: input,
    bound: -2n,
  });
  domain = assume_machine_fact(domain, {
    tag: "less_equal",
    value: input,
    bound: 1n,
  });
  domain = assume_machine_fact(domain, {
    tag: "equal",
    value: offset,
    expected: 2n,
  });
  const added = transfer_machine_offset(
    domain,
    "add",
    input,
    offset,
    result,
  );
  assert_equals(added.facts.get(result), {
    tag: "interval",
    minimum: 0n,
    maximum: 3n,
  });
  const subtracted = transfer_machine_offset(
    domain,
    "subtract",
    input,
    offset,
    result,
  );
  assert_equals(subtracted.facts.get(result), {
    tag: "interval",
    minimum: -4n,
    maximum: -1n,
  });

  const overflowing = assume_machine_fact(domain, {
    tag: "greater_equal",
    value: input,
    bound: 2n,
  });
  assert_equals(
    transfer_machine_offset(
      overflowing,
      "add",
      input,
      offset,
      result,
    ).facts.has(result),
    false,
  );
  assert_equals(
    transfer_machine_offset(
      machine_fact_domain(ranges),
      "add",
      input,
      offset,
      result,
    ).facts.has(result),
    false,
  );
});

Deno.test("machine offset transfer is exhaustive for three-bit intervals", () => {
  const input = "exhaustive-offset-input" as ValueId;
  const offset = "exhaustive-offset-constant" as ValueId;
  const result = "exhaustive-offset-result" as ValueId;
  for (const signed of [false, true]) {
    const type = { width: 3 as const, signed };
    const range = machine_range(type);
    for (
      let minimum = range.minimum;
      minimum <= range.maximum;
      minimum += 1n
    ) {
      for (
        let maximum = minimum;
        maximum <= range.maximum;
        maximum += 1n
      ) {
        for (
          let constant = range.minimum;
          constant <= range.maximum;
          constant += 1n
        ) {
          for (const operation of ["add", "subtract"] as const) {
            const ranges = new Map([
              [input, type],
              [offset, type],
              [result, type],
            ]);
            let domain = machine_fact_domain(ranges);
            domain = assume_machine_fact(domain, {
              tag: "greater_equal",
              value: input,
              bound: minimum,
            });
            domain = assume_machine_fact(domain, {
              tag: "less_equal",
              value: input,
              bound: maximum,
            });
            domain = assume_machine_fact(domain, {
              tag: "equal",
              value: offset,
              expected: constant,
            });
            const transferred = transfer_machine_offset(
              domain,
              operation,
              input,
              offset,
              result,
            );
            const fact = transferred.facts.get(result);
            let raw_minimum = minimum + constant;
            let raw_maximum = maximum + constant;
            if (operation === "subtract") {
              raw_minimum = minimum - constant;
              raw_maximum = maximum - constant;
            }
            const wraps = raw_minimum < range.minimum ||
              raw_maximum > range.maximum;
            assert_equals(fact === undefined, wraps);
            if (fact === undefined) continue;
            if (fact.tag !== "exact" && fact.tag !== "interval") {
              throw new Error("Expected a retained offset interval.");
            }
            let fact_minimum: bigint;
            let fact_maximum: bigint;
            if (fact.tag === "exact") {
              fact_minimum = fact.value;
              fact_maximum = fact.value;
            } else {
              fact_minimum = fact.minimum;
              fact_maximum = fact.maximum;
            }
            for (
              let concrete = minimum;
              concrete <= maximum;
              concrete += 1n
            ) {
              let raw_result = concrete + constant;
              if (operation === "subtract") {
                raw_result = concrete - constant;
              }
              const runtime_result = normalize_machine_integer(
                raw_result,
                type,
              );
              assert_equals(
                runtime_result >= fact_minimum &&
                  runtime_result <= fact_maximum,
                true,
              );
            }
          }
        }
      }
    }
  }
});

Deno.test("machine fact domains honor signed extrema", () => {
  const domain = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  const lower = assume_machine_fact(domain, {
    tag: "greater_equal",
    value,
    bound: -4n,
  });
  assert_equals(
    implies_machine_fact(lower, { tag: "greater_equal", value, bound: -4n }),
    true,
  );
  const impossible = assume_machine_fact(lower, {
    tag: "less_than",
    value,
    bound: -4n,
  });
  assert_equals(impossible.reachable, false);
  assert_equals(impossible.facts.get(value), { tag: "bottom" });
  assert_equals(
    implies_machine_fact(impossible, {
      tag: "equal",
      value,
      expected: -4n,
    }),
    false,
  );
});

Deno.test("machine false branches preserve complementary bounds", () => {
  const domain = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  const false_branch = exclude_machine_fact(domain, {
    tag: "less_than",
    value,
    bound: 0n,
  });
  assert_equals(
    implies_machine_fact(false_branch, {
      tag: "greater_equal",
      value,
      bound: 0n,
    }),
    true,
  );
});

Deno.test("machine false equality branches retain finite exclusions", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  domain = exclude_machine_fact(domain, { tag: "equal", value, expected: 1n });
  assert_equals(domain.reachable, true);
  assert_equals(domain.exclusions.get(value), [1n]);
  domain = assume_machine_fact(domain, { tag: "equal", value, expected: 1n });
  assert_equals(domain.reachable, false);
});

Deno.test("machine equality exclusions imply disequality", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  domain = exclude_machine_fact(domain, { tag: "equal", value, expected: 1n });
  assert_equals(machine_excludes_equal(domain, value, 1n), true);
  assert_equals(machine_excludes_equal(domain, value, 2n), false);

  domain = assume_machine_fact(domain, {
    tag: "greater_equal",
    value,
    bound: 2n,
  });
  assert_equals(machine_excludes_equal(domain, value, -1n), true);
  assert_equals(machine_excludes_equal(domain, value, 3n), false);
});

Deno.test("machine implications use exclusions to recover a singleton", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 2, signed: false }]]),
  );
  domain = assume_machine_fact(domain, {
    tag: "less_equal",
    value,
    bound: 1n,
  });
  domain = exclude_machine_fact(domain, { tag: "equal", value, expected: 1n });
  assert_equals(
    implies_machine_fact(domain, { tag: "equal", value, expected: 0n }),
    true,
  );
  assert_equals(
    implies_machine_fact(domain, { tag: "equal", value, expected: 1n }),
    false,
  );
});

Deno.test("machine assumptions cannot reconstruct an excluded singleton", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  domain = exclude_machine_fact(domain, { tag: "equal", value, expected: 1n });
  domain = assume_machine_fact(domain, {
    tag: "greater_equal",
    value,
    bound: 1n,
  });
  domain = assume_machine_fact(domain, { tag: "less_equal", value, bound: 1n });
  assert_equals(domain.reachable, false);
});

Deno.test("machine exclusions detect an exhausted small range", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 2, signed: false }]]),
  );
  for (const expected of [0n, 1n, 2n, 3n]) {
    domain = exclude_machine_fact(domain, { tag: "equal", value, expected });
  }
  assert_equals(domain.reachable, false);
});

Deno.test("machine exclusions detect an exhausted narrowed interval", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 5, signed: false }]]),
  );
  domain = assume_machine_fact(domain, {
    tag: "less_equal",
    value,
    bound: 15n,
  });
  for (let expected = 0n; expected <= 15n; expected += 1n) {
    domain = exclude_machine_fact(domain, { tag: "equal", value, expected });
  }
  assert_equals(domain.reachable, false);
});

Deno.test("machine joins retain only path-independent facts and exclusions", () => {
  const ranges = new Map([[value, { width: 3, signed: true }]]);
  const left = assume_machine_fact(
    exclude_machine_fact(machine_fact_domain(ranges), {
      tag: "equal",
      value,
      expected: 1n,
    }),
    { tag: "greater_equal", value, bound: 0n },
  );
  const right = assume_machine_fact(
    exclude_machine_fact(machine_fact_domain(ranges), {
      tag: "equal",
      value,
      expected: 1n,
    }),
    { tag: "less_equal", value, bound: 2n },
  );
  const joined = join_machine_domains(left, right);
  assert_equals(joined.reachable, true);
  assert_equals(joined.exclusions.get(value), [1n]);
  assert_equals(
    implies_machine_fact(joined, { tag: "greater_equal", value, bound: -4n }),
    true,
  );
  assert_equals(
    machine_fact_evidence(joined, value).length,
    0,
  );
});

Deno.test("machine widening stays inside the declared range", () => {
  assert_equals(
    widen_machine_facts(
      { tag: "exact", value: -4n },
      { tag: "exact", value: 3n },
      { width: 3, signed: true },
    ),
    { tag: "interval", minimum: -4n, maximum: 3n },
  );
});

Deno.test("machine widening preserves unsigned and signed 128-bit extrema", () => {
  const unsigned_max = (1n << 128n) - 1n;
  assert_equals(
    widen_machine_facts(
      { tag: "exact", value: unsigned_max - 1n },
      { tag: "exact", value: unsigned_max },
      { width: 128, signed: false },
    ),
    { tag: "interval", minimum: unsigned_max - 1n, maximum: unsigned_max },
  );
  const signed_min = -(1n << 127n);
  assert_equals(
    widen_machine_facts(
      { tag: "exact", value: signed_min + 1n },
      { tag: "exact", value: signed_min },
      { width: 128, signed: true },
    ),
    { tag: "interval", minimum: signed_min, maximum: signed_min + 1n },
  );
});

Deno.test("machine fact domains retain immutable provenance", () => {
  const domain = assume_machine_fact(
    machine_fact_domain(new Map([[value, { width: 3, signed: true }]])),
    { tag: "equal", value, expected: 2n },
  );
  const evidence = machine_fact_evidence(domain, value);
  assert_equals(evidence.length, 1);
  assert_equals(evidence[0]?.proposition, {
    tag: "equal",
    value,
    expected: 2n,
  });
  assert_equals(evidence[0]?.fact, { tag: "exact", value: 2n });
  assert_equals(Object.isFrozen(evidence), true);
  assert_equals(Object.isFrozen(domain), true);
  assert_equals(Object.isFrozen(domain.facts.get(value)), true);
});

Deno.test("machine evidence records each asserted bound independently", () => {
  let domain = machine_fact_domain(
    new Map([[value, { width: 3, signed: true }]]),
  );
  domain = assume_machine_fact(domain, {
    tag: "greater_equal",
    value,
    bound: -2n,
  });
  domain = assume_machine_fact(domain, {
    tag: "less_equal",
    value,
    bound: 2n,
  });
  const evidence = machine_fact_evidence(domain, value);
  assert_equals(evidence[1]?.fact, {
    tag: "interval",
    minimum: -4n,
    maximum: 2n,
  });
});

Deno.test("machine fact maps do not expose mutable backing maps", () => {
  const domain = assume_machine_fact(
    machine_fact_domain(new Map([[value, { width: 3, signed: true }]])),
    { tag: "equal", value, expected: 1n },
  );
  domain.facts.forEach((_fact, key, map) => {
    assert_equals(key, value);
    assert_throws(
      () =>
        (map as Map<typeof value, ScalarFact>).set(value, {
          tag: "exact",
          value: 7n,
        }),
      "set is not a function",
    );
  });
  assert_equals(
    implies_machine_fact(domain, { tag: "equal", value, expected: 1n }),
    true,
  );
});

Deno.test("machine transitions reject forged structural domains", () => {
  const forged = {
    reachable: true,
    facts: new Map([[value, { tag: "exact", value: 2n }]]),
    ranges: new Map([[value, { width: 3, signed: true }]]),
    evidence: new Map(),
    exclusions: new Map(),
  } as never;
  assert_throws(
    () => assume_machine_fact(forged, { tag: "equal", value, expected: 2n }),
    "MachineFactDomain was not created by FactGraph.",
  );
  const offset = "forged-offset" as ValueId;
  const result = "forged-result" as ValueId;
  const domain = machine_fact_domain(
    new Map([
      [value, { width: 3, signed: true }],
      [offset, { width: 3, signed: true }],
      [result, { width: 3, signed: true }],
    ]),
  );
  assert_throws(
    () =>
      transfer_machine_offset(
        domain,
        "multiply" as never,
        value,
        offset,
        result,
      ),
    "Unknown machine offset operation multiply.",
  );
});

const MAX_INTEGER_FOR_TEST = (1n << 127n) - 1n;
