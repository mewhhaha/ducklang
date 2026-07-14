import { expect } from "../expect.ts";
import type { Field, FrontExpr } from "./ast.ts";
import type { ComptimeType, ComptimeTypeField } from "./comptime_value.ts";
import { fixed_array_length } from "./fixed_array_type.ts";
import { layout_type } from "./layout.ts";
import { i32_expr } from "./numeric.ts";

type ComptimeLayout = {
  size: number;
  align: number;
  stride: number;
  offsets: number[];
  payload_offset: number | undefined;
};

export function describe_comptime_type(type: ComptimeType): FrontExpr {
  const layout = comptime_type_layout(type);
  let name = "";
  let length = -1;
  let element: FrontExpr = { tag: "unit" };

  if (
    type.tag === "scalar" || type.tag === "named" || type.tag === "atom"
  ) {
    name = type.name;
  }

  if (type.tag === "array") {
    length = fixed_array_length(type.length);
    element = type.element.source;
  }

  return object_expr([
    { name: "kind", value: { tag: "atom", name: type.tag } },
    { name: "name", value: { tag: "text", value: name } },
    { name: "size", value: i32_expr(layout.size) },
    { name: "align", value: i32_expr(layout.align) },
    { name: "stride", value: i32_expr(layout.stride) },
    { name: "length", value: i32_expr(length) },
    { name: "element", value: element },
    { name: "fields", value: describe_comptime_fields(type) },
    { name: "cases", value: describe_comptime_cases(type) },
  ]);
}

export function describe_comptime_fields(type: ComptimeType): FrontExpr {
  let fields: ComptimeTypeField[] = [];

  if (type.tag === "record") {
    fields = type.fields;
  } else if (type.tag === "product") {
    fields = type.entries;
  } else if (type.tag === "tuple") {
    fields = type.items.map((item) => ({
      name: undefined,
      type: item,
      source: item.source,
    }));
  } else {
    return { tag: "array", items: [], rest: undefined };
  }

  const layout = comptime_type_layout(type);
  return {
    tag: "array",
    items: fields.map((field, index) =>
      field_descriptor(field, index, layout.offsets[index])
    ),
    rest: undefined,
  };
}

export function describe_comptime_cases(type: ComptimeType): FrontExpr {
  if (type.tag !== "sum") {
    return { tag: "array", items: [], rest: undefined };
  }

  const layout = comptime_type_layout(type);
  const payload_offset = layout.payload_offset;
  expect(payload_offset !== undefined, "Missing sum payload offset");
  return {
    tag: "array",
    items: type.cases.map((union_case, index) =>
      case_descriptor(type.source, union_case, index, payload_offset)
    ),
    rest: undefined,
  };
}

function field_descriptor(
  field: ComptimeTypeField,
  index: number,
  offset: number | undefined,
): FrontExpr {
  expect(offset !== undefined, "Missing compile-time field offset " + index);
  let name = "";

  if (field.name !== undefined) {
    name = field.name;
  }

  return object_expr([
    { name: "kind", value: { tag: "atom", name: "field" } },
    { name: "name", value: { tag: "text", value: name } },
    { name: "index", value: i32_expr(index) },
    { name: "offset", value: i32_expr(offset) },
    { name: "type", value: field.source },
  ]);
}

function case_descriptor(
  owner: FrontExpr,
  union_case: ComptimeTypeField,
  index: number,
  offset: number,
): FrontExpr {
  expect(union_case.name !== undefined, "Missing compile-time case name");
  return object_expr([
    { name: "kind", value: { tag: "atom", name: "case" } },
    { name: "name", value: { tag: "text", value: union_case.name } },
    { name: "index", value: i32_expr(index) },
    { name: "tag", value: i32_expr(index) },
    { name: "offset", value: i32_expr(offset) },
    { name: "type", value: union_case.source },
    { name: "owner", value: owner },
  ]);
}

function object_expr(fields: Field[]): FrontExpr {
  return {
    tag: "struct_value",
    type_expr: { tag: "var", name: "object_type" },
    fields,
  };
}

function comptime_type_layout(type: ComptimeType): ComptimeLayout {
  if (type.tag === "scalar") {
    const layout = layout_type({ tag: "type_name", name: type.name });
    return {
      size: layout.size,
      align: layout.align,
      stride: layout.size,
      offsets: [],
      payload_offset: undefined,
    };
  }

  if (type.tag === "atom") {
    return scalar_layout(4, 4);
  }

  if (type.tag === "frozen" || type.tag === "borrow") {
    return comptime_type_layout(type.value);
  }

  if (type.tag === "record") {
    return aggregate_layout(type.fields.map((field) => field.type));
  }

  if (type.tag === "product") {
    return aggregate_layout(type.entries.map((entry) => entry.type));
  }

  if (type.tag === "tuple") {
    return aggregate_layout(type.items);
  }

  if (type.tag === "array") {
    const element = comptime_type_layout(type.element);
    const length = fixed_array_length(type.length);
    const size = checked_multiply(element.stride, length, "fixed array size");
    return {
      size,
      align: element.align,
      stride: element.stride,
      offsets: [],
      payload_offset: undefined,
    };
  }

  if (type.tag === "sum") {
    let payload_size = 0;
    let align = 4;

    for (const union_case of type.cases) {
      const payload = comptime_type_layout(union_case.type);

      if (payload.size > payload_size) {
        payload_size = payload.size;
      }

      if (payload.align > align) {
        align = payload.align;
      }
    }

    const payload_offset = align_to(4, align);
    const size = align_to(payload_offset + payload_size, align);
    return {
      size,
      align,
      stride: size,
      offsets: [],
      payload_offset,
    };
  }

  throw new Error(
    "Compile-time layout is unavailable for type kind " + type.tag,
  );
}

function aggregate_layout(types: ComptimeType[]): ComptimeLayout {
  const offsets: number[] = [];
  let size = 0;
  let align = 1;

  for (const type of types) {
    const field = comptime_type_layout(type);
    size = align_to(size, field.align);
    offsets.push(size);
    size += field.size;

    if (field.align > align) {
      align = field.align;
    }
  }

  size = align_to(size, align);
  return { size, align, stride: size, offsets, payload_offset: undefined };
}

function scalar_layout(size: number, align: number): ComptimeLayout {
  return { size, align, stride: size, offsets: [], payload_offset: undefined };
}

function align_to(value: number, align: number): number {
  return Math.ceil(value / align) * align;
}

function checked_multiply(left: number, right: number, label: string): number {
  const value = left * right;

  if (!Number.isSafeInteger(value)) {
    throw new Error(label + " exceeds the safe integer range");
  }

  return value;
}
