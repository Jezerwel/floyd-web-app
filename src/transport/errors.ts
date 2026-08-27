export type TransportErrorCode =
  | "unsupported"
  | "insecure_context"
  | "cancelled"
  | "no_devices"
  | "permission_denied"
  | "connection_failed"
  | "not_connected"
  | "invalid_response"
  | "timeout"
  | "offline"
  | "command_failed";

export class TransportError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransportError";
    this.code = code;
  }
}

export function normalizeTransportError(
  error: unknown,
  fallback: TransportErrorCode = "connection_failed",
): TransportError {
  if (error instanceof TransportError) return error;
  let errorName = "";
  if (error && typeof error === "object" && "name" in error) {
    const name = error.name;
    if (typeof name === "string") errorName = name;
  }
  if (errorName === "NotFoundError") {
    return new TransportError("cancelled", "No feeder was selected.", { cause: error });
  }
  if (errorName === "SecurityError") {
    return new TransportError(
      "permission_denied",
      "Bluetooth access was denied by the browser.",
      { cause: error },
    );
  }
  if (errorName === "AbortError") {
    return new TransportError("timeout", "The feeder request timed out.", { cause: error });
  }
  const message = error instanceof Error ? error.message : "Bluetooth operation failed";
  return new TransportError(fallback, message, { cause: error });
}
