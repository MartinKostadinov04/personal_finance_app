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

/** Any integer URL param (e.g. year/month); throws 400 if not an integer or outside optional range. */
export function parseIntStrict(
  raw: string,
  label: string,
  opts: { min?: number; max?: number } = {},
): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new BadRequest(`Invalid ${label}`);
  if (opts.min != null && n < opts.min) throw new BadRequest(`Invalid ${label}`);
  if (opts.max != null && n > opts.max) throw new BadRequest(`Invalid ${label}`);
  return n;
}
