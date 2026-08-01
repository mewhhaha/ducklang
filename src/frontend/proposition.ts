import type { KernelTerm, KernelType } from "./kernel_terms.ts";

export type Proposition =
  | { tag: "true" }
  | { tag: "false" }
  | { tag: "atom"; name: string; arguments: readonly KernelTerm[] }
  | {
    tag: "equal";
    type: KernelType;
    left: KernelTerm;
    right: KernelTerm;
  }
  | { tag: "and"; left: Proposition; right: Proposition }
  | { tag: "or"; left: Proposition; right: Proposition }
  | { tag: "implies"; premise: Proposition; conclusion: Proposition }
  | { tag: "not"; proposition: Proposition }
  | { tag: "forall"; domain: KernelType; body: Proposition }
  | { tag: "exists"; domain: KernelType; body: Proposition };
