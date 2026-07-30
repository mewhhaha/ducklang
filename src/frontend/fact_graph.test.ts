import { assert_equals, assert_throws } from "../assert.ts";
import {
  assume_fact,
  assume_machine_congruence,
  assume_machine_fact,
  assume_state,
  establish_fact,
  exclude_fact,
  exclude_machine_fact,
  exclude_state,
  type FactEnvironment,
  implies_fact,
  implies_machine_congruence,
  implies_machine_fact,
  join_facts,
  join_machine_domains,
  join_states,
  machine_congruences,
  machine_excludes_equal,
  machine_fact_domain,
  machine_fact_evidence,
  machine_range,
  meet_facts,
  normalize_machine_integer,
  reachable_state,
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
