// Augments Express's Request with the authenticated user's identity, populated
// by the requireAuth middleware after verifying the Supabase access token.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string | null;
    }
  }
}

export {};
