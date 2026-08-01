import { assert_equals, assert_throws } from "../assert.ts";
import { analyze_front_effects } from "./effect_analysis.ts";
import { parse_source } from "./parser.ts";

Deno.test("effect analysis infers direct and forwarded operation rows", () => {
  const source = parse_source(`
module (!init: Init) where
declare effect Io {
  read: () => Text
  print: (&Text) => Unit
}
declare Init { io: Io }

let read_name = () => do
  name <- Io.read()
  name
end;

let greet = () => do
  name <- read_name();
  _ <- Io.print(&name)
end;

_ <- greet()
return {};
`);

  assert_equals(analyze_front_effects(source), {
    module_effects: [
      { effect: "Io", operation: "print" },
      { effect: "Io", operation: "read" },
    ],
    functions: {
      read_name: {
        name: "read_name",
        effects: [{ effect: "Io", operation: "read" }],
        annotated: false,
      },
      greet: {
        name: "greet",
        effects: [
          { effect: "Io", operation: "print" },
          { effect: "Io", operation: "read" },
        ],
        annotated: false,
      },
    },
  });
});

Deno.test("effect analysis enforces rows and infers unannotated functions", () => {
  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
declare effect Io { read: () => Text, print: (Text) => Unit }
let bad: () -> <Io.read> Unit = () => do
  _ <- Io.print("hello")
end;
bad
`)),
    "does not allow Io.print",
  );

  const inferred = analyze_front_effects(parse_source(`
declare effect Io { read: () => Text }
let read_name = () => do
  name <- Io.read()
  name
end;
let pure = () => read_name();
pure
`));

  assert_equals(inferred.functions.pure, {
    name: "pure",
    effects: [{ effect: "Io", operation: "read" }],
    annotated: false,
  });
});

Deno.test("effect analysis requires declared effect qualifiers", () => {
  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
declare effect File { read: () => Text }
declare effect Io { read: () => Text }
let read = () => do
  value <- Fx.read()
  value
end;
read
`)),
    "Effect bind must call a declared effect operation",
  );

  const qualified = analyze_front_effects(parse_source(`
declare effect File { read: () => Text }
declare effect Io { read: () => Text }
let read = () => do
  value <- Io.read()
  value
end;
read
`));
  assert_equals(qualified.functions.read?.effects, [
    { effect: "Io", operation: "read" },
  ]);
});

Deno.test("effect analysis discharges Duck operations through handler factories", () => {
  const analysis = analyze_front_effects(parse_source(`
effect Counter { get: () => I32, add: (I32) => Unit }

let run = () => do
  value <- Counter.get()
  _ <- Counter.add(1)
  value
end;

let counter = () => do
  let count = 0;
  handler Counter {
    get: (!resume) => !resume(count),
    add: (amount, !resume) => do
      count = count + amount
      !resume(())
    end,
    return: (value) => value
  }
end;

try run() with counter()
`));

  assert_equals(analysis.module_effects, []);
  assert_equals(analysis.functions.run?.effects, [
    { effect: "Counter", operation: "add" },
    { effect: "Counter", operation: "get" },
  ]);
});

Deno.test("effect analysis forwards partial handlers and keeps clauses deep", () => {
  const analysis = analyze_front_effects(parse_source(`
effect Counter { get: () => I32, add: (I32) => Unit }

let run = () => do
  value <- Counter.get()
  _ <- Counter.add(value)
end;

let inner = () => handler Counter {
    get: (!resume) => do
      _ <- Counter.add(1)
      !resume(0)
    end,
    return: (value) => value
};

let outer = () => handler Counter {
    add: (amount, !resume) => !resume(()),
    return: (value) => value
};

try (try run() with inner()) with outer()
`));

  assert_equals(analysis.module_effects, []);
  assert_equals(analysis.functions.inner, undefined);

  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32, add: (I32) => Unit }
let run = () => do
  value <- Counter.get()
  _ <- Counter.add(value)
end;
let inner = () => handler Counter {
    get: (!resume) => do
      _ <- Counter.add(1)
      !resume(0)
    end,
    return: (value) => value
};
try run() with inner()
`)),
    "Unresolved Duck effect at module boundary: Counter.add",
  );
});

Deno.test("effect analysis exposes handler clause host dependencies", () => {
  const analysis = analyze_front_effects(parse_source(`
declare effect Io { print: (Text) => Unit }
effect Counter { get: () => I32 }

let run = () => do
  value <- Counter.get()
  value
end;

let counter = () => handler Counter {
    get: (!resume) => do
      _ <- Io.print("get")
      !resume(0)
    end,
    return: (value) => value
};

try run() with counter()
`));

  assert_equals(analysis.module_effects, [
    { effect: "Io", operation: "print" },
  ]);
});

Deno.test("effect analysis rejects invalid handler declarations", () => {
  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
declare effect Io { read: () => I32 }
handler Io {
    read: (!resume) => !resume(0),
    return: (value) => value
}
`)),
    "Cannot handle host-declared effect: Io",
  );

  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
handler Counter {
    missing: (!resume) => !resume(0),
    return: (value) => value
}
`)),
    "Unknown handler clause: Counter.missing",
  );

  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
handler Counter {
    get: (!resume) => !resume(0),
    get: (!again) => !again(1),
    return: (value) => value
}
`)),
    "Duplicate handler clause: Counter.get",
  );
});

Deno.test("effect analysis enforces pure stable handler state", () => {
  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
declare effect Io { read: () => I32 }
effect Counter { get: () => I32 }
let read = () => do
  value <- Io.read()
  value
end;
let counter = () => do
  let count = read();
  handler Counter {
    get: (!resume) => !resume(count),
    return: (value) => value
  }
end;
counter
`)),
    "Handler state initializer must be pure: count; calls Io.read",
  );

  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
do
  let count = 0;
  handler Counter {
    get: (!resume) => do
      count := "one"
      !resume(0)
    end,
    return: (value) => value
  }
end
`)),
    "Handler state cannot change type with := count",
  );

  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
do
  let count = 0;
  handler Counter {
    get: (!resume) => do
      count = "one"
      !resume(0)
    end,
    return: value => value,
  }
end
`)),
    "Handler state count expects I32, got Text",
  );
});

Deno.test("effect analysis checks resumption input types", () => {
  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
handler Counter {
  get: (!resume) => !resume("wrong"),
  return: value => value,
}
`)),
    "Resumption resume expects I32, got Text",
  );

  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
handler Counter {
  get: (!resume) => "wrong output",
  return: value => 0,
}
`)),
    "Handler clause Counter.get returns Text, expected I32",
  );
});

Deno.test("effect analysis rejects unresolved Duck operations at the root", () => {
  assert_throws(
    () =>
      analyze_front_effects(parse_source(`
effect Counter { get: () => I32 }
let run = () => do
  value <- Counter.get()
  value
end;
run()
`)),
    "Unresolved Duck effect at module boundary: Counter.get",
  );
});
