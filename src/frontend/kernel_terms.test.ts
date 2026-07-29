import { assert_equals, assert_throws } from "../assert.ts";
import {
  check_term,
  check_type,
  infer_term,
  KernelEnvironment,
  prop_sort,
  type_assignable,
  type_equal,
  type_sort,
} from "./kernel_terms.ts";

Deno.test("kernel universes are cumulative", () => {
  assert_equals(check_type(prop_sort), { tag: "type", level: 0 });
  assert_equals(check_type(type_sort(2)), { tag: "type", level: 3 });
});

Deno.test("kernel conversion accepts lower universes at higher universe types", () => {
  assert_equals(type_assignable(type_sort(0), type_sort(2)), true);
  assert_equals(type_assignable(type_sort(2), type_sort(0)), false);
  assert_equals(type_assignable(prop_sort, type_sort(0)), false);
});

Deno.test("kernel rejects invalid universe levels", () => {
  assert_throws(
    () => type_sort(-1),
    "Invalid universe level -1.",
  );
});

Deno.test("kernel rejects invalid universe levels in raw types", () => {
  assert_throws(
    () => check_type({ tag: "sort", universe: { tag: "type", level: -1 } }),
    "Invalid universe level -1.",
  );
});

Deno.test("kernel validates raw universes and de Bruijn indices", () => {
  assert_throws(
    () =>
      check_type({ tag: "sort", universe: { tag: "type", level: Number.NaN } }),
    "Invalid universe level NaN.",
  );
  assert_throws(
    () => infer_term({ tag: "var", index: -1 }),
    "Invalid term de Bruijn index -1.",
  );
  assert_throws(
    () => check_type({ tag: "var", index: 0 }, []),
    "Kernel type variable 0 is out of scope.",
  );
  assert_throws(
    () => infer_term({ tag: "var", index: 0 }, [{ tag: "bogus" } as never]),
    "Invalid kernel type tag bogus.",
  );
});

Deno.test("kernel rejects untrusted type constants", () => {
  assert_throws(
    () => check_type({ tag: "constant", name: "forged" }),
    "Kernel type constant forged requires a trusted environment.",
  );
});

Deno.test("kernel infers de Bruijn lambda types", () => {
  const identity = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: { tag: "var" as const, index: 0 },
  };
  const inferred = infer_term(identity);

  assert_equals(inferred, {
    tag: "pi",
    domain: type_sort(0),
    codomain: type_sort(0),
  });
});

Deno.test("kernel type variables retain their declared universe", () => {
  assert_equals(
    check_type({ tag: "var", index: 0 }, [type_sort(0)]),
    { tag: "type", level: 0 },
  );
});

Deno.test("kernel rejects de Bruijn variables outside their context", () => {
  assert_throws(
    () => infer_term({ tag: "var", index: 0 }),
    "Kernel variable 0 is out of scope.",
  );
});

Deno.test("kernel checks a typed de Bruijn identity", () => {
  const identity = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: { tag: "var" as const, index: 0 },
  };
  check_term(identity, {
    tag: "pi",
    domain: type_sort(0),
    codomain: type_sort(0),
  });
});

Deno.test("kernel constants require a matching trusted declaration", () => {
  const constant = {
    tag: "constant" as const,
    name: "TypeValue",
    type: type_sort(0),
  };
  assert_throws(
    () => infer_term(constant),
    "Kernel constant TypeValue requires a trusted environment.",
  );
  assert_throws(
    () =>
      infer_term(
        constant,
        [],
        KernelEnvironment.from(new Map([["TypeValue", type_sort(1)]])),
      ),
    "Kernel constant TypeValue has an invalid declared type.",
  );
  assert_equals(
    infer_term(
      constant,
      [],
      KernelEnvironment.from(new Map([["TypeValue", type_sort(0)]])),
    ),
    type_sort(0),
  );
});

Deno.test("kernel environments snapshot declaration types", () => {
  const declaration = {
    tag: "sort" as const,
    universe: { tag: "type" as const, level: 0 },
  };
  const environment = KernelEnvironment.from(new Map([["T", declaration]]));
  declaration.universe.level = 4;
  const resolved = environment.declaration("T");
  assert_equals(resolved, type_sort(0));
  assert_throws(
    () => {
      if (resolved === undefined || resolved.tag !== "sort") {
        throw new Error("Missing declaration snapshot.");
      }
      if (resolved.universe.tag !== "type") {
        throw new Error("Unexpected proposition declaration.");
      }
      resolved.universe.level = 2;
    },
    "read only",
  );
});

Deno.test("kernel inference snapshots lambda result types", () => {
  const domain = {
    tag: "sort" as const,
    universe: { tag: "type" as const, level: 0 },
  };
  const inferred = infer_term({
    tag: "lam",
    domain,
    body: { tag: "var", index: 0 },
  });
  domain.universe.level = 4;
  assert_equals(inferred, {
    tag: "pi",
    domain: type_sort(0),
    codomain: type_sort(0),
  });
});

Deno.test("kernel applies a typed identity function", () => {
  const identity = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: { tag: "var" as const, index: 0 },
  };
  assert_equals(
    infer_term(
      {
        tag: "app",
        function: identity,
        argument: { tag: "constant", name: "T", type: type_sort(0) },
      },
      [],
      KernelEnvironment.from(new Map([["T", type_sort(0)]])),
    ),
    type_sort(0),
  );
});

Deno.test("kernel rejects an application with a mismatched argument", () => {
  const identity = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: { tag: "var" as const, index: 0 },
  };
  assert_throws(
    () => infer_term({ tag: "app", function: identity, argument: identity }),
    "Kernel application argument has an invalid type.",
  );
});

Deno.test("kernel substitutes dependent application result types", () => {
  const polymorphic_identity = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: {
      tag: "lam" as const,
      domain: { tag: "var" as const, index: 0 },
      body: { tag: "var" as const, index: 0 },
    },
  };
  assert_equals(infer_term(polymorphic_identity), {
    tag: "pi",
    domain: type_sort(0),
    codomain: {
      tag: "pi",
      domain: { tag: "var", index: 0 },
      codomain: { tag: "var", index: 1 },
    },
  });

  const environment = KernelEnvironment.from(
    new Map([
      ["T", type_sort(0)],
      ["value", { tag: "constant" as const, name: "T" }],
    ]),
  );
  const type_argument = {
    tag: "constant" as const,
    name: "T",
    type: type_sort(0),
  };
  const specialized = {
    tag: "app" as const,
    function: polymorphic_identity,
    argument: type_argument,
  };
  assert_equals(infer_term(specialized, [], environment), {
    tag: "pi",
    domain: { tag: "constant", name: "T" },
    codomain: { tag: "constant", name: "T" },
  });
  assert_equals(
    infer_term(
      {
        tag: "app",
        function: specialized,
        argument: {
          tag: "constant",
          name: "value",
          type: { tag: "constant", name: "T" },
        },
      },
      [],
      environment,
    ),
    { tag: "constant", name: "T" },
  );
});

Deno.test("kernel type conversion beta-reduces type-level applications", () => {
  const environment = KernelEnvironment.from(
    new Map([["T", type_sort(0)]]),
  );
  const reduced = {
    tag: "app" as const,
    function: {
      tag: "lam" as const,
      domain: type_sort(0),
      body: { tag: "var" as const, index: 0 },
    },
    argument: { tag: "constant" as const, name: "T" },
  };

  assert_equals(
    type_equal(reduced, { tag: "constant", name: "T" }),
    true,
  );
  assert_equals(
    check_type(reduced, [], environment),
    { tag: "type", level: 0 },
  );
});

Deno.test("dependent substitution avoids capture under nested binders", () => {
  const polymorphic_type = {
    tag: "pi" as const,
    domain: type_sort(0),
    codomain: {
      tag: "pi" as const,
      domain: { tag: "var" as const, index: 0 },
      codomain: { tag: "var" as const, index: 1 },
    },
  };
  const environment = KernelEnvironment.from(
    new Map([["identity", polymorphic_type]]),
  );
  const specialization = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: {
      tag: "app" as const,
      function: {
        tag: "constant" as const,
        name: "identity",
        type: polymorphic_type,
      },
      argument: { tag: "var" as const, index: 0 },
    },
  };

  assert_equals(infer_term(specialization, [], environment), {
    tag: "pi",
    domain: type_sort(0),
    codomain: {
      tag: "pi",
      domain: { tag: "var", index: 0 },
      codomain: { tag: "var", index: 1 },
    },
  });
});

Deno.test("kernel conversion rejects non-normalizing forged expressions", () => {
  const self_application = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: {
      tag: "app" as const,
      function: { tag: "var" as const, index: 0 },
      argument: { tag: "var" as const, index: 0 },
    },
  };

  assert_throws(
    () =>
      type_equal({
        tag: "app",
        function: self_application,
        argument: self_application,
      }, type_sort(0)),
    "Kernel normalization exceeded 10000 steps.",
  );
});

Deno.test("dependent application snapshots its argument once", () => {
  const polymorphic_identity = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: {
      tag: "lam" as const,
      domain: { tag: "var" as const, index: 0 },
      body: { tag: "var" as const, index: 0 },
    },
  };
  const trusted_argument = {
    tag: "constant" as const,
    name: "T",
    type: type_sort(0),
  };
  const missing_argument = {
    tag: "constant" as const,
    name: "Missing",
    type: type_sort(0),
  };
  let argument_reads = 0;
  const application = new Proxy({
    tag: "app" as const,
    function: polymorphic_identity,
    argument: trusted_argument,
  }, {
    get(target, key, receiver) {
      if (key === "argument") {
        argument_reads += 1;
        if (argument_reads === 1) return trusted_argument;
        return missing_argument;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const environment = KernelEnvironment.from(
    new Map([["T", type_sort(0)]]),
  );

  assert_equals(infer_term(application, [], environment), {
    tag: "pi",
    domain: { tag: "constant", name: "T" },
    codomain: { tag: "constant", name: "T" },
  });
  assert_equals(argument_reads, 0);
});

Deno.test("kernel environments snapshot declarations before checking", () => {
  let tag_reads = 0;
  const declaration = new Proxy(type_sort(0), {
    get(target, key, receiver) {
      if (key === "tag") {
        tag_reads += 1;
        if (tag_reads === 1) return "sort";
        return "constant";
      }
      if (key === "name") return "Missing";
      return Reflect.get(target, key, receiver);
    },
  });
  const environment = KernelEnvironment.from(
    new Map([["T", declaration]]),
  );

  assert_equals(environment.declaration("T"), type_sort(0));
  assert_equals(tag_reads, 0);
});

Deno.test("kernel constants reject ill-formed beta-equal annotations", () => {
  const invalid_annotation = {
    tag: "app" as const,
    function: {
      tag: "lam" as const,
      domain: prop_sort,
      body: type_sort(0),
    },
    argument: type_sort(0),
  };
  const environment = KernelEnvironment.from(
    new Map([["T", type_sort(0)]]),
  );

  assert_throws(
    () =>
      infer_term(
        {
          tag: "constant",
          name: "T",
          type: invalid_annotation,
        },
        [],
        environment,
      ),
    "Kernel type application argument has an invalid type.",
  );
});

Deno.test("kernel type snapshots reject cyclic input graphs", () => {
  const cyclic = {
    tag: "pi" as const,
    domain: type_sort(0),
    codomain: type_sort(0),
  };
  cyclic.codomain = cyclic;

  assert_throws(
    () => check_type(cyclic),
    "Kernel type graph must be acyclic.",
  );
});

Deno.test("kernel term snapshots reject cyclic input graphs", () => {
  const cyclic: {
    tag: "lam";
    domain: ReturnType<typeof type_sort>;
    body: unknown;
  } = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: { tag: "var" as const, index: 0 },
  };
  cyclic.body = cyclic;

  assert_throws(
    () => infer_term(cyclic as never),
    "Kernel term graph must be acyclic.",
  );
});

Deno.test("public type checks reject ill-formed context entries", () => {
  const invalid_context_type = {
    tag: "app" as const,
    function: {
      tag: "lam" as const,
      domain: prop_sort,
      body: type_sort(0),
    },
    argument: type_sort(0),
  };
  assert_throws(
    () => check_type({ tag: "var", index: 0 }, [invalid_context_type]),
    "Kernel type application argument has an invalid type.",
  );
  assert_throws(
    () =>
      type_assignable(
        { tag: "var", index: 0 },
        { tag: "var", index: 0 },
        [invalid_context_type],
      ),
    "Kernel type application argument has an invalid type.",
  );
});
