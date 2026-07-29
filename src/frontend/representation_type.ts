export type RepresentationScalar =
  | "Bool"
  | "Char"
  | "Unit"
  | "Int"
  | "I32"
  | "U32"
  | "I64"
  | "F32"
  | "F64"
  | "F32x4"
  | "Text"
  | "Bytes"
  | "Resume"
  | "Type";

export type RepresentationOwnership =
  | "scalar"
  | "bounded_borrow"
  | "frozen_shareable"
  | "ownership_transfer"
  | "unique_heap";

export type RepresentationEffect = {
  effect: string;
  operation: string | undefined;
};

export type RepresentationType =
  | { tag: "variable"; id: number; hint: string | undefined }
  | { tag: "rigid"; id: number; name: string }
  | {
    tag: "forall";
    quantified_variables: readonly number[];
    body: RepresentationType;
  }
  | { tag: "top" }
  | { tag: "never" }
  | { tag: "scalar"; name: RepresentationScalar }
  | { tag: "integer"; signed: boolean; width: number }
  | { tag: "named"; name: string; args: readonly RepresentationType[] }
  | { tag: "product"; fields: readonly RepresentationProductField[] }
  | { tag: "record"; fields: readonly RepresentationRecordField[] }
  | {
    tag: "fixed_array";
    length: number;
    element: RepresentationType;
  }
  | { tag: "sum"; cases: readonly RepresentationSumCase[] }
  | {
    tag: "function";
    params: readonly RepresentationType[];
    effects: readonly RepresentationEffect[];
    result: RepresentationType;
  }
  | {
    tag: "owned";
    ownership: RepresentationOwnership;
    value: RepresentationType;
  }
  | { tag: "type_value"; represented: RepresentationType }
  | { tag: "union"; members: readonly RepresentationType[] }
  | { tag: "intersection"; members: readonly RepresentationType[] }
  | {
    tag: "difference";
    base: RepresentationType;
    removed: RepresentationType;
  };

export type RepresentationProductField = {
  label: string | undefined;
  type: RepresentationType;
};

export type RepresentationRecordField = {
  label: string;
  type: RepresentationType;
};

export type RepresentationSumCase = {
  label: string;
  payload: RepresentationType;
};
