import { expect } from "../expect.ts";
import type { Binding, Env } from "./ast.ts";

export function create_env(): Env {
  return { scopes: [new Map()], next: new Map() };
}

export function clone_env(env: Env): Env {
  return {
    scopes: env.scopes.map((scope) => new Map(scope)),
    next: new Map(env.next),
  };
}

export function lookup(env: Env, name: string): Binding | undefined {
  for (let index = env.scopes.length - 1; index >= 0; index -= 1) {
    const scope = env.scopes[index];
    expect(scope, "Missing scope " + index);
    const binding = scope.get(name);

    if (binding) {
      return binding;
    }
  }

  return undefined;
}

export function push_binding(env: Env, binding: Binding): void {
  const scope = env.scopes[env.scopes.length - 1];
  expect(scope, "Missing current scope");
  scope.set(binding.name, binding);
}

export function fresh(env: Env, name: string): string {
  const current = env.next.get(name);
  let next = 0;

  if (current !== undefined) {
    next = current;
  }

  env.next.set(name, next + 1);
  return name + "#" + next.toString();
}
