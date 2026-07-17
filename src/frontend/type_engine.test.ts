import { assert_equals, assert_throws } from "../assert.ts";
import {
  format_type,
  monomorphic_type_binding,
  type Type,
  type_key,
  type TypeEffect,
  TypeEngine,
} from "./type_engine.ts";

const int: Type = { tag: "scalar", name: "Int" };
const i32: Type = { tag: "scalar", name: "I32" };
const bool: Type = { tag: "scalar", name: "Bool" };
const text: Type = { tag: "scalar", name: "Text" };

function function_type(
  params: Type[],
  result: Type,
  effects: TypeEffect[] = [],
): Type {
  return { tag: "function", params, effects, result };
}

Deno.test("type engine rejects recursive inference variables", () => {
  const engine = new TypeEngine();
  const element = engine.fresh_variable("element");

  assert_throws(
    () => {
      engine.unify(
        element,
        { tag: "fixed_array", length: 4, element },
        "array literal",
      );
    },
    "array literal: occurs check failed",
  );
});

Deno.test("type schemes generalize any type outside the environment", () => {
  const engine = new TypeEngine();
  const environment_value = engine.fresh_variable("environment");
  const local_value = engine.fresh_variable("local");
  const pair: Type = {
    tag: "product",
    fields: [
      { label: undefined, type: environment_value },
      { label: undefined, type: local_value },
    ],
  };
  const scheme = engine.generalize(pair, [
    monomorphic_type_binding(environment_value),
  ]);

  assert_equals(scheme.quantified_variables, [1]);
  assert_equals(scheme.type, pair);
});

Deno.test("predicative instantiation preserves nested Rank-N positions", () => {
  const engine = new TypeEngine();
  const outer = engine.fresh_variable("outer");
  const inner = engine.fresh_variable("inner");

  if (outer.tag !== "variable" || inner.tag !== "variable") {
    throw new Error("Fresh type variables have invalid canonical tags");
  }

  const identity: Type = {
    tag: "forall",
    quantified_variables: [inner.id],
    body: function_type([inner], inner),
  };
  const higher_rank = function_type([identity, outer], identity);
  const scheme = engine.generalize(higher_rank, []);
  const instantiated = engine.instantiate(scheme);

  assert_equals(scheme.quantified_variables, [outer.id]);
  assert_equals(
    format_type(instantiated).includes("forall ?1"),
    true,
  );
  assert_equals(
    engine.alpha_equivalent(
      instantiated,
      function_type([identity, engine.fresh_variable("expected")], identity),
    ),
    false,
  );

  assert_throws(
    () => {
      engine.unify(
        engine.fresh_variable("impredicative"),
        identity,
        "Rank-N inference",
      );
    },
    "predicative inference cannot bind",
  );
});

Deno.test("forall types compare modulo binder renaming", () => {
  const first: Type = {
    tag: "forall",
    quantified_variables: [10],
    body: function_type(
      [{ tag: "variable", id: 10, hint: "value" }],
      { tag: "variable", id: 10, hint: "value" },
    ),
  };
  const second: Type = {
    tag: "forall",
    quantified_variables: [24],
    body: function_type(
      [{ tag: "variable", id: 24, hint: "element" }],
      { tag: "variable", id: 24, hint: "element" },
    ),
  };
  const engine = new TypeEngine();

  assert_equals(engine.alpha_equivalent(first, second), true);
  assert_equals(type_key(first), type_key(second));
});

Deno.test("skolemized variables cannot escape their check", () => {
  const engine = new TypeEngine();
  const quantified = engine.fresh_variable("quantified");

  if (quantified.tag !== "variable") {
    throw new Error("Fresh quantified type has an invalid canonical tag");
  }

  const skolem = engine.skolemize({
    quantified_variables: [quantified.id],
    type: quantified,
  });
  const inferred = engine.fresh_variable("result");
  engine.unify(inferred, skolem, "polymorphic result");

  assert_throws(
    () => engine.reject_skolem_escape(inferred, "polymorphic result"),
    "polymorphic result: rigid type escaped",
  );
});

Deno.test("function effects normalize as an ordered set", () => {
  const engine = new TypeEngine();
  const read: TypeEffect = { effect: "Io", operation: "read" };
  const write: TypeEffect = { effect: "Io", operation: "write" };
  const left = function_type([text], text, [write, read]);
  const right = function_type([text], text, [read, write]);

  engine.unify(left, right, "effect row");
  assert_equals(engine.alpha_equivalent(left, right), true);
});

Deno.test("ownership wrappers remain semantically distinct", () => {
  const engine = new TypeEngine();
  const borrowed: Type = {
    tag: "owned",
    ownership: "bounded_borrow",
    value: text,
  };
  const transferred: Type = {
    tag: "owned",
    ownership: "ownership_transfer",
    value: text,
  };

  assert_equals(engine.subtype(borrowed, transferred), false);
  assert_equals(engine.representation_compatible(borrowed, transferred), false);
});

Deno.test("aliases normalize before canonical unification", () => {
  const engine = new TypeEngine((type) => {
    if (type.name === "MachineInt") {
      return int;
    }

    return undefined;
  });

  engine.unify(
    { tag: "named", name: "MachineInt", args: [] },
    int,
    "alias",
  );
  assert_equals(
    engine.representation_compatible(
      { tag: "named", name: "MachineInt", args: [] },
      i32,
    ),
    true,
  );
});

Deno.test("representation checks align Bool with the i32 scalar family", () => {
  const engine = new TypeEngine();

  assert_equals(engine.representation_compatible(bool, int), true);
  assert_equals(engine.representation_compatible(bool, i32), true);
  assert_equals(engine.representation_compatible(bool, text), false);
  assert_equals(engine.subtype(i32, bool), false);
});

Deno.test("type sets normalize and participate in subtyping", () => {
  const engine = new TypeEngine();
  const repeated: Type = {
    tag: "union",
    members: [bool, int, bool, { tag: "never" }],
  };
  const normalized = engine.normalize(repeated);

  assert_equals(normalized, { tag: "union", members: [bool, int] });
  assert_equals(engine.subtype(bool, normalized), true);
  assert_equals(
    engine.normalize({
      tag: "difference",
      base: normalized,
      removed: bool,
    }),
    int,
  );
});

Deno.test("record subtyping preserves visible field requirements", () => {
  const engine = new TypeEngine();
  const visible: Type = {
    tag: "record",
    fields: [{ label: "name", type: text }],
  };
  const complete: Type = {
    tag: "record",
    fields: [
      { label: "age", type: int },
      { label: "name", type: text },
    ],
  };

  assert_equals(engine.subtype(complete, visible), true);
  assert_equals(engine.subtype(visible, complete), false);
});
