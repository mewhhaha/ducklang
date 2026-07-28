import { assert_equals, assert_throws } from "../assert.ts";
import { SemanticCfgBuilder } from "./semantic_cfg.ts";

const origin = "expression:0:1:0" as never;

Deno.test("semantic CFG preserves typed operations and stable value identities", () => {
  const builder = new SemanticCfgBuilder("cfg-test");
  const entry = builder.add_block(origin);
  const when_true = builder.add_block("true:1:2:0" as never);
  const when_false = builder.add_block("false:2:3:0" as never);
  const joined = builder.add_block("join:3:4:0" as never);
  const condition = builder.add_node(
    entry,
    origin,
    { tag: "constant", value: true },
    [],
    1,
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
    { tag: "constant", value: 1 },
    [],
    1,
  )[0];
  const false_value = builder.add_node(
    when_false,
    "false:2:3:0" as never,
    { tag: "constant", value: 2 },
    [],
    1,
  )[0];
  if (true_value === undefined || false_value === undefined) {
    throw new Error("missing branch value");
  }
  builder.terminate(when_true, { tag: "jump", target: joined });
  builder.terminate(when_false, { tag: "jump", target: joined });
  const phi = builder.add_phi(
    joined,
    "join:3:4:0" as never,
    new Map([[when_true, true_value], [when_false, false_value]]),
  );
  const output = builder.add_node(
    joined,
    "join:3:4:0" as never,
    { tag: "primitive", name: "identity" },
    [phi],
    1,
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
    () => builder.add_phi(block, origin, new Map()),
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
      builder.add_node(entry, origin, { tag: "primitive", name: "copy" }, [
        "forged" as never,
      ], 1),
    "CFG input ValueId forged is undefined.",
  );
  const condition =
    builder.add_node(entry, origin, { tag: "constant", value: true }, [], 1)[0];
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
  const left_value =
    builder.add_node(join, origin, { tag: "constant", value: 1 }, [], 1)[0];
  if (left_value === undefined) throw new Error("missing left value");
  assert_throws(
    () => builder.add_phi(join, origin, new Map([[left, left_value]])),
    "CFG phi must cover every live predecessor.",
  );
});

Deno.test("semantic CFG rejects branch-local values crossing a phi edge", () => {
  const builder = new SemanticCfgBuilder("dominance-boundary");
  const entry = builder.add_block(origin);
  const left = builder.add_block("left:1:2:0" as never);
  const right = builder.add_block("right:2:3:0" as never);
  const join = builder.add_block("join:3:4:0" as never);
  const condition =
    builder.add_node(entry, origin, { tag: "constant", value: true }, [], 1)[0];
  const right_value = builder.add_node(
    right,
    "right:2:3:0" as never,
    { tag: "constant", value: 9 },
    [],
    1,
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
    new Map([[left, right_value], [right, right_value]]),
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
    { tag: "constant", value: 1 },
    [],
    1,
  )[0];
  if (first_value === undefined) throw new Error("missing first value");
  builder.connect(first, join);
  const phi = builder.add_phi(
    join,
    "join:2:3:0" as never,
    new Map([[first, first_value]]),
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

Deno.test("semantic CFG constants reject mutable host values", () => {
  const builder = new SemanticCfgBuilder("constant-boundary");
  const block = builder.add_block(origin);
  assert_throws(
    () =>
      builder.add_node(
        block,
        origin,
        { tag: "constant", value: { forged: true } as never },
        [],
        1,
      ),
    "CFG constants must be primitive values.",
  );
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
