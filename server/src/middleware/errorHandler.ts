import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { HttpError } from '../lib/http';

// Express error-handling middleware — MUST have exactly 4 params or Express treats
// it as normal middleware. Mounted LAST, after all routers. Sends a clean
// status+message for known errors; logs and returns a generic 500 for everything
// else so DB/internal details never reach the client.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File too large' : 'Upload error' });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
