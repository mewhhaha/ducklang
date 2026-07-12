// Content-Length framed JSON-RPC messages, as used by the Language Server
// Protocol over stdio. The decoder is incremental so it can be fed stdin
// chunks of any size.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encode_message(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(
    "Content-Length: " + body.length.toString() + "\r\n\r\n",
  );
  const framed = new Uint8Array(header.length + body.length);
  framed.set(header, 0);
  framed.set(body, header.length);
  return framed;
}

export class MessageDecoder {
  #buffer = new Uint8Array(0);

  push(chunk: Uint8Array): unknown[] {
    const combined = new Uint8Array(this.#buffer.length + chunk.length);
    combined.set(this.#buffer, 0);
    combined.set(chunk, this.#buffer.length);
    this.#buffer = combined;

    const messages: unknown[] = [];

    while (true) {
      const separator = find_header_end(this.#buffer);

      if (separator < 0) {
        break;
      }

      const header = decoder.decode(this.#buffer.slice(0, separator));
      const match = header.match(/Content-Length: *(\d+)/i);

      if (match === null || match[1] === undefined) {
        throw new Error("Missing Content-Length header");
      }

      const length = Number(match[1]);
      const start = separator + 4;

      if (this.#buffer.length < start + length) {
        break;
      }

      const body = decoder.decode(this.#buffer.slice(start, start + length));
      this.#buffer = this.#buffer.slice(start + length);
      messages.push(JSON.parse(body));
    }

    return messages;
  }
}

function find_header_end(buffer: Uint8Array): number {
  for (let index = 0; index + 3 < buffer.length; index += 1) {
    if (
      buffer[index] === 13 && buffer[index + 1] === 10 &&
      buffer[index + 2] === 13 && buffer[index + 3] === 10
    ) {
      return index;
    }
  }

  return -1;
}
