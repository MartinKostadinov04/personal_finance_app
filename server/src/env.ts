// Loads server environment variables from the repo-root .env. Imported first
// (before any module that reads env at import time, e.g. the Anthropic client),
// so the values are present regardless of the process working directory.
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
