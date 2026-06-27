export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BadRequest extends HttpError {
  constructor(message = 'Bad request') {
    super(400, message);
  }
}

/** Positive-integer id from a URL param; throws 400 if invalid. */
export function parseId(raw: string, label = 'id'): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequest(`Invalid ${label}`);
  return n;
}

/** Any integer URL param (e.g. year/month); throws 400 if not an integer. */
export function parseIntStrict(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new BadRequest(`Invalid ${label}`);
  return n;
}
