/** Apply a transform only when the value is present, keeping absence as-is. */
export function map_defined<value, result>(
  value: value | undefined,
  transform: (value: value) => result,
): result | undefined {
  if (value === undefined) {
    return undefined;
  }

  return transform(value);
}
