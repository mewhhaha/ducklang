export type Format<self> = {
  fmt: (value: self) => string;
};

export type Emit<from, to> = {
  emit: (value: from) => to;
};

export type Reduce<self> = {
  reduce: (value: self) => self;
};
