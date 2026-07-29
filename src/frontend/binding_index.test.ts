import { assert_equals } from "../assert.ts";
import { build_binding_index } from "./binding_index.ts";
import { parse_source_with_diagnostics } from "./parser.ts";

function occurrences(text: string) {
  return [
    ...build_binding_index(parse_source_with_diagnostics(text), 7).occurrences
      .values(),
  ];
}

Deno.test("binding index resolves an assignment rhs before its shadow", () => {
  const index = build_binding_index(
    parse_source_with_diagnostics("let x = 0;\nx = x + 1\n"),
    7,
  );
  const xs = [...index.occurrences.values()].filter((occurrence) =>
    occurrence.name === "x"
  );

  assert_equals(xs.map((occurrence) => occurrence.role), [
    "definition",
    "reference",
    "shadow",
  ]);
  assert_equals(xs[0]?.entity, xs[1]?.entity);
  if (xs[0]?.entity === undefined || xs[2]?.entity === undefined) {
    throw new Error("Expected assignment entities");
  }
  assert_equals(xs[0].entity === xs[2].entity, false);
  assert_equals(index.entities.get(xs[2].entity)?.replaces, xs[0].entity);
});

Deno.test("binding index gives an indexed rebuild a new generation", () => {
  const index = build_binding_index(parse_source_with_diagnostics(
    "let values = [1, 2];\nvalues[0] = values[1];\nvalues\n",
  ));
  const values = [...index.occurrences.values()].filter((occurrence) =>
    occurrence.name === "values"
  );

  assert_equals(values.map((occurrence) => occurrence.role), [
    "definition",
    "reference",
    "shadow",
    "reference",
  ]);
  const original = values[0]?.entity;
  const replacement = values[2]?.entity;
  if (original === undefined || replacement === undefined) {
    throw new Error("Expected indexed assignment entities");
  }
  assert_equals(values[1]?.entity, original);
  assert_equals(original === replacement, false);
  assert_equals(index.entities.get(replacement)?.replaces, original);
  const rhs = values[1];
  const after = values[3];
  if (rhs === undefined || after === undefined) {
    throw new Error("Expected indexed assignment references");
  }
  assert_equals(
    index.visible_at(rhs.span.start).find((entity) => entity.name === "values")
      ?.id,
    original,
  );
  assert_equals(
    index.visible_at(after.span.start).find((entity) =>
      entity.name === "values"
    )?.id,
    replacement,
  );
  assert_equals(index.facts.get(replacement)?.representation, {
    tag: "product",
    fields: [
      { label: "0", type: { tag: "scalar", name: "I32" } },
      { label: "1", type: { tag: "scalar", name: "I32" } },
    ],
  });
});

Deno.test("binding index does not define unresolved assignment targets", () => {
  for (const source of ["missing = 1;\n", "missing[0] = 1;\n"]) {
    const index = build_binding_index(parse_source_with_diagnostics(source));
    const missing = [...index.occurrences.values()].filter((occurrence) =>
      occurrence.name === "missing"
    );

    assert_equals(
      missing.map((occurrence) => ({
        role: occurrence.role,
        entity: occurrence.entity,
        unresolved: occurrence.unresolved,
      })),
      [{
        role: "reference",
        entity: undefined,
        unresolved: "unknown",
      }],
    );
    assert_equals(
      [...index.entities.values()].some((entity) => entity.name === "missing"),
      false,
    );
  }
});

Deno.test("binding index keeps recursive self visible and linear repeats consumable", () => {
  const indexed = occurrences("let rec f = f;\nlet !x = 0;\n!x\n!x\n");
  const fs = indexed.filter((occurrence) => occurrence.name === "f");
  const xs = indexed.filter((occurrence) => occurrence.name === "x");

  assert_equals(fs[0]?.entity, fs[1]?.entity);
  assert_equals(xs.map((occurrence) => occurrence.role), [
    "definition",
    "consume",
    "consume",
  ]);
  assert_equals(xs[0]?.entity, xs[2]?.entity);
});

Deno.test("binding index activates every mutual member at the group start", () => {
  const index = build_binding_index(parse_source_with_diagnostics(
    "let rec even = value => odd(value)\n" +
      "and odd = value => even(value);\n",
  ));
  const references = [...index.occurrences.values()].filter((occurrence) =>
    occurrence.role === "reference" &&
    (occurrence.name === "even" || occurrence.name === "odd")
  );

  for (const reference of references) {
    assert_equals(
      index.visible_at(reference.span.start).find((entity) =>
        entity.name === reference.name
      )?.id,
      reference.entity,
    );
  }
});

Deno.test("binding index resolves value-pack rest bindings", () => {
  const indexed = occurrences(
    `const first = (const ...values) => comptime case values of
  () => 0,
  (value, ...remaining) => value + @len(remaining);
`,
  );
  const remaining = indexed.filter((occurrence) =>
    occurrence.name === "remaining"
  );

  assert_equals(remaining.map((occurrence) => occurrence.role), [
    "definition",
    "reference",
  ]);
  assert_equals(remaining[0]?.entity, remaining[1]?.entity);
});

Deno.test("binding index resolves compile-time values in alternative patterns", () => {
  const indexed = occurrences(
    "const expected = 1;\n" +
      "case value of 0 | #(expected) => 1, _ => 0;\n",
  );
  const expected = indexed.filter((occurrence) => {
    return occurrence.name === "expected";
  });

  assert_equals(expected.map((occurrence) => occurrence.role), [
    "definition",
    "reference",
  ]);
  assert_equals(expected[0]?.entity, expected[1]?.entity);
});

Deno.test("binding index records members and dynamic receivers explicitly", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "type Result = #Ok\n" +
      "let value = #Ok;\nlet field = value.name;\n",
  ));
  const result = [...indexed.entities.values()].find((entity) =>
    entity.name === "Result"
  );
  if (result === undefined) throw new Error("Expected Result entity");
  assert_equals(indexed.member_lookup(result.id, "Ok")?.name, "Ok");
  const names = [...indexed.occurrences.values()].filter((occurrence) =>
    occurrence.name === "name"
  );
  assert_equals(names[0]?.unresolved, "dynamic_member");
});

Deno.test("binding index is deterministic and preserves recovered later names", () => {
  const parsed = parse_source_with_diagnostics(
    "let = bad;\nlet kept = kept;\n",
  );
  const first = build_binding_index(parsed, 2).dump();
  const second = build_binding_index(parsed, 2).dump();
  assert_equals(first, second);
  assert_equals(first.includes("kept definition"), true);
  assert_equals(first.includes("kept reference"), true);
});

Deno.test("binding index keeps declaration type parameters local to their declaration", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "type Maybe a = | #Just a | #Nothing\n" +
      "type Other = a\n0\n",
  ));
  const params = [...indexed.entities.values()].filter((entity) =>
    entity.name === "a"
  );
  const references = [...indexed.occurrences.values()].filter((occurrence) =>
    occurrence.name === "a" && occurrence.role === "reference"
  );

  assert_equals(params.length, 1);
  assert_equals(references.length, 2);
  assert_equals(references[0]?.entity, params[0]?.id);
  assert_equals(references[1]?.unresolved, "unknown");
});

Deno.test("binding index scopes effect parameters across operation signatures", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "effect State value { get: () => value, put: (value) => Unit }\n0\n",
  ));
  const param = [...indexed.entities.values()].find((entity) =>
    entity.name === "value" && entity.kind === "type_parameter"
  );
  const references = [...indexed.occurrences.values()].filter((occurrence) =>
    occurrence.name === "value" && occurrence.role === "reference"
  );

  if (param === undefined) {
    throw new Error("Missing effect type parameter entity");
  }

  assert_equals(references.length, 2);
  assert_equals(references.map((reference) => reference.entity), [
    param.id,
    param.id,
  ]);
});

Deno.test("binding index uses nested annotation facts for statically known members", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "type Vec = struct {.x = Int}\n" +
      "if true then let point: Vec = [.x = 1];\npoint.x end\n",
  ));
  const member = [...indexed.occurrences.values()].find((occurrence) =>
    occurrence.name === "x" && occurrence.role === "member" &&
    occurrence.entity !== undefined
  );

  assert_equals(member?.unresolved, undefined);
  assert_equals(indexed.entities.get(member?.entity || "")?.kind, "field");
});

Deno.test("binding index retains canonical representation evidence", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "let enabled: Bool = true;\nenabled\n",
  ));
  const enabled = [...indexed.entities.values()].find((entity) =>
    entity.name === "enabled" && entity.kind === "value"
  );
  if (enabled === undefined) {
    throw new Error("Expected enabled binding entity");
  }
  assert_equals(indexed.facts.get(enabled.id)?.representation, {
    tag: "scalar",
    name: "Bool",
  });
});

Deno.test("binding index resolves cases and reports the current lexical generation", () => {
  const text = "type Result = #Ok Int\nlet x = 0;\n" +
    "do let x = 1;\nx end\nx\nlet result = #Ok (1);\n" +
    "if let #Ok value = result then value end\n";
  const indexed = build_binding_index(parse_source_with_diagnostics(text));
  const occurrences = [...indexed.occurrences.values()];
  const xs = occurrences.filter((occurrence) => occurrence.name === "x");
  const cases = occurrences.filter((occurrence) => occurrence.name === "ok");
  const references = xs.filter((occurrence) => occurrence.role === "reference");
  const inner = references[0];
  const outer = references[1];

  if (inner === undefined || outer === undefined) {
    throw new Error("Expected x references");
  }
  assert_equals(
    indexed.visible_at(inner.span.start).filter((entity) => entity.name === "x")
      .length,
    1,
  );
  assert_equals(
    indexed.visible_at(inner.span.start).find((entity) => entity.name === "x")
      ?.id,
    inner.entity,
  );
  assert_equals(
    indexed.visible_at(outer.span.start).find((entity) => entity.name === "x")
      ?.id,
    outer.entity,
  );
  assert_equals(
    cases.every((occurrence) => occurrence.entity !== undefined),
    true,
  );
});

Deno.test("binding index reference lists round-trip to their definition entities", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "let x = 1;\nx + x\n",
  ));

  for (const [entity, references] of indexed.references) {
    for (const reference of references) {
      assert_equals(indexed.occurrences.get(reference)?.entity, entity);
    }
  }
});

Deno.test("binding index visibility selects the generation active at the offset", () => {
  const text = "let x = 0;\nx\nx = x + 1\nx\n";
  const indexed = build_binding_index(parse_source_with_diagnostics(text));
  const references = [...indexed.occurrences.values()].filter((occurrence) =>
    occurrence.name === "x" && occurrence.role === "reference"
  );
  const first = references[0];
  const rhs = references[1];
  const last = references[2];

  if (first === undefined || rhs === undefined || last === undefined) {
    throw new Error("Expected references before and after the shadow");
  }

  assert_equals(
    indexed.visible_at(first.span.start).find((entity) => entity.name === "x")
      ?.id,
    first.entity,
  );
  assert_equals(
    indexed.visible_at(rhs.span.start).find((entity) => entity.name === "x")
      ?.id,
    rhs.entity,
  );
  assert_equals(
    indexed.visible_at(last.span.start).find((entity) => entity.name === "x")
      ?.id,
    last.entity,
  );
  assert_equals(
    indexed.visible_at(text.length).find((entity) => entity.name === "x")?.id,
    last.entity,
  );
});

Deno.test("binding index visibility follows evaluate-before-bind constructs", () => {
  for (
    const source of [
      "let x = 0;\nlet x = x + 1;\nx\n",
      "let x = 0;\nlet [x] = [x];\nx\n",
      "let index = 9;\nfor index in index..3 do index end\n",
      "let value = #Some 1;\n" +
      "if let #Some value = value then value end\n",
    ]
  ) {
    const index = build_binding_index(parse_source_with_diagnostics(source));
    const references = [...index.occurrences.values()].filter((occurrence) =>
      occurrence.role === "reference" && occurrence.entity !== undefined &&
      (occurrence.name === "x" || occurrence.name === "index" ||
        occurrence.name === "value")
    );

    for (const reference of references) {
      assert_equals(
        index.visible_at(reference.span.start).find((entity) =>
          entity.name === reference.name
        )?.id,
        reference.entity,
      );
    }
  }
});

Deno.test("binding index activates loop binders through empty body space", () => {
  const source = "let index = 9;\nfor index in index..3 do\n\nend\n";
  const index = build_binding_index(parse_source_with_diagnostics(source));
  const binders = [...index.entities.values()].filter((entity) =>
    entity.name === "index" && entity.kind === "value"
  );
  const loop_binder = binders[1];
  if (loop_binder === undefined) {
    throw new Error("Expected loop index binder");
  }
  const empty_body_offset = source.indexOf("\n\n") + 1;

  assert_equals(
    index.visible_at(empty_body_offset).find((entity) =>
      entity.name === "index"
    )?.id,
    loop_binder.id,
  );
});

Deno.test("binding index selects an overlapping attribute lambda scope", () => {
  const index = build_binding_index(parse_source_with_diagnostics(
    "@[derive((value: I32, tail) => [value, tail])]\n" +
      "type Commands = I32\n",
  ));
  const references = [...index.occurrences.values()].filter((occurrence) =>
    occurrence.role === "reference" && occurrence.entity !== undefined &&
    (occurrence.name === "value" || occurrence.name === "tail")
  );
  assert_equals(references.length, 2);

  for (const reference of references) {
    assert_equals(
      index.visible_at(reference.span.start).find((entity) =>
        entity.name === reference.name
      )?.id,
      reference.entity,
    );
  }
});

Deno.test("binding index keeps owner members out of lexical visibility", () => {
  const text = "type Pair = struct {.left = Int}\nleft\n";
  const indexed = build_binding_index(parse_source_with_diagnostics(text));
  const reference = [...indexed.occurrences.values()].find((occurrence) =>
    occurrence.name === "left" && occurrence.role === "reference"
  );

  assert_equals(reference?.unresolved, "unknown");
  assert_equals(
    indexed.visible_at(text.length).some((entity) => entity.name === "left"),
    false,
  );
});

Deno.test("binding index resolves component annotation sites", () => {
  const indexed = build_binding_index(parse_source_with_diagnostics(
    "type Pair = struct {.left = Int}\nlet value: Pair = [.left = 1];\nvalue.left\n",
  ));
  const pair = [...indexed.entities.values()].find((entity) =>
    entity.name === "Pair"
  );
  const annotation = [...indexed.occurrences.values()].find((occurrence) =>
    occurrence.name === "Pair" && occurrence.role === "reference"
  );

  assert_equals(annotation?.entity, pair?.id);
});
