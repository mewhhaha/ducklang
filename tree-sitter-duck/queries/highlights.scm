; General identifiers. More specific patterns below override this fallback.
(identifier) @variable
(effect_identifier) @type
(effect_statement parameter: (identifier) @type.parameter)

; Keywords
[
  "handler"
  "module"
  "where"
] @keyword

[
  "import"
  "include"
] @keyword.control.import

; `and` joins a mutual binding group, so it belongs with the binding keywords.
[
  "let"
  "const"
  "and"
] @keyword.storage

[
  "open"
  "suspending"
] @keyword.storage.modifier

[
  "declare"
  "effect"
  "struct"
  "newtype"
  "packed"
  "type"
  "union"
  "duck"
  "extend"
] @keyword.storage.type

"forall" @keyword

(forall_type
  parameter: (identifier) @type.parameter)

(effect_operation_forall
  parameter: (identifier) @type.parameter)

[
  "infixl"
  "infixr"
  "infix"
  "prefix"
] @keyword.directive

; `rec` changes how a binding evaluates rather than naming a function, so it
; sits in the plain keyword bucket with `return` and `break` rather than under
; keyword.function, which themes colour like a definition.
"rec" @keyword

(try_with_expression
  ["try" "with"] @keyword.control.exception)

(as_keyword) @keyword.operator

[
  "if"
  "then"
  "else"
  "case"
  "of"
] @keyword.control.conditional

; Block delimiters. These carry the shape of the code, so they get the plain
; control scope rather than the operator scope `do` had when it was the unary
; effect keyword.
[
  "do"
  "end"
] @keyword.control

[
  "for"
  "loop"
  "in"
  "by"
] @keyword.control.repeat

; Capture the keyword token, not the statement node. `(break_statement)` spans
; `break … ;`, so the terminator inherited the keyword colour.
[
  "return"
  "break"
  "continue"
] @keyword.control.return

(wildcard) @variable.builtin

[
  "dup"
  "freeze"
  "scratch"
  "is"
] @keyword.operator

"comptime" @keyword.directive

; `perform` lifts a value into the effect context. It was spelled `do` until
; `do` became the block opener.
"perform" @keyword.operator

[
  "scalar"
] @keyword.storage.modifier

; Operators and punctuation
[
  "="
  ":="
  "=>"
  "..."
  "->"
  ".."
  "..="
  "<-"
  "|"
  "&"
  ":|"
  ":&"
  ":-"
  (operator_symbol)
] @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  ";"
  ":"
  "."
  "#"
  "@"
] @punctuation.delimiter

; Literals and comments
(number) @constant.numeric.integer
(string) @string
(template_start) @string
(template_text) @string
(template_literal "`" @string)
(template_interpolation
  ["{" "}"] @punctuation.special)
(character) @constant.character
(boolean) @constant.builtin.boolean
(atom_expression
  name: (identifier) @constant)
(atom_type
  name: (identifier) @constant)
(comment) @comment.line

; Types
(type_difference
  (identifier) @type)

(type_application
  constructor: (identifier) @type
  argument: (identifier) @type)

(frozen_type
  name: (identifier) @type)

(borrow_type
  (identifier) @type)

(top_type) @type.builtin

(row_variable) @type.parameter

((identifier) @type.builtin
  (#any-of? @type.builtin
    "Bool" "Int" "I32" "U32" "I64" "Text" "Bytes" "Unit" "Type" "Resume" "Never"))

(declare_effect_statement
  name: (effect_identifier) @type)

(effect_statement
  name: (effect_identifier) @type)

(declare_record_statement
  name: (identifier) @type)

(type_declaration_statement
  name: (identifier) @type
  parameter: (identifier) @type.parameter)

(duck_declaration_statement
  name: (identifier) @type
  role: (identifier) @type.parameter)

(duck_member
  name: (identifier) @function.method)

(extension_declaration_statement
  type: (identifier) @type)

(fixity_declaration_statement
  target: (fixity_target) @function)

(type_case
  name: (constructor_identifier) @constructor)

(named_type_field
  name: (identifier) @variable.other.member)

(shape_field
  name: (identifier) @variable.other.member)

(effect_operation_reference
  effect: (effect_identifier) @type
  operation: (identifier) @function.method)

(effect_family_reference
  effect: (effect_identifier) @type)

(effect_handler_expression
  effect: (effect_identifier) @constructor)

; Bindings and parameters
(binding_statement
  name: (identifier) @variable)

(effect_binding_statement
  name: (identifier) @variable)

(binding_statement
  name: (named_shape_pattern
    (named_shape_pattern_field
      name: (identifier) @variable
      !pattern)))

(arrow_function
  parameters: (named_shape_pattern
    (named_shape_pattern_field
      name: (identifier) @variable.parameter
      !pattern)))

(named_shape_pattern_field
  name: (identifier) @variable.other.member)

(binding_statement
  name: (identifier) @function
  value: [(arrow_function) (recursive_function)])

(parameter
  name: (identifier) @variable.parameter)

(recursive_function
  parameters: (identifier) @variable.parameter)

(assignment
  name: (identifier) @variable.mutable)

(index_assignment
  name: (identifier) @variable.mutable)

(for_statement
  first: (identifier) @variable)

(for_statement
  second: (identifier) @variable)

(union_pattern
  value: (identifier) @variable)

(linear_reference
  name: (identifier) @variable)

(atom_expression
  name: (identifier) @constant)

(resume_dup_statement
  left: (identifier) @variable)

(resume_dup_statement
  right: (identifier) @variable)

; Imports, functions, effects, and calls
(import_expression
  path: (string) @string.special.path)

(import_meta_expression "meta" @variable.builtin)

(include_expression
  path: (string) @string.special.path)

(intrinsic_identifier) @function.builtin

(module_binding_statement
  name: (identifier) @namespace)

(effect_operation
  name: (identifier) @function.method)

(handler_operation_clause
  name: (identifier) @function.method)

; A call site is `function.call`, distinct from the `function` of a definition
; above. Themes routinely give the two different colours, and collapsing them
; put every application in the same colour as the keywords.
(application_expression
  function: (postfix_expression
    (identifier) @function.call))

(condition_call_expression
  function: (condition_expression
    (identifier) @function.call))

(application_expression
  function: (postfix_expression
    (linear_reference
      name: (identifier) @function.call)))

(condition_call_expression
  function: (condition_expression
    (linear_reference
      name: (identifier) @function.call)))

((application_expression
  function: (postfix_expression
    (identifier) @function.builtin))
  (#any-of? @function.builtin
    "len" "get" "slice" "append" "has" "fields_of" "cases_of"
    "is_struct" "is_union" "size_of" "align_of" "layout" "fail" "panic"))

((condition_call_expression
  function: (condition_expression
    (identifier) @function.builtin))
  (#any-of? @function.builtin
    "len" "get" "slice" "append" "has" "fields_of" "cases_of"
    "is_struct" "is_union" "size_of" "align_of" "layout" "fail" "panic"))

; Members and constructors
(field_expression
  field: (identifier) @variable.other.member)

(condition_field_expression
  field: (identifier) @variable.other.member)

(shorthand_field
  name: (identifier) @variable.other.member)

(type_field
  name: (identifier) @variable.other.member)

(union_case
  case: (constructor_identifier) @constructor)

(union_pattern
  case: (constructor_identifier) @constructor)

; A member in call position is a method. Keep these after the general member
; patterns so they win for the same identifier span.
(application_expression
  function: (postfix_expression
    (field_expression
      field: (identifier) @function.method.call)))

(condition_call_expression
  function: (condition_expression
    (condition_field_expression
      field: (identifier) @function.method.call)))
