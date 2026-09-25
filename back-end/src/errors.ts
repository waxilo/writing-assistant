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

/**
 * True when `error` is a UNIQUE/PRIMARY key violation. The two engines report
 * it completely differently (D1 throws `SqlError` with a message, mysql2 sets
 * `code`), so callers must not pattern-match on the message alone.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const mysqlError = error as Error & { code?: string; errno?: number };
  if (mysqlError.code === "ER_DUP_ENTRY" || mysqlError.errno === 1062) {
    return true;
  }
  return /UNIQUE constraint failed|Duplicate entry/i.test(error.message);
}
