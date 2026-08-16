import { assert_equals, assert_throws } from "../assert.ts";
import {
  check_term,
  check_term_sequence,
  check_type,
  infer_term,
  type KernelDefinition,
  KernelEnvironment,
  type KernelTerm,
  type KernelType,
  MAX_KERNEL_TERM_SEQUENCE_LENGTH,
  prop_sort,
  shift_kernel_term_variables,
  substitute_kernel_term_variable,
  substitute_kernel_type_variable,
  term_equal,
  term_sequences_equal,
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

Deno.test("kernel checks bounded term sequences with shared context", () => {
  const context = [type_sort(0)];
  const terms: KernelTerm[] = [];
  for (
    let index = 0;
    index < MAX_KERNEL_TERM_SEQUENCE_LENGTH;
    index += 1
  ) {
    terms.push({ tag: "var", index: 0 });
  }

  check_term_sequence(terms, context);
  assert_equals(term_sequences_equal(terms, terms, context), true);

  terms.push({ tag: "var", index: 0 });
  assert_throws(
    () => check_term_sequence(terms, context),
    `Kernel term sequence exceeds ${MAX_KERNEL_TERM_SEQUENCE_LENGTH} entries.`,
  );
  assert_throws(
    () => term_sequences_equal(terms, terms, context),
    `Kernel term sequence exceeds ${MAX_KERNEL_TERM_SEQUENCE_LENGTH} entries.`,
  );
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

Deno.test("kernel term conversion beta-reduces typed applications", () => {
  const context: KernelType[] = [type_sort(0)];
  const variable = { tag: "var" as const, index: 0 };
  const applied_identity = {
    tag: "app" as const,
    function: {
      tag: "lam" as const,
      domain: type_sort(0),
      body: { tag: "var" as const, index: 0 },
    },
    argument: variable,
  };

  assert_equals(term_equal(variable, applied_identity, context), true);
});

Deno.test("kernel term substitution avoids capture below binders", () => {
  const term = {
    tag: "lam" as const,
    domain: type_sort(0),
    body: { tag: "var" as const, index: 1 },
  };

  assert_equals(
    substitute_kernel_term_variable(
      term,
      { tag: "var", index: 0 },
      0,
    ),
    {
      tag: "lam",
      domain: type_sort(0),
      body: { tag: "var", index: 1 },
    },
  );
});

Deno.test("kernel substitution distinguishes context index from binder depth", () => {
  assert_equals(
    substitute_kernel_term_variable(
      {
        tag: "app",
        function: { tag: "var", index: 1 },
        argument: { tag: "var", index: 0 },
      },
      {
        tag: "lam",
        domain: type_sort(0),
        body: { tag: "var", index: 1 },
      },
      1,
    ),
    {
      tag: "app",
      function: {
        tag: "lam",
        domain: type_sort(0),
        body: { tag: "var", index: 2 },
      },
      argument: { tag: "var", index: 0 },
    },
  );
  assert_equals(
    substitute_kernel_type_variable(
      {
        tag: "pi",
        domain: { tag: "var", index: 1 },
        codomain: { tag: "var", index: 2 },
      },
      {
        tag: "lam",
        domain: type_sort(0),
        body: { tag: "var", index: 1 },
      },
      1,
    ),
    {
      tag: "pi",
      domain: {
        tag: "lam",
        domain: type_sort(0),
        body: { tag: "var", index: 2 },
      },
      codomain: {
        tag: "lam",
        domain: type_sort(0),
        body: { tag: "var", index: 3 },
      },
    },
  );
});

Deno.test("kernel shifts only variables at or above the cutoff", () => {
  assert_equals(
    shift_kernel_term_variables(
      {
        tag: "lam",
        domain: type_sort(0),
        body: {
          tag: "app",
          function: { tag: "var", index: 0 },
          argument: { tag: "var", index: 1 },
        },
      },
      1,
    ),
    {
      tag: "lam",
      domain: type_sort(0),
      body: {
        tag: "app",
        function: { tag: "var", index: 0 },
        argument: { tag: "var", index: 2 },
      },
    },
  );
});

Deno.test("kernel substitution rejects invalid context indices", () => {
  assert_throws(
    () =>
      substitute_kernel_term_variable(
        { tag: "var", index: 0 },
        { tag: "var", index: 0 },
        -1,
      ),
    "Invalid substitution de Bruijn index -1.",
  );
  assert_throws(
    () =>
      substitute_kernel_term_variable(
        {
          tag: "lam",
          domain: type_sort(0),
          body: { tag: "var", index: 0 },
        },
        { tag: "var", index: 0 },
        Number.MAX_SAFE_INTEGER,
      ),
    "Kernel term substitution target exceeds the safe integer range.",
  );
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

Deno.test("transparent total definitions unfold during conversion", () => {
  const definitions: KernelDefinition[] = [
    {
      tag: "declaration",
      name: "I32",
      type: type_sort(0),
    },
    {
      tag: "transparent",
      name: "Identity",
      module: "math",
      type: {
        tag: "pi",
        domain: type_sort(0),
        codomain: type_sort(0),
      },
      value: {
        tag: "lam",
        domain: type_sort(0),
        body: { tag: "var", index: 0 },
      },
      total: true,
    },
  ];
  const environment = KernelEnvironment.from_definitions(definitions);
  const applied: KernelType = {
    tag: "app",
    function: { tag: "constant", name: "Identity" },
    argument: { tag: "constant", name: "I32" },
  };

  assert_equals(
    type_equal(
      applied,
      { tag: "constant", name: "I32" },
      environment,
    ),
    true,
  );
});

Deno.test("opaque definitions stay sealed outside their defining module", () => {
  const environment = KernelEnvironment.from_definitions([
    {
      tag: "declaration",
      name: "I32",
      type: type_sort(0),
    },
    {
      tag: "opaque",
      name: "Hidden",
      module: "secrets",
      type: type_sort(0),
      value: { tag: "constant", name: "I32" },
      total: true,
    },
    {
      tag: "declaration",
      name: "zero",
      type: { tag: "constant", name: "I32" },
    },
    {
      tag: "transparent",
      name: "checked_inside",
      module: "secrets",
      type: { tag: "constant", name: "Hidden" },
      value: { tag: "constant", name: "zero" },
      total: true,
    },
  ]);
  const hidden: KernelType = { tag: "constant", name: "Hidden" };
  const represented: KernelType = { tag: "constant", name: "I32" };

  assert_equals(type_equal(hidden, represented, environment), false);
});

Deno.test("kernel definitions reject non-total computation", () => {
  assert_throws(
    () =>
      KernelEnvironment.from_definitions([
        {
          tag: "declaration",
          name: "I32",
          type: type_sort(0),
        },
        {
          tag: "transparent",
          name: "Loop",
          module: "math",
          type: type_sort(0),
          value: { tag: "constant", name: "I32" },
          total: false,
        },
      ]),
    "Kernel definition Loop is not total.",
  );
});

Deno.test("opaque definition bodies are checked before sealing", () => {
  assert_throws(
    () =>
      KernelEnvironment.from_definitions([
        {
          tag: "declaration",
          name: "I32",
          type: type_sort(0),
        },
        {
          tag: "opaque",
          name: "Broken",
          module: "secrets",
          type: { tag: "constant", name: "I32" },
          value: { tag: "constant", name: "I32" },
          total: true,
        },
      ]),
    "Kernel definition Broken has an invalid value type.",
  );
});

Deno.test("kernel definitions reject duplicates and forward references", () => {
  assert_throws(
    () =>
      KernelEnvironment.from_definitions([
        {
          tag: "declaration",
          name: "T",
          type: type_sort(0),
        },
        {
          tag: "declaration",
          name: "T",
          type: type_sort(0),
        },
      ]),
    "Duplicate kernel definition T.",
  );
  assert_throws(
    () =>
      KernelEnvironment.from_definitions([
        {
          tag: "transparent",
          name: "Alias",
          module: "types",
          type: type_sort(0),
          value: { tag: "constant", name: "Later" },
          total: true,
        },
        {
          tag: "declaration",
          name: "Later",
          type: type_sort(0),
        },
      ]),
    "Kernel type constant Later requires a trusted environment.",
  );
});

Deno.test("kernel definition inputs are snapshotted before checking", () => {
  let value_reads = 0;
  const definition = new Proxy({
    tag: "transparent" as const,
    name: "Alias",
    module: "types",
    type: type_sort(0),
    value: prop_sort,
    total: true,
  }, {
    get(target, key, receiver) {
      if (key === "value") {
        value_reads += 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const environment = KernelEnvironment.from_definitions([definition]);

  assert_equals(value_reads, 0);
  assert_equals(
    type_equal(
      { tag: "constant", name: "Alias" },
      prop_sort,
      environment,
    ),
    true,
  );
});

Deno.test("kernel environment construction is sealed at runtime", () => {
  const Environment = KernelEnvironment as unknown as new (
    token: symbol,
    definitions: ReadonlyMap<string, unknown>,
    module: string,
  ) => KernelEnvironment;
  const definitions = new Map<string, unknown>([
    [
      "I32",
      {
        tag: "declaration",
        type: type_sort(0),
      },
    ],
    [
      "Hidden",
      {
        tag: "opaque",
        module: "secrets",
        type: type_sort(0),
        value: { tag: "constant", name: "I32" },
      },
    ],
  ]);

  assert_throws(
    () => new Environment(Symbol("forged"), definitions, "secrets"),
    "Kernel environments can only be created by checked factories.",
  );
});

Deno.test("public kernel checks reject environment-shaped forgeries", () => {
  const forged = {
    declaration() {
      return type_sort(0);
    },
    definition() {
      return { tag: "constant", name: "I32" };
    },
  } as unknown as KernelEnvironment;

  assert_throws(
    () =>
      type_equal(
        { tag: "constant", name: "Hidden" },
        { tag: "constant", name: "I32" },
        forged,
      ),
    "Kernel environment is not sealed by the kernel.",
  );
  assert_throws(
    () =>
      check_type(
        { tag: "constant", name: "forged" },
        [],
        forged,
      ),
    "Kernel environment is not sealed by the kernel.",
  );
});

Deno.test("sealed kernel environments reject lookup monkeypatching", () => {
  const environment = KernelEnvironment.empty();

  assert_throws(
    () =>
      Object.defineProperty(environment, "definition", {
        value() {
          return { tag: "constant", name: "I32" };
        },
      }),
    "object is not extensible",
  );
  assert_throws(
    () =>
      Object.defineProperty(KernelEnvironment.prototype, "definition", {
        value() {
          return { tag: "constant", name: "I32" };
        },
      }),
    "Cannot redefine property",
  );
  assert_throws(
    () =>
      check_type(
        { tag: "constant", name: "Forged" },
        [],
        environment,
      ),
    "Kernel type constant Forged requires a trusted environment.",
  );
});

Deno.test("kernel snapshots have one structural node budget", () => {
  let shared: KernelType = type_sort(0);
  for (let depth = 0; depth < 16; depth += 1) {
    shared = {
      tag: "pi",
      domain: shared,
      codomain: shared,
    };
  }

  assert_throws(
    () =>
      KernelEnvironment.from_definitions([
        {
          tag: "declaration",
          name: "Bomb",
          type: shared,
        },
      ]),
    "Kernel snapshot exceeded 20000 nodes.",
  );
  assert_throws(
    () => type_equal(shared, shared),
    "Kernel snapshot exceeded 20000 nodes.",
  );
});

Deno.test("kernel beta substitution has one structural work budget", () => {
  let body_layer: KernelType[] = [];
  let argument_layer: KernelType[] = [];
  for (let index = 0; index < 400; index += 1) {
    body_layer.push({ tag: "var", index: 1 });
    argument_layer.push(type_sort(0));
  }
  while (body_layer.length > 1) {
    const next: KernelType[] = [];
    for (let index = 0; index < body_layer.length; index += 2) {
      const left = body_layer[index];
      if (left === undefined) {
        throw new Error("Missing beta body node.");
      }
      const right = body_layer[index + 1];
      if (right === undefined) {
        next.push(left);
        continue;
      }
      next.push({ tag: "app", function: left, argument: right });
    }
    body_layer = next;
  }
  while (argument_layer.length > 1) {
    const next: KernelType[] = [];
    for (let index = 0; index < argument_layer.length; index += 2) {
      const left = argument_layer[index];
      if (left === undefined) {
        throw new Error("Missing beta argument node.");
      }
      const right = argument_layer[index + 1];
      if (right === undefined) {
        next.push(left);
        continue;
      }
      next.push({ tag: "pi", domain: left, codomain: right });
    }
    argument_layer = next;
  }
  const body = body_layer[0];
  const argument = argument_layer[0];
  if (body === undefined || argument === undefined) {
    throw new Error("Missing beta budget fixture.");
  }
  const redex: KernelType = {
    tag: "app",
    function: {
      tag: "lam",
      domain: type_sort(0),
      body: {
        tag: "lam",
        domain: type_sort(0),
        body,
      },
    },
    argument,
  };

  assert_throws(
    () => type_equal(redex, type_sort(0)),
    "Kernel normalization exceeded 100000 nodes.",
  );
});

Deno.test("kernel inference reuses checked declaration snapshots", () => {
  const environment = KernelEnvironment.from(
    new Map([["F", type_sort(0)]]),
  );
  const declaration = environment.declaration("F");
  const inferred = infer_term(
    {
      tag: "constant",
      name: "F",
      type: type_sort(0),
    },
    [],
    environment,
  );

  assert_equals(inferred === declaration, true);
});

Deno.test("kernel environments do not dispatch through Map prototypes", () => {
  const environment = KernelEnvironment.empty();
  const original_get = Map.prototype.get;
  let captured: Map<unknown, unknown> | undefined;
  Map.prototype.get = function get(key) {
    captured = this;
    return Reflect.apply(original_get, this, [key]);
  };
  try {
    assert_equals(environment.declaration("missing"), undefined);
  } finally {
    Map.prototype.get = original_get;
  }

  assert_equals(captured, undefined);
});

Deno.test("kernel environments use the captured Map constructor", () => {
  const OriginalMap = Map;
  let leaked: Map<string, unknown> | undefined;
  globalThis.Map = class CapturingMap {
    constructor() {
      leaked = new OriginalMap<string, unknown>();
      return leaked;
    }
  } as unknown as MapConstructor;
  let environment: KernelEnvironment;
  try {
    environment = KernelEnvironment.empty();
  } finally {
    globalThis.Map = OriginalMap;
  }
  if (leaked !== undefined) {
    const mutable_type = {
      tag: "sort",
      universe: { tag: "type", level: 0 },
    };
    OriginalMap.prototype.set.call(leaked, "Injected", {
      tag: "declaration",
      type: mutable_type,
    });
    mutable_type.universe.level = -1;
  }

  assert_equals(environment.declaration("Injected"), undefined);
});

Deno.test("kernel definition snapshots do not dispatch through array iterators", () => {
  const mutable_type = {
    tag: "sort" as const,
    universe: { tag: "type" as const, level: 0 },
  };
  const injected = {
    tag: "declaration" as const,
    name: "Injected",
    type: mutable_type,
  };
  const injected_sequence = [injected];
  const original_iterator = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function iterator() {
    if (Object.isFrozen(this)) {
      return Reflect.apply(original_iterator, injected_sequence, []);
    }
    return Reflect.apply(original_iterator, this, []);
  };
  let environment: KernelEnvironment;
  try {
    environment = KernelEnvironment.from_definitions([]);
  } finally {
    Array.prototype[Symbol.iterator] = original_iterator;
  }
  mutable_type.universe.level = -1;

  assert_equals(environment.declaration("Injected"), undefined);
});

Deno.test("kernel binder contexts do not dispatch through array iterators", () => {
  const leaked_context = [type_sort(0)];
  const original_iterator = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function iterator() {
    if (this.length === 0) {
      return Reflect.apply(original_iterator, leaked_context, []);
    }
    return Reflect.apply(original_iterator, this, []);
  };
  try {
    assert_throws(
      () =>
        KernelEnvironment.from_definitions([{
          tag: "transparent",
          name: "OpenBody",
          module: "m",
          type: {
            tag: "pi",
            domain: type_sort(0),
            codomain: type_sort(0),
          },
          value: {
            tag: "lam",
            domain: type_sort(0),
            body: { tag: "var", index: 1 },
          },
          total: true,
        }]),
      "Kernel type variable 1 is out of scope.",
    );
  } finally {
    Array.prototype[Symbol.iterator] = original_iterator;
  }
});

Deno.test("kernel context suffixes do not dispatch through array species", () => {
  const original_constructor = Array.prototype.constructor;
  class ForgedArray extends Array {}
  Object.defineProperty(ForgedArray, Symbol.species, {
    value: class ForgedSpecies {
      constructor() {
        return [type_sort(0)];
      }
    },
  });
  Array.prototype.constructor = ForgedArray;
  try {
    assert_throws(
      () => check_type(prop_sort, [{ tag: "var", index: 0 }]),
      "Kernel type variable 0 is out of scope.",
    );
  } finally {
    Array.prototype.constructor = original_constructor;
  }
});

Deno.test("kernel array copies do not dispatch through numeric setters", () => {
  const invalid_context: KernelType[] = [{ tag: "var", index: 0 }];
  const original_descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "0",
  );
  Object.defineProperty(Array.prototype, "0", {
    set(this: unknown[], _value: unknown) {
      Object.defineProperty(this, "0", {
        value: prop_sort,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    configurable: true,
  });
  try {
    assert_throws(
      () => infer_term({ tag: "var", index: 0 }, invalid_context),
      "Kernel type variable 0 is out of scope.",
    );
  } finally {
    if (original_descriptor === undefined) {
      Reflect.deleteProperty(Array.prototype, "0");
    } else {
      Object.defineProperty(Array.prototype, "0", original_descriptor);
    }
  }
});

Deno.test("kernel universe levels do not dispatch through Math.max", () => {
  const high_type: KernelType = {
    tag: "pi",
    domain: type_sort(5),
    codomain: type_sort(5),
  };
  const original_max = Math.max;
  Math.max = () => 0;
  try {
    assert_throws(
      () =>
        KernelEnvironment.from_definitions([{
          tag: "transparent",
          name: "BadUniverse",
          module: "m",
          type: type_sort(0),
          value: high_type,
          total: true,
        }]),
      "Kernel definition BadUniverse has an invalid value type.",
    );
  } finally {
    Math.max = original_max;
  }
});

Deno.test("de Bruijn shifts reject unsafe integer overflow", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const redex: KernelType = {
    tag: "app",
    function: {
      tag: "lam",
      domain: type_sort(0),
      body: {
        tag: "lam",
        domain: type_sort(0),
        body: {
          tag: "lam",
          domain: type_sort(0),
          body: { tag: "var", index: 2 },
        },
      },
    },
    argument: { tag: "var", index: maximum },
  };

  assert_throws(
    () => type_equal(redex, type_sort(0)),
    "Kernel type shift produced an invalid index.",
  );
  assert_throws(
    () =>
      type_equal(
        { tag: "var", index: maximum + 1 },
        { tag: "var", index: maximum + 1 },
      ),
    "Invalid type de Bruijn index",
  );
});

Deno.test("kernel conversion bounds depth composed across definitions", () => {
  const definitions: KernelDefinition[] = [];
  for (let index = 0; index < 39; index += 1) {
    let value: KernelType = prop_sort;
    if (index > 0) {
      value = { tag: "constant", name: "T" + String(index - 1) };
      for (let wrapper = 0; wrapper < 255; wrapper += 1) {
        value = {
          tag: "pi",
          domain: prop_sort,
          codomain: value,
        };
      }
    }
    definitions.push({
      tag: "transparent",
      name: "T" + String(index),
      module: "depth",
      type: type_sort(0),
      value,
      total: true,
    });
  }
  const environment = KernelEnvironment.from_definitions(definitions);
  const last: KernelType = { tag: "constant", name: "T38" };

  assert_throws(
    () => type_equal(last, last, environment),
    "Kernel conversion is too deep.",
  );
});

Deno.test("kernel context validation charges suffix-copy work", () => {
  const context: KernelType[] = [];
  for (let index = 0; index < 19_999; index += 1) {
    context.push(prop_sort);
  }

  assert_throws(
    () => check_type(prop_sort, context),
    "Kernel normalization exceeded 100000 nodes.",
  );
});

Deno.test("public definition signatures cannot depend on opaque unfolding", () => {
  assert_throws(
    () =>
      KernelEnvironment.from_definitions([
        {
          tag: "opaque",
          name: "HiddenFunctionType",
          module: "m",
          type: type_sort(2),
          value: {
            tag: "pi",
            domain: type_sort(0),
            codomain: type_sort(1),
          },
          total: true,
        },
        {
          tag: "opaque",
          name: "hiddenFunction",
          module: "m",
          type: { tag: "constant", name: "HiddenFunctionType" },
          value: {
            tag: "lam",
            domain: type_sort(0),
            body: type_sort(0),
          },
          total: true,
        },
        {
          tag: "transparent",
          name: "BrokenPublic",
          module: "m",
          type: {
            tag: "app",
            function: { tag: "constant", name: "hiddenFunction" },
            argument: prop_sort,
          },
          value: prop_sort,
          total: true,
        },
      ]),
    "Kernel type application target is not a function.",
  );
});
