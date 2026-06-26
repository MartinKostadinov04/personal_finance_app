import { getSupabaseAdmin } from './supabaseAdmin';

const BUCKET = 'receipts';
let bucketEnsured = false;

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const admin = getSupabaseAdmin();
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) {
    await admin.storage.createBucket(BUCKET, { public: false });
  }
  bucketEnsured = true;
}

/** Upload a receipt to the private bucket and return its object path. */
export async function uploadReceipt(path: string, buffer: Buffer, contentType: string): Promise<string> {
  await ensureBucket();
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

/** A short-lived signed URL for viewing a receipt. */
export async function signedReceiptUrl(path: string, expiresIn = 3600): Promise<string> {
  await ensureBucket();
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error('Could not sign receipt URL');
  return data.signedUrl;
}
