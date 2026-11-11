import { GIT_HTTP_MAX_BODY_BYTES } from "@shared/constants";

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "BodyTooLargeError";
  }
}

export function contentLengthTooLarge(
  request: Request,
  maxBytes = GIT_HTTP_MAX_BODY_BYTES
): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}

/** Stops reading once the stream exceeds maxBytes. */
export function capBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = GIT_HTTP_MAX_BODY_BYTES
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  let seen = 0;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        seen += value.byteLength;
        if (seen > maxBytes) {
          await reader.cancel();
          controller.error(new BodyTooLargeError());
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
