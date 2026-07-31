import { assert_equals, assert_throws } from "../assert.ts";
import {
  semantic_cfg_is_well_formed,
  SemanticCfgBuilder,
  unique_semantic_call_at_span,
} from "./semantic_cfg.ts";
import type { ValueId } from "./semantic_identity.ts";
import type { RepresentationType } from "./representation_type.ts";

const origin = "expression:0:1:0" as never;
const span = { start: 0, end: 1 };
const bool_type = { tag: "scalar", name: "Bool" } as const;
const i32_type = { tag: "scalar", name: "I32" } as const;
const text_type = { tag: "scalar", name: "Text" } as const;
const pair_type = {
  tag: "product",
  fields: [
    { label: undefined, type: i32_type },
    { label: undefined, type: i32_type },
  ],
} as const;

Deno.test("semantic CFG preserves typed operations and stable value identities", () => {
  const builder = new SemanticCfgBuilder("cfg-test");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("true:1:2:0" as never);
  const when_false = builder.add_block("false:2:3:0" as never);
  const joined = builder.add_block("join:3:4:0" as never);
  const condition = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: true },
    [],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("missing condition value");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.connect(when_true, joined);
  builder.connect(when_false, joined);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const true_value = builder.add_node(
    when_true,
    "true:1:2:0" as never,
    { start: 1, end: 2 },
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  const false_value = builder.add_node(
    when_false,
    "false:2:3:0" as never,
    { start: 2, end: 3 },
    { tag: "constant", value: 2 },
    [],
    [i32_type],
  )[0];
  if (true_value === undefined || false_value === undefined) {
    throw new Error("missing branch value");
  }
  builder.terminate(when_true, { tag: "jump", target: joined });
  builder.terminate(when_false, { tag: "jump", target: joined });
  const phi = builder.add_phi(
    joined,
    "join:3:4:0" as never,
    { start: 3, end: 4 },
    new Map([[when_true, true_value], [when_false, false_value]]),
    i32_type,
  );
  const output = builder.add_node(
    joined,
    "join:3:4:0" as never,
    { start: 3, end: 4 },
    { tag: "primitive", name: "identity" },
    [phi],
    [i32_type],
  )[0];
  builder.terminate(joined, { tag: "return", value: output });
  const cfg = builder.finish();
  assert_equals(cfg.blocks.length, 4);
  assert_equals(cfg.blocks[3]?.predecessors, [when_true, when_false]);
  assert_equals(cfg.blocks[0]?.nodes[0]?.operation, {
    tag: "constant",
    value: true,
  });
  assert_equals(cfg.blocks[3]?.nodes[0]?.operation.tag, "phi");
  assert_equals(cfg.blocks[3]?.nodes[1]?.inputs, [phi]);
  assert_equals(cfg.blocks[0]?.nodes[0]?.span, span);
  assert_equals(cfg.values.map((value) => value.type), [
    bool_type,
    i32_type,
    i32_type,
    i32_type,
    i32_type,
  ]);
  assert_equals(cfg.values[0]?.origin, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  assert_equals(semantic_cfg_is_well_formed(cfg), true);
  assert_equals(
    semantic_cfg_is_well_formed({
      ...cfg,
      blocks: cfg.blocks.map((block) => {
        if (block.id !== entry) return block;
        return { ...block, successors: [] };
      }),
    }),
    false,
  );
  assert_equals(
    semantic_cfg_is_well_formed({
      ...cfg,
      blocks: cfg.blocks.map((block) => {
        if (block.id !== joined) return block;
        return { ...block, predecessors: [when_true] };
      }),
    }),
    false,
  );
  assert_equals(
    semantic_cfg_is_well_formed({
      ...cfg,
      blocks: cfg.blocks.map((block) => {
        if (block.id !== joined) return block;
        return { ...block, nodes: [...block.nodes].reverse() };
      }),
    }),
    false,
  );
});

Deno.test("semantic CFG call lookup rejects reused source spans", () => {
  const builder = new SemanticCfgBuilder("duplicate-call-span");
  const entry = builder.add_block(origin);
  const value = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (value === undefined) throw new Error("missing call argument");
  const call_span = { start: 2, end: 8 };
  builder.add_node(
    entry,
    origin,
    call_span,
    { tag: "call", function_name: "first" },
    [value],
    [i32_type],
  );
  const result = builder.add_node(
    entry,
    origin,
    call_span,
    { tag: "call", function_name: "second" },
    [value],
    [i32_type],
  )[0];
  builder.terminate(entry, { tag: "return", value: result });
  assert_equals(
    unique_semantic_call_at_span(builder.finish(), call_span),
    undefined,
  );
});

Deno.test("semantic CFG parameters are typed values available from entry", () => {
  const builder = new SemanticCfgBuilder("parameter");
  const entry = builder.add_block(undefined);
  const parameter = "external-value" as ValueId;
  builder.add_parameter(parameter, i32_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const output = builder.add_node(
    entry,
    origin,
    span,
    { tag: "primitive", name: "identity" },
    [parameter],
    [i32_type],
  )[0];
  builder.terminate(entry, { tag: "return", value: output });
  const cfg = builder.finish();
  assert_equals(cfg.parameters, [parameter]);
  assert_equals(cfg.values[0], {
    value: parameter,
    type: i32_type,
    origin: {
      source_node: origin,
      start: 0,
      end: 1,
    },
  });
});

Deno.test("semantic CFG rejects disconnected terminators and missing phis", () => {
  const builder = new SemanticCfgBuilder("invalid-cfg");
  const block = builder.add_block(origin);
  const target = builder.add_block("target:1:2:0" as never);
  assert_throws(
    () => builder.terminate(block, { tag: "jump", target }),
    "CFG jump target is not connected.",
  );
  assert_throws(
    () => builder.add_phi(block, origin, span, new Map(), i32_type),
    "CFG phi needs a live predecessor.",
  );
});

Deno.test("semantic CFG rejects forged values and incomplete phi coverage", () => {
  const builder = new SemanticCfgBuilder("value-boundary");
  const entry = builder.add_block(origin);
  const left = builder.add_block("left:1:2:0" as never);
  const right = builder.add_block("right:2:3:0" as never);
  const join = builder.add_block("join:3:4:0" as never);
  assert_throws(
    () =>
      builder.add_node(
        entry,
        origin,
        span,
        { tag: "primitive", name: "copy" },
        ["forged" as never],
        [i32_type],
      ),
    "CFG input ValueId forged is undefined.",
  );
  const condition = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: true },
    [],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("missing condition value");
  builder.connect(entry, left);
  builder.connect(entry, right);
  builder.connect(left, join);
  builder.connect(right, join);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true: left,
    when_false: right,
  });
  builder.terminate(left, { tag: "jump", target: join });
  builder.terminate(right, { tag: "jump", target: join });
  const left_value = builder.add_node(
    join,
    origin,
    span,
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (left_value === undefined) throw new Error("missing left value");
  assert_throws(
    () =>
      builder.add_phi(
        join,
        origin,
        span,
        new Map([[left, left_value]]),
        i32_type,
      ),
    "CFG phi must cover every live predecessor.",
  );
});

Deno.test("semantic CFG rejects branch-local values crossing a phi edge", () => {
  const builder = new SemanticCfgBuilder("dominance-boundary");
  const entry = builder.add_block(origin);
  const left = builder.add_block("left:1:2:0" as never);
  const right = builder.add_block("right:2:3:0" as never);
  const join = builder.add_block("join:3:4:0" as never);
  const condition = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: true },
    [],
    [bool_type],
  )[0];
  const right_value = builder.add_node(
    right,
    "right:2:3:0" as never,
    { start: 2, end: 3 },
    { tag: "constant", value: 9 },
    [],
    [i32_type],
  )[0];
  if (condition === undefined || right_value === undefined) {
    throw new Error("missing CFG value");
  }
  builder.connect(entry, left);
  builder.connect(entry, right);
  builder.connect(left, join);
  builder.connect(right, join);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true: left,
    when_false: right,
  });
  builder.terminate(left, { tag: "jump", target: join });
  builder.terminate(right, { tag: "jump", target: join });
  builder.add_phi(
    join,
    "join:3:4:0" as never,
    { start: 3, end: 4 },
    new Map([[left, right_value], [right, right_value]]),
    i32_type,
  );
  builder.terminate(join, { tag: "return", value: undefined });
  assert_throws(
    () => builder.finish(),
    "CFG phi ValueId",
  );
});

Deno.test("semantic CFG rechecks phi coverage after late edges", () => {
  const builder = new SemanticCfgBuilder("late-phi-edge");
  const first = builder.add_block("first:0:1:0" as never);
  const second = builder.add_block("second:1:2:0" as never);
  const join = builder.add_block("join:2:3:0" as never);
  const first_value = builder.add_node(
    first,
    "first:0:1:0" as never,
    span,
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (first_value === undefined) throw new Error("missing first value");
  builder.connect(first, join);
  const phi = builder.add_phi(
    join,
    "join:2:3:0" as never,
    { start: 2, end: 3 },
    new Map([[first, first_value]]),
    i32_type,
  );
  builder.connect(second, join);
  builder.terminate(first, { tag: "jump", target: join });
  builder.terminate(second, { tag: "jump", target: join });
  builder.terminate(join, { tag: "return", value: phi });
  assert_throws(
    () => builder.finish(),
    "CFG phi in block",
  );
});

Deno.test("semantic CFG accepts a typed loop backedge on an existing phi", () => {
  const builder = new SemanticCfgBuilder("loop-phi-edge");
  const entry = builder.add_block("entry:0:1:0" as never);
  const header = builder.add_block("header:1:2:0" as never);
  const latch = builder.add_block("latch:2:3:0" as never);
  const initial = builder.add_node(
    entry,
    "entry:0:1:0" as never,
    span,
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  if (initial === undefined) throw new Error("missing initial loop value");
  builder.connect(entry, header);
  builder.terminate(entry, { tag: "jump", target: header });
  const phi = builder.add_phi(
    header,
    "header:1:2:0" as never,
    { start: 1, end: 2 },
    new Map([[entry, initial]]),
    i32_type,
  );
  builder.connect(header, latch);
  builder.terminate(header, { tag: "jump", target: latch });
  const next = builder.add_node(
    latch,
    "latch:2:3:0" as never,
    { start: 2, end: 3 },
    { tag: "primitive", name: "increment" },
    [phi],
    [i32_type],
  )[0];
  if (next === undefined) throw new Error("missing next loop value");
  builder.connect(latch, header);
  builder.add_phi_input(phi, latch, next);
  builder.terminate(latch, { tag: "jump", target: header });
  const cfg = builder.finish();
  assert_equals(cfg.blocks[1]?.nodes[0]?.operation, {
    tag: "phi",
    incoming: [
      { predecessor: entry, value: initial },
      { predecessor: latch, value: next },
    ],
  });
});

Deno.test("semantic CFG constants reject mutable host values", () => {
  const builder = new SemanticCfgBuilder("constant-boundary");
  const block = builder.add_block(origin);
  assert_throws(
    () =>
      builder.add_node(
        block,
        origin,
        span,
        { tag: "constant", value: { forged: true } as never },
        [],
        [i32_type],
      ),
    "CFG constants must be primitive values.",
  );
});

Deno.test("semantic CFG rejects non-boolean branch conditions", () => {
  const builder = new SemanticCfgBuilder("branch-type");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("true:1:2:0" as never);
  const when_false = builder.add_block("false:2:3:0" as never);
  const condition = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (condition === undefined) throw new Error("missing condition value");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  assert_throws(
    () =>
      builder.terminate(entry, {
        tag: "branch",
        condition,
        when_true,
        when_false,
      }),
    "must have representation Bool",
  );
});

Deno.test("semantic CFG rejects duplicate explicit output identities", () => {
  const builder = new SemanticCfgBuilder("duplicate-output");
  const entry = builder.add_block(origin);
  const output = {
    value: "same-output" as ValueId,
    origin: {
      source_node: origin,
      start: 0,
      end: 1,
    },
  };
  assert_throws(
    () =>
      builder.add_node(
        entry,
        origin,
        span,
        { tag: "primitive", name: "split" },
        [],
        [i32_type, i32_type],
        [output, output],
      ),
    "is already defined",
  );
  const retried = builder.add_node(
    entry,
    origin,
    span,
    { tag: "primitive", name: "split" },
    [],
    [i32_type],
  )[0];
  const fresh_builder = new SemanticCfgBuilder("duplicate-output");
  const fresh_entry = fresh_builder.add_block(origin);
  const fresh = fresh_builder.add_node(
    fresh_entry,
    origin,
    span,
    { tag: "primitive", name: "split" },
    [],
    [i32_type],
  )[0];
  assert_equals(retried, fresh);
});

Deno.test("semantic CFG rejects forged indexed read and write types", () => {
  const builder = new SemanticCfgBuilder("cfg-index-types");
  const entry = builder.add_block(origin);
  const values = "index-values" as ValueId;
  builder.add_parameter(values, pair_type, {
    source_node: origin,
    start: 0,
    end: 1,
  });
  const index = builder.add_node(
    entry,
    origin,
    { start: 1, end: 2 },
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  const replacement = builder.add_node(
    entry,
    origin,
    { start: 2, end: 3 },
    { tag: "constant", value: 42 },
    [],
    [i32_type],
  )[0];
  if (index === undefined || replacement === undefined) {
    throw new Error("Expected indexed operation inputs.");
  }
  const read = builder.add_node(
    entry,
    origin,
    { start: 3, end: 4 },
    { tag: "index", length: 2, mode: "read" },
    [values, index],
    [i32_type],
  )[0];
  const write = builder.add_node(
    entry,
    origin,
    { start: 4, end: 5 },
    { tag: "index", length: 2, mode: "write" },
    [values, index, replacement],
    [pair_type],
  )[0];
  if (read === undefined || write === undefined) {
    throw new Error("Expected indexed operation outputs.");
  }
  builder.terminate(entry, { tag: "return", value: write });
  const control_flow = builder.finish();
  assert_equals(semantic_cfg_is_well_formed(control_flow), true);

  const forged_read = {
    ...control_flow,
    values: control_flow.values.map((value) => {
      if (value.value !== read) return value;
      return { ...value, type: bool_type };
    }),
  };
  assert_equals(semantic_cfg_is_well_formed(forged_read), false);

  const forged_replacement = {
    ...control_flow,
    values: control_flow.values.map((value) => {
      if (value.value !== replacement) return value;
      return { ...value, type: bool_type };
    }),
  };
  assert_equals(semantic_cfg_is_well_formed(forged_replacement), false);

  const forged_write = {
    ...control_flow,
    values: control_flow.values.map((value) => {
      if (value.value !== write) return value;
      return { ...value, type: i32_type };
    }),
  };
  assert_equals(semantic_cfg_is_well_formed(forged_write), false);
});

Deno.test("semantic CFG rejects forged static slice lengths", () => {
  const builder = new SemanticCfgBuilder("cfg-slice-length");
  const entry = builder.add_block(origin);
  const object = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: "duck" },
    [],
    [text_type],
  )[0];
  const start = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: 0 },
    [],
    [i32_type],
  )[0];
  const end = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: 4 },
    [],
    [i32_type],
  )[0];
  if (object === undefined || start === undefined || end === undefined) {
    throw new Error("Expected slice inputs.");
  }
  const result = builder.add_node(
    entry,
    origin,
    span,
    { tag: "slice", length: 4 },
    [object, start, end],
    [text_type],
  )[0];
  if (result === undefined) throw new Error("Expected slice result.");
  builder.terminate(entry, { tag: "return", value: result });
  const control_flow = builder.finish();
  assert_equals(semantic_cfg_is_well_formed(control_flow), true);

  const forged = {
    ...control_flow,
    blocks: control_flow.blocks.map((block) => ({
      ...block,
      nodes: block.nodes.map((node) => {
        if (node.operation.tag !== "slice") return node;
        return { ...node, operation: { tag: "slice" as const, length: 5 } };
      }),
    })),
  };
  assert_equals(semantic_cfg_is_well_formed(forged), false);
});

Deno.test("semantic CFG rejects representation key collisions at phis", () => {
  const builder = new SemanticCfgBuilder("phi-type-collision");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("true:1:2:0" as never);
  const when_false = builder.add_block("false:2:3:0" as never);
  const joined = builder.add_block("join:3:4:0" as never);
  const condition = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: true },
    [],
    [bool_type],
  )[0];
  if (condition === undefined) throw new Error("missing condition value");
  builder.connect(entry, when_true);
  builder.connect(entry, when_false);
  builder.connect(when_true, joined);
  builder.connect(when_false, joined);
  builder.terminate(entry, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const one_field = {
    tag: "product",
    fields: [{ label: "a:scalar(I32),b", type: i32_type }],
  } as const;
  const two_fields = {
    tag: "product",
    fields: [
      { label: "a", type: i32_type },
      { label: "b", type: i32_type },
    ],
  } as const;
  const true_value = builder.add_node(
    when_true,
    "true:1:2:0" as never,
    { start: 1, end: 2 },
    { tag: "constant", value: 1 },
    [],
    [one_field],
  )[0];
  const false_value = builder.add_node(
    when_false,
    "false:2:3:0" as never,
    { start: 2, end: 3 },
    { tag: "constant", value: 2 },
    [],
    [one_field],
  )[0];
  if (true_value === undefined || false_value === undefined) {
    throw new Error("missing branch value");
  }
  assert_throws(
    () =>
      builder.add_phi(
        joined,
        "join:3:4:0" as never,
        { start: 3, end: 4 },
        new Map([[when_true, true_value], [when_false, false_value]]),
        two_fields,
      ),
    "has an incompatible type",
  );
});

Deno.test("rejected semantic phis leave the builder unchanged", () => {
  const builder = new SemanticCfgBuilder("phi-retry");
  const entry = builder.add_block(origin);
  const joined = builder.add_block("join:3:4:0" as never);
  const input = builder.add_node(
    entry,
    origin,
    span,
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (input === undefined) throw new Error("missing input value");
  builder.connect(entry, joined);
  builder.terminate(entry, { tag: "jump", target: joined });
  const inherited_type = Object.create({
    tag: "scalar",
    name: "I32",
  }) as RepresentationType;
  assert_throws(
    () =>
      builder.add_phi(
        joined,
        "join:3:4:0" as never,
        { start: 3, end: 4 },
        new Map([[entry, input]]),
        inherited_type,
      ),
    "plain record",
  );
  const retried = builder.add_phi(
    joined,
    "join:3:4:0" as never,
    { start: 3, end: 4 },
    new Map([[entry, input]]),
    i32_type,
  );
  builder.terminate(joined, { tag: "return", value: retried });
  const cfg = builder.finish();

  const fresh_builder = new SemanticCfgBuilder("phi-retry");
  const fresh_entry = fresh_builder.add_block(origin);
  const fresh_joined = fresh_builder.add_block("join:3:4:0" as never);
  const fresh_input = fresh_builder.add_node(
    fresh_entry,
    origin,
    span,
    { tag: "constant", value: 1 },
    [],
    [i32_type],
  )[0];
  if (fresh_input === undefined) throw new Error("missing fresh input value");
  fresh_builder.connect(fresh_entry, fresh_joined);
  fresh_builder.terminate(fresh_entry, {
    tag: "jump",
    target: fresh_joined,
  });
  const fresh = fresh_builder.add_phi(
    fresh_joined,
    "join:3:4:0" as never,
    { start: 3, end: 4 },
    new Map([[fresh_entry, fresh_input]]),
    i32_type,
  );
  assert_equals(retried, fresh);
  assert_equals(cfg.blocks[1]?.nodes.length, 1);
  assert_equals(cfg.values.length, 2);
});

Deno.test("semantic CFG rejects non-numeric block IDs", () => {
  const builder = new SemanticCfgBuilder("block-id-boundary");
  builder.add_block(origin);
  builder.add_block("target:1:2:0" as never);
  assert_throws(
    () => builder.connect("0" as never, "1" as never),
    "Invalid CFG block ID 0.",
  );
});
