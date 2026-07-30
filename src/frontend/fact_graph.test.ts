import { assert_equals, assert_throws } from "../assert.ts";
import {
  assume_fact,
  assume_machine_fact,
  assume_state,
  establish_fact,
  exclude_fact,
  exclude_machine_fact,
  exclude_state,
  type FactEnvironment,
  implies_fact,
  implies_machine_fact,
  join_facts,
  join_machine_domains,
  join_states,
  machine_excludes_equal,
  machine_fact_domain,
  machine_fact_evidence,
  machine_range,
  meet_facts,
  normalize_machine_integer,
  reachable_state,
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
});

const MAX_INTEGER_FOR_TEST = (1n << 127n) - 1n;
