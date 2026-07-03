import { expect } from "../expect.ts";

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
