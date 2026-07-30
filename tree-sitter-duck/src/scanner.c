#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

enum TokenType {
  APPLICATION_SPACE,
  CONDITION_APPLICATION_SPACE,
  TYPE_APPLICATION_SPACE,
  FIXITY_IDENTIFIER,
  PREFIX_PROOF_KEYWORD,
  PROOF_PREFIXED_IDENTIFIER,
};

enum FixityWordScan {
  NOT_FIXITY_WORD,
  FIXITY_IDENTIFIER_USE,
  FIXITY_DECLARATION,
};

void *tree_sitter_duck_external_scanner_create(void) {
  return NULL;
}

void tree_sitter_duck_external_scanner_destroy(void *payload) {
  (void)payload;
}

unsigned tree_sitter_duck_external_scanner_serialize(
  void *payload,
  char *buffer
) {
  (void)payload;
  (void)buffer;
  return 0;
}

void tree_sitter_duck_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static bool starts_application_argument(int32_t character) {
  if (
    (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z') ||
    (character >= '0' && character <= '9')
  ) {
    return true;
  }

  switch (character) {
    case '_':
    case '"':
    case '\'':
    case '(':
    case '[':
    case '{':
    case '!':
    case '#':
    case '@':
    case '`':
      return true;
    default:
      return false;
  }
}

static bool application_stop_keyword(TSLexer *lexer) {
  char word[8] = {0};
  unsigned length = 0;

  while (
    length < sizeof(word) - 1 &&
    ((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
      (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
      lexer->lookahead == '_')
  ) {
    word[length] = (char)lexer->lookahead;
    length += 1;
    lexer->advance(lexer, false);
  }

  if (
    (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
    (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
    (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
    lexer->lookahead == '_'
  ) {
    return false;
  }

  return strcmp(word, "as") == 0 || strcmp(word, "by") == 0 ||
    strcmp(word, "do") == 0 || strcmp(word, "else") == 0 ||
    strcmp(word, "end") == 0 || strcmp(word, "if") == 0 ||
    strcmp(word, "in") == 0 || strcmp(word, "is") == 0 ||
    strcmp(word, "of") == 0 || strcmp(word, "then") == 0 ||
    strcmp(word, "where") == 0 ||
    strcmp(word, "with") == 0;
}

/** Words that terminate a preceding type instead of becoming type arguments. */
static bool block_stop_keyword(TSLexer *lexer) {
  char word[16] = {0};
  unsigned length = 0;

  while (
    length < sizeof(word) - 1 &&
    ((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
      (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
      lexer->lookahead == '_')
  ) {
    word[length] = (char)lexer->lookahead;
    length += 1;
    lexer->advance(lexer, false);
  }

  if (
    (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
    (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
    (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
    lexer->lookahead == '_'
  ) {
    return false;
  }

  return strcmp(word, "decreases") == 0 || strcmp(word, "do") == 0 ||
    strcmp(word, "else") == 0 || strcmp(word, "end") == 0 ||
    strcmp(word, "ensures") == 0 || strcmp(word, "requires") == 0 ||
    strcmp(word, "then") == 0;
}

static bool starts_type_argument(int32_t character) {
  return (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z') || character == '_' ||
    character == '#' || character == '&' || character == '(' ||
    character == '[';
}

static bool identifier_character(int32_t character) {
  return (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z') ||
    (character >= '0' && character <= '9') || character == '_';
}

static bool operator_character(int32_t character) {
  switch (character) {
    case '.':
    case '-':
    case '!':
    case '$':
    case '%':
    case '&':
    case '*':
    case '+':
    case '/':
    case '<':
    case '=':
    case '>':
    case '?':
    case '@':
    case '\\':
    case '^':
    case '|':
    case '~':
    case ':':
      return true;
    default:
      return false;
  }
}

static bool whitespace(int32_t character) {
  return character == ' ' || character == '\t' ||
    character == '\r' || character == '\n';
}

static bool skip_fixity_extras(TSLexer *lexer) {
  bool skipped = false;

  while (true) {
    while (whitespace(lexer->lookahead)) {
      skipped = true;
      lexer->advance(lexer, false);
    }
    if (lexer->lookahead != '/') {
      return skipped;
    }
    lexer->advance(lexer, false);
    if (lexer->lookahead != '/') {
      return false;
    }
    skipped = true;
    lexer->advance(lexer, false);
    while (
      lexer->lookahead != 0 &&
      lexer->lookahead != '\r' &&
      lexer->lookahead != '\n'
    ) {
      lexer->advance(lexer, false);
    }
  }
}

static enum FixityWordScan scan_fixity_word(TSLexer *lexer) {
  char word[8] = {0};
  unsigned length = 0;

  while (length < sizeof(word) - 1 && identifier_character(lexer->lookahead)) {
    word[length] = (char)lexer->lookahead;
    length += 1;
    lexer->advance(lexer, false);
  }
  if (identifier_character(lexer->lookahead)) {
    return NOT_FIXITY_WORD;
  }
  if (
    strcmp(word, "infix") != 0 && strcmp(word, "infixl") != 0 &&
    strcmp(word, "infixr") != 0 && strcmp(word, "prefix") != 0
  ) {
    return NOT_FIXITY_WORD;
  }
  lexer->mark_end(lexer);

  if (!skip_fixity_extras(lexer)) {
    return FIXITY_IDENTIFIER_USE;
  }
  if (lexer->lookahead < '0' || lexer->lookahead > '9') {
    return FIXITY_IDENTIFIER_USE;
  }

  if (lexer->lookahead == '0') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == 'x' || lexer->lookahead == 'X') {
      lexer->advance(lexer, false);
      while (
        (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
        (lexer->lookahead >= 'a' && lexer->lookahead <= 'f') ||
        (lexer->lookahead >= 'A' && lexer->lookahead <= 'F')
      ) {
        lexer->advance(lexer, false);
      }
    } else {
      while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
        lexer->advance(lexer, false);
      }
    }
  } else {
    while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
      lexer->advance(lexer, false);
    }
  }

  if (lexer->lookahead == '.') {
    lexer->advance(lexer, false);
    while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
      lexer->advance(lexer, false);
    }
  }
  if (lexer->lookahead == 'e' || lexer->lookahead == 'E') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '+' || lexer->lookahead == '-') {
      lexer->advance(lexer, false);
    }
    while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
      lexer->advance(lexer, false);
    }
  }
  if (lexer->lookahead == 'i' || lexer->lookahead == 'u') {
    lexer->advance(lexer, false);
    while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
      lexer->advance(lexer, false);
    }
  } else if (lexer->lookahead == 'f') {
    lexer->advance(lexer, false);
    while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
      lexer->advance(lexer, false);
    }
  }
  bool operator_started = false;
  while (true) {
    while (whitespace(lexer->lookahead)) {
      lexer->advance(lexer, false);
    }
    if (lexer->lookahead != '/') {
      break;
    }
    lexer->advance(lexer, false);
    if (lexer->lookahead != '/') {
      operator_started = true;
      break;
    }
    lexer->advance(lexer, false);
    while (
      lexer->lookahead != 0 &&
      lexer->lookahead != '\r' &&
      lexer->lookahead != '\n'
    ) {
      lexer->advance(lexer, false);
    }
  }
  if (!operator_started && !operator_character(lexer->lookahead)) {
    return FIXITY_IDENTIFIER_USE;
  }
  while (operator_character(lexer->lookahead)) {
    lexer->advance(lexer, false);
  }
  if (!skip_fixity_extras(lexer)) {
    return FIXITY_IDENTIFIER_USE;
  }
  if (lexer->lookahead == '=') {
    return FIXITY_DECLARATION;
  }
  return FIXITY_IDENTIFIER_USE;
}

bool tree_sitter_duck_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  (void)payload;

  if (
    (
      valid_symbols[PREFIX_PROOF_KEYWORD] ||
      valid_symbols[PROOF_PREFIXED_IDENTIFIER]
    ) &&
    lexer->lookahead == 'P'
  ) {
    const char proof[] = "Proof";
    for (unsigned index = 0; index < sizeof(proof) - 1; index += 1) {
      if (lexer->lookahead != proof[index]) {
        return false;
      }
      lexer->advance(lexer, false);
    }
    if (
      lexer->lookahead == '_' &&
      valid_symbols[PROOF_PREFIXED_IDENTIFIER]
    ) {
      lexer->advance(lexer, false);
      while (identifier_character(lexer->lookahead)) {
        lexer->advance(lexer, false);
      }
      lexer->mark_end(lexer);
      lexer->result_symbol = PROOF_PREFIXED_IDENTIFIER;
      return true;
    }
    if (identifier_character(lexer->lookahead)) {
      return false;
    }
    if (!valid_symbols[PREFIX_PROOF_KEYWORD]) {
      return false;
    }
    lexer->mark_end(lexer);
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, false);
    }
    if (
      lexer->lookahead == 0 || lexer->lookahead == '\r' ||
      lexer->lookahead == '\n' || lexer->lookahead == '/'
    ) {
      return false;
    }
    lexer->result_symbol = PREFIX_PROOF_KEYWORD;
    return true;
  }

  if (
    valid_symbols[FIXITY_IDENTIFIER] &&
    !whitespace(lexer->lookahead)
  ) {
    enum FixityWordScan fixity = scan_fixity_word(lexer);
    if (fixity == FIXITY_IDENTIFIER_USE) {
      lexer->result_symbol = FIXITY_IDENTIFIER;
      return true;
    }
    return false;
  }

  if (
    !valid_symbols[APPLICATION_SPACE] &&
    !valid_symbols[CONDITION_APPLICATION_SPACE] &&
    !valid_symbols[TYPE_APPLICATION_SPACE]
  ) {
    return false;
  }

  if (lexer->lookahead != ' ' && lexer->lookahead != '\t') {
    return false;
  }

  do {
    lexer->advance(lexer, true);
  } while (lexer->lookahead == ' ' || lexer->lookahead == '\t');

  lexer->mark_end(lexer);

  if (
    valid_symbols[TYPE_APPLICATION_SPACE] &&
    starts_type_argument(lexer->lookahead)
  ) {
    // A block keyword never continues a type. Without this, the type in
    // `if value is Int then do … end` swallows `then` as a type argument.
    // Only the block delimiters are excluded here, not the whole application
    // stop list, which carries words that are meaningful in type position.
    if (
      ((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
        (lexer->lookahead >= 'a' && lexer->lookahead <= 'z')) &&
      block_stop_keyword(lexer)
    ) {
      return false;
    }

    lexer->result_symbol = TYPE_APPLICATION_SPACE;
    return true;
  }

  if (
    !valid_symbols[APPLICATION_SPACE] &&
    !valid_symbols[CONDITION_APPLICATION_SPACE]
  ) {
    return false;
  }

  if (!starts_application_argument(lexer->lookahead)) {
    return false;
  }

  if (lexer->lookahead == '!') {
    lexer->advance(lexer, false);
    if (
      !((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
        (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
        lexer->lookahead == '_')
    ) {
      return false;
    }
  }

  if (lexer->lookahead == '@') {
    lexer->advance(lexer, false);
    if (
      !((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
        (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
        lexer->lookahead == '_')
    ) {
      return false;
    }
  }

  if (
    ((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
      (lexer->lookahead >= 'a' && lexer->lookahead <= 'z')) &&
    application_stop_keyword(lexer)
  ) {
    return false;
  }

  if (
    valid_symbols[CONDITION_APPLICATION_SPACE] &&
    lexer->lookahead != '{'
  ) {
    lexer->result_symbol = CONDITION_APPLICATION_SPACE;
    return true;
  }

  if (!valid_symbols[APPLICATION_SPACE]) {
    return false;
  }

  lexer->result_symbol = APPLICATION_SPACE;
  return true;
}
