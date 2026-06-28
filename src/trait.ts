export type Format<self> = {
  fmt: (value: self) => string;
};

export function Format() {}

Format.fmt = function fmt<self>(
  impl: Format<self>,
  value: self,
): string {
  return impl.fmt(value);
};

export type Emit<from, to> = {
  emit: (value: from) => to;
};

export function Emit() {}

Emit.emit = function emit<from, to>(
  impl: Emit<from, to>,
  value: from,
): to {
  return impl.emit(value);
};

export type CallableType<type> = {
  args: type[];
  result: type;
};

export type Callable<self, type> = {
  arity: (value: self) => number;
  type: (value: self) => CallableType<type>;
};

export function Callable() {}

Callable.arity = function arity<self, type>(
  impl: Callable<self, type>,
  value: self,
): number {
  return impl.arity(value);
};

Callable.type = function type<self, type>(
  impl: Callable<self, type>,
  value: self,
): CallableType<type> {
  return impl.type(value);
};

export type Reduce<ctx, from, to> = {
  reduce: (ctx: ctx, value: from) => to;
};

export function Reduce() {}

Reduce.reduce = function reduce<ctx, from, to>(
  impl: Reduce<ctx, from, to>,
  ctx: ctx,
  value: from,
): to {
  return impl.reduce(ctx, value);
};
