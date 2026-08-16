export type AbiPrimitiveKind =
  | "i32"
  | "i64"
  | "f32"
  | "f64"
  | "unit"
  | "text"
  | "bytes"
  | "i32_slice"
  | "text_slice";

export type AbiPrimitiveClassification =
  | { tag: "supported"; kind: AbiPrimitiveKind }
  | { tag: "unsupported"; message: string }
  | { tag: "unknown" };

export function classify_abi_primitive(
  name: string,
): AbiPrimitiveClassification {
  const integer = /^[IU]([1-9][0-9]*)$/.exec(name);
  const width = integer?.[1];
  if (width !== undefined) {
    const bits = BigInt(width);
    if (bits <= 32n) return { tag: "supported", kind: "i32" };
    if (bits <= 64n) return { tag: "supported", kind: "i64" };
    return {
      tag: "unsupported",
      message: "Gpufuck ABI cannot expose wide integer values directly: " +
        name,
    };
  }
  if (name === "F32x4") {
    return {
      tag: "unsupported",
      message: "Gpufuck ABI cannot expose F32x4 values",
    };
  }
  if (name === "Resume") {
    return {
      tag: "unsupported",
      message: "Gpufuck ABI cannot expose Resume values",
    };
  }
  if (name === "Type") {
    return {
      tag: "unsupported",
      message: "Gpufuck ABI cannot expose Type values",
    };
  }
  if (
    name === "Bool" || name === "Char" || name === "Int" ||
    name === "I32" || name === "U32"
  ) {
    return { tag: "supported", kind: "i32" };
  }
  if (name === "I64") return { tag: "supported", kind: "i64" };
  if (name === "F32") return { tag: "supported", kind: "f32" };
  if (name === "F64") return { tag: "supported", kind: "f64" };
  if (name === "Unit") return { tag: "supported", kind: "unit" };
  if (name === "Text") return { tag: "supported", kind: "text" };
  if (name === "Bytes") return { tag: "supported", kind: "bytes" };
  if (name === "I32Slice") {
    return { tag: "supported", kind: "i32_slice" };
  }
  if (name === "TextSlice") {
    return { tag: "supported", kind: "text_slice" };
  }
  return { tag: "unknown" };
}
