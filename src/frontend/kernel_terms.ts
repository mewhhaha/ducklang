import { expect } from "../expect.ts";

export type Universe =
  | { tag: "prop" }
  | { tag: "type"; level: number };

export type KernelType =
  | { tag: "sort"; universe: Universe }
  | { tag: "var"; index: number }
  | { tag: "constant"; name: string }
  | { tag: "pi"; domain: KernelType; codomain: KernelType }
  | { tag: "app"; function: KernelType; argument: KernelType };

export type KernelTerm =
  | { tag: "var"; index: number }
  | { tag: "constant"; name: string; type: KernelType }
  | { tag: "lam"; domain: KernelType; body: KernelTerm }
  | { tag: "app"; function: KernelTerm; argument: KernelTerm };

export type KernelContext = KernelType[];
export class KernelEnvironment {
  readonly #declarations: ReadonlyMap<string, KernelType>;
  private constructor(declarations: ReadonlyMap<string, KernelType>) {
    this.#declarations = declarations;
  }
  static empty(): KernelEnvironment {
    return new KernelEnvironment(new Map());
  }
  static from(
    declarations: ReadonlyMap<string, KernelType>,
  ): KernelEnvironment {
    const snapshot = new Map<string, KernelType>();
    for (const [name, declaration] of declarations) {
      check_type(declaration);
      snapshot.set(name, snapshot_type(declaration));
    }
    return new KernelEnvironment(snapshot);
  }
  declaration(name: string): KernelType | undefined {
    return this.#declarations.get(name);
  }
}

export const prop_sort: KernelType = Object.freeze({
  tag: "sort",
  universe: Object.freeze({ tag: "prop" }),
});

export function type_sort(level: number): KernelType {
  expect(
    Number.isSafeInteger(level) && level >= 0 &&
      level < Number.MAX_SAFE_INTEGER,
    `Invalid universe level ${level}.`,
  );
  return Object.freeze({
    tag: "sort",
    universe: Object.freeze({ tag: "type", level }),
  });
}

export function universe_of_sort(universe: Universe): Universe {
  validate_universe(universe);
  if (universe.tag === "prop") {
    return { tag: "type", level: 0 };
  }
  return { tag: "type", level: universe.level + 1 };
}

export function check_type(
  type: KernelType,
  context: KernelContext = [],
): Universe {
  switch (type.tag) {
    case "sort":
      validate_universe(type.universe);
      if (type.universe.tag === "prop") return { tag: "type", level: 0 };
      return { tag: "type", level: type.universe.level + 1 };
    case "var": {
      validate_index(type.index, "type");
      const bound = context[type.index];
      expect(
        bound !== undefined,
        `Kernel type variable ${type.index} is out of scope.`,
      );
      expect(
        bound.tag === "sort" || bound.tag === "var",
        "Kernel type variable does not refer to a type.",
      );
      if (bound.tag === "sort") {
        if (bound.universe.tag === "prop") return { tag: "type", level: 0 };
        return { tag: "type", level: bound.universe.level };
      }
      return check_type(bound, context.slice(type.index + 1));
    }
    case "constant":
      throw new Error(
        `Kernel type constant ${type.name} requires a trusted environment.`,
      );
    case "app": {
      throw new Error("Kernel dependent type application is not implemented.");
    }
    case "pi": {
      const domain_universe = check_type(type.domain, context);
      const codomain_universe = check_type(type.codomain, [
        type.domain,
        ...context,
      ]);
      return max_universe(domain_universe, codomain_universe);
    }
    default:
      throw new Error("Invalid kernel type tag.");
  }
}

export function infer_term(
  term: KernelTerm,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): KernelType {
  validate_context(context);
  switch (term.tag) {
    case "var": {
      validate_index(term.index, "term");
      const type = context[term.index];
      expect(
        type !== undefined,
        `Kernel variable ${term.index} is out of scope.`,
      );
      return snapshot_type(type);
    }
    case "constant": {
      const declared = environment.declaration(term.name);
      expect(
        declared !== undefined,
        `Kernel constant ${term.name} requires a trusted environment.`,
      );
      expect(
        type_equal(term.type, declared),
        `Kernel constant ${term.name} has an invalid declared type.`,
      );
      return snapshot_type(declared);
    }
    case "lam":
      check_type(term.domain, context);
      return snapshot_type({
        tag: "pi",
        domain: term.domain,
        codomain: infer_term(term.body, [term.domain, ...context], environment),
      });
    case "app": {
      const function_type = infer_term(term.function, context, environment);
      expect(
        function_type.tag === "pi",
        "Kernel application target is not a function.",
      );
      const argument_type = infer_term(term.argument, context, environment);
      expect(
        type_assignable(argument_type, function_type.domain, context),
        "Kernel application argument has an invalid type.",
      );
      expect(
        !contains_bound_variable(function_type.codomain),
        "Kernel dependent application requires term substitution.",
      );
      return snapshot_type(drop_bound_variable(function_type.codomain));
    }
    default:
      throw new Error("Invalid kernel term tag.");
  }
}

export function check_term(
  term: KernelTerm,
  expected: KernelType,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): void {
  validate_context(context);
  check_type(expected, context);
  const actual = infer_term(term, context, environment);
  expect(
    type_assignable(actual, expected, context),
    "Kernel term does not have the expected type.",
  );
}

export function type_equal(left: KernelType, right: KernelType): boolean {
  validate_type_shape(left);
  validate_type_shape(right);
  const normalized_left = whnf_type(left, []);
  const normalized_right = whnf_type(right, []);
  if (normalized_left.tag !== normalized_right.tag) return false;
  switch (normalized_left.tag) {
    case "sort":
      return universe_equal(
        normalized_left.universe,
        (normalized_right as Extract<KernelType, { tag: "sort" }>).universe,
      );
    case "var":
      return normalized_left.index ===
        (normalized_right as Extract<KernelType, { tag: "var" }>).index;
    case "constant":
      return normalized_left.name ===
        (normalized_right as Extract<KernelType, { tag: "constant" }>).name;
    case "pi": {
      const other = normalized_right as Extract<KernelType, { tag: "pi" }>;
      return type_equal(normalized_left.domain, other.domain) &&
        type_equal(normalized_left.codomain, other.codomain);
    }
    case "app": {
      const other = normalized_right as Extract<KernelType, { tag: "app" }>;
      return type_equal(normalized_left.function, other.function) &&
        type_equal(normalized_left.argument, other.argument);
    }
  }
}

export function type_assignable(
  actual: KernelType,
  expected: KernelType,
  context: KernelContext = [],
): boolean {
  check_type(actual, context);
  check_type(expected, context);
  if (type_equal(actual, expected)) return true;
  if (actual.tag !== "sort" || expected.tag !== "sort") return false;
  if (actual.universe.tag !== "type" || expected.universe.tag !== "type") {
    return false;
  }
  return actual.universe.level <= expected.universe.level;
}

function validate_universe(universe: Universe): void {
  if (universe.tag === "prop") return;
  expect(
    universe.tag === "type",
    `Invalid universe tag ${String((universe as { tag?: unknown }).tag)}.`,
  );
  expect(
    Number.isSafeInteger(universe.level) && universe.level >= 0 &&
      universe.level < Number.MAX_SAFE_INTEGER,
    `Invalid universe level ${universe.level}.`,
  );
}

function validate_index(index: number, kind: string): void {
  expect(
    Number.isInteger(index) && index >= 0,
    `Invalid ${kind} de Bruijn index ${String(index)}.`,
  );
}

function validate_context(context: KernelContext): void {
  for (let index = 0; index < context.length; index += 1) {
    const type = context[index];
    expect(type !== undefined, `Kernel context entry ${index} is missing.`);
    check_type(type, context.slice(index + 1));
  }
}

function whnf_type(type: KernelType, _context: KernelContext): KernelType {
  return type;
}

function universe_equal(left: Universe, right: Universe): boolean {
  if (left.tag !== right.tag) return false;
  if (left.tag === "prop") return true;
  return left.level === (right as Extract<Universe, { tag: "type" }>).level;
}

function max_universe(left: Universe, right: Universe): Universe {
  if (left.tag === "prop") return right;
  if (right.tag === "prop") return left;
  return { tag: "type", level: Math.max(left.level, right.level) };
}

function snapshot_type(
  type: KernelType,
  seen = new WeakSet<object>(),
): KernelType {
  if (seen.has(type)) throw new Error("Kernel type graph must be acyclic.");
  seen.add(type);
  let snapshot: KernelType;
  switch (type.tag) {
    case "sort":
      if (type.universe.tag === "prop") {
        snapshot = prop_sort;
      } else {
        snapshot = type_sort(type.universe.level);
      }
      break;
    case "var":
      snapshot = Object.freeze({ tag: "var", index: type.index });
      break;
    case "constant":
      snapshot = Object.freeze({ tag: "constant", name: type.name });
      break;
    case "pi":
      snapshot = Object.freeze({
        tag: "pi",
        domain: snapshot_type(type.domain, seen),
        codomain: snapshot_type(type.codomain, seen),
      });
      break;
    case "app":
      snapshot = Object.freeze({
        tag: "app",
        function: snapshot_type(type.function, seen),
        argument: snapshot_type(type.argument, seen),
      });
      break;
  }
  seen.delete(type);
  return snapshot;
}

function validate_type_shape(
  type: KernelType,
  seen = new WeakSet<object>(),
): void {
  expect(type !== null && typeof type === "object", "Invalid kernel type.");
  if (seen.has(type)) throw new Error("Kernel type graph must be acyclic.");
  seen.add(type);
  switch (type.tag) {
    case "sort":
      validate_universe(type.universe);
      break;
    case "var":
      validate_index(type.index, "type");
      break;
    case "constant":
      expect(type.name.length > 0, "Kernel constant name must not be empty.");
      break;
    case "pi":
      validate_type_shape(type.domain, seen);
      validate_type_shape(type.codomain, seen);
      break;
    case "app":
      validate_type_shape(type.function, seen);
      validate_type_shape(type.argument, seen);
      break;
    default:
      throw new Error("Invalid kernel type tag.");
  }
  seen.delete(type);
}

function contains_bound_variable(type: KernelType, depth = 0): boolean {
  switch (type.tag) {
    case "sort":
    case "constant":
      return false;
    case "var":
      return type.index === depth;
    case "pi":
      return contains_bound_variable(type.domain, depth) ||
        contains_bound_variable(type.codomain, depth + 1);
    case "app":
      return contains_bound_variable(type.function, depth) ||
        contains_bound_variable(type.argument, depth);
    default:
      throw new Error("Invalid kernel type tag.");
  }
}

function drop_bound_variable(type: KernelType, depth = 0): KernelType {
  switch (type.tag) {
    case "sort":
    case "constant":
      return type;
    case "var":
      if (type.index <= depth) return type;
      return { tag: "var", index: type.index - 1 };
    case "pi":
      return {
        tag: "pi",
        domain: drop_bound_variable(type.domain, depth),
        codomain: drop_bound_variable(type.codomain, depth + 1),
      };
    case "app":
      return {
        tag: "app",
        function: drop_bound_variable(type.function, depth),
        argument: drop_bound_variable(type.argument, depth),
      };
    default:
      throw new Error("Invalid kernel type tag.");
  }
}
