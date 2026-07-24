import { assert_equals, assert_includes, assert_throws } from "../assert.ts";
import { Source } from "../frontend.ts";
import { instantiate_wat } from "../wasm_test_util.ts";

const rank_two_identity_source = `
const apply_identity: (forall value. value -> value) -> I32 =
  (const identity) => if identity(true) {
    identity(41) + 1
  } else {
    0
  };

const identity = value => value;
comptime apply_identity(identity)
`;

Deno.test("Rank-N callback instantiates independently at each call", async () => {
  const analysis = Source.analyze(rank_two_identity_source);
  assert_equals(analysis.diagnostics, []);

  const core = await instantiate_wat(
    Source.wat(rank_two_identity_source),
    "rank_two_core",
    {},
  );
  const ic = await instantiate_wat(
    Source.ic_wat(rank_two_identity_source),
    "rank_two_ic",
    {},
  );
  const core_main = core.exports.main;
  const ic_main = ic.exports.main;

  if (typeof core_main !== "function" || typeof ic_main !== "function") {
    throw new Error("Rank-N modules do not export main");
  }

  assert_equals(core_main(), 42);
  assert_equals(ic_main(), 42);
});

Deno.test("explicit forall annotations are alpha-equivalent", () => {
  const source = `
const apply_identity: (forall value. value -> value) -> I32 =
  identity => identity(42);

const identity: forall element. element -> element = value => value;
comptime apply_identity(identity)
`;

  assert_equals(Source.analyze(source).diagnostics, []);
  Source.wat(source);
});

Deno.test("functions can return polymorphic functions", async () => {
  const source = `
const make_identity: Bool -> (forall value. value -> value) =
  flag => value => value;

const identity = comptime make_identity(true);
const number = identity(41);
const truth = identity(true);

if truth {
  number + 1
} else {
  0
}
`;
  const analysis = Source.analyze(source);
  assert_equals(analysis.diagnostics, []);
  const instance = await instantiate_wat(
    Source.wat(source),
    "rank_three_result",
    {},
  );
  const main = instance.exports.main;

  if (typeof main !== "function") {
    throw new Error("Rank-3 module does not export main");
  }

  assert_equals(main(), 42);
});

Deno.test("Rank-N annotations reject monomorphic implementations", () => {
  const constant = `
const identity: forall value. value -> value = value => 0;
identity
`;
  const specialized = `
const apply_identity: (forall value. value -> value) -> I32 =
  identity => identity(42);

const identity = (value: I32) => value;
comptime apply_identity(identity)
`;
  const constant_diagnostics = Source.analyze(constant).diagnostics;
  const specialized_diagnostics = Source.analyze(specialized).diagnostics;

  if (constant_diagnostics[0] === undefined) {
    throw new Error("Constant polymorphic implementation was accepted");
  }

  if (specialized_diagnostics[0] === undefined) {
    throw new Error("Specialized polymorphic implementation was accepted");
  }

  assert_includes(
    constant_diagnostics[0].message,
    "does not satisfy polymorphic annotation",
  );
  assert_includes(
    specialized_diagnostics[0].message,
    "expected polymorphic type",
  );
  assert_throws(
    () => Source.wat(constant),
    "does not satisfy polymorphic annotation",
  );
  assert_throws(
    () => Source.wat(specialized),
    "expected polymorphic type",
  );
});
