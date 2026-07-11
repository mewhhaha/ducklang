export function is_digit(char: string): boolean {
  return char >= "0" && char <= "9";
}

export function is_name_start(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") ||
    char === "_";
}

export function is_name_continue(char: string): boolean {
  return is_name_start(char) || is_digit(char);
}

export function is_snake_case(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

export function expect_snake_case(name: string, label: string): void {
  if (!is_snake_case(name)) {
    throw new Error(label + " must use snake_case: " + name);
  }
}

export function expect_const_binding_name(name: string): void {
  expect_snake_case(name, "Const binding");
}

const no_demand_prefix = "@no_demand_";

export function no_demand_name(index: number): string {
  return no_demand_prefix + index.toString();
}

export function is_no_demand_name(name: string): boolean {
  return name.startsWith(no_demand_prefix);
}

export function format_binding_name(name: string): string {
  if (is_no_demand_name(name)) {
    return "_";
  }

  return name;
}
