(binding_statement
  name: (identifier) @name
  value: [(arrow_function) (recursive_function)] @definition.function)

(module_binding_statement name: (identifier) @name) @definition.module
(declare_effect_statement name: (effect_identifier) @name) @definition.type
(effect_statement name: (effect_identifier) @name) @definition.type
(declare_record_statement name: (identifier) @name) @definition.type
(type_declaration_statement name: (identifier) @name) @definition.type
(duck_declaration_statement name: (identifier) @name) @definition.type
(duck_member name: (identifier) @name) @definition.function
(effect_operation name: (identifier) @name) @definition.function
(handler_operation_clause name: (identifier) @name) @definition.function

(application_expression
  function: (postfix_expression
    (identifier) @name)) @reference.call
