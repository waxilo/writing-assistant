/**
 * Business error with an explicit HTTP status. Throw this from services and
 * controllers for anything the client is allowed to see; index.ts maps it to
 * the response status/code verbatim (including optional `data`, e.g. the
 * server's current version on a 409 conflict). Unknown exceptions never reach
 * clients.
 *
 * NOTE: written without TS parameter properties so Node's type-stripping
 * test runner can load it directly.
 */
export class ApiError extends Error {
  /** HTTP status code (also used as the envelope `code`). */
  public readonly status: number;
  /** Optional payload included in the response envelope's `data`. */
  public readonly data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}
