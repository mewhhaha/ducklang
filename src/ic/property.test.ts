import { assert_equals } from "../assert.ts";
import { Ic, type Ic as IcNode } from "../ic.ts";

type GeneratedTermContext = {
  next_name: number;
};

Deno.test("Ic reduction preserves validity for generated affine terms", () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const program = generated_term({ next_name: 0 }, seed, 4);
    Ic.assert_valid(program);

    const first = Ic.reduce(program);
    const second = Ic.reduce(program);

    Ic.assert_valid(first);
    assert_equals(
      first,
      second,
      "Reduction was not deterministic for seed " + seed,
    );
  }
});

Deno.test("Ic reduction is invariant under generated binder renaming", () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const left = generated_term({ next_name: 0 }, seed, 4);
    const right = generated_term({ next_name: 1000 }, seed, 4);

    assert_equals(
      Ic.reduce(left),
      Ic.reduce(right),
      "Binder renaming changed the reduced result for seed " + seed,
    );
  }
});

Deno.test("Ic fresh interaction names do not capture reserved user names", () => {
  const program: IcNode = {
    tag: "app",
    func: {
      tag: "sup",
      label: "fresh",
      left: {
        tag: "lam",
        name: "_x0",
        body: add(variable("_x0"), i32(1)),
      },
      right: {
        tag: "lam",
        name: "_x1",
        body: add(variable("_x1"), i32(2)),
      },
    },
    arg: i32(40),
  };

  Ic.assert_valid(program);
  const reduced = Ic.reduce(program);
  Ic.assert_valid(reduced);
  assert_equals(reduced, {
    tag: "sup",
    label: "fresh",
    left: i32(41),
    right: i32(42),
  });
});

function generated_term(
  context: GeneratedTermContext,
  seed: number,
  depth: number,
): IcNode {
  if (depth === 0) {
    return i32((seed * 17 + 11) | 0);
  }

  const shape = seed % 6;

  if (shape === 0) {
    return add(
      generated_term(context, seed + 1, depth - 1),
      generated_term(context, seed + 2, depth - 1),
    );
  }

  if (shape === 1) {
    const name = fresh_generated_name(context, "arg");
    return {
      tag: "app",
      func: {
        tag: "lam",
        name,
        body: add(
          variable(name),
          generated_term(context, seed + 3, depth - 1),
        ),
      },
      arg: generated_term(context, seed + 4, depth - 1),
    };
  }

  if (shape === 2) {
    const name = fresh_generated_name(context, "pair");
    const label = "same_" + depth.toString();
    return {
      tag: "dup",
      label,
      name,
      expr: {
        tag: "sup",
        label,
        left: generated_term(context, seed + 5, depth - 1),
        right: generated_term(context, seed + 6, depth - 1),
      },
      body: add(variable(name + "0"), variable(name + "1")),
    };
  }

  if (shape === 3) {
    return {
      tag: "era",
      expr: generated_term(context, seed + 7, depth - 1),
      body: generated_term(context, seed + 8, depth - 1),
    };
  }

  if (shape === 4) {
    const name = fresh_generated_name(context, "commute");
    return {
      tag: "dup",
      label: "outer_" + depth.toString(),
      name,
      expr: {
        tag: "sup",
        label: "inner_" + depth.toString(),
        left: i32(seed + 1),
        right: i32(seed + 2),
      },
      body: add(variable(name + "0"), variable(name + "1")),
    };
  }

  return {
    tag: "app",
    func: {
      tag: "sup",
      label: "apply_" + depth.toString(),
      left: {
        tag: "lam",
        name: fresh_generated_name(context, "left"),
        body: generated_term(context, seed + 9, depth - 1),
      },
      right: {
        tag: "lam",
        name: fresh_generated_name(context, "right"),
        body: generated_term(context, seed + 10, depth - 1),
      },
    },
    arg: generated_term(context, seed + 11, depth - 1),
  };
}

function fresh_generated_name(
  context: GeneratedTermContext,
  prefix: string,
): string {
  const name = prefix + "_" + context.next_name.toString() + "_v";
  context.next_name += 1;
  return name;
}

function i32(value: number): IcNode {
  return { tag: "num", type: "i32", value };
}

function variable(name: string): IcNode {
  return { tag: "var", name };
}

function add(left: IcNode, right: IcNode): IcNode {
  return { tag: "prim", prim: "i32.add", args: [left, right] };
}
