// Build 66 — readable error messages in production.
//
// In a production build Next.js replaces the message of any error thrown by a
// server action with "An error occurred in the Server Components render…" so
// internals are not leaked. It does, however, pass an error's `digest`
// through unchanged. Server actions therefore throw appError(message), which
// carries the (user-facing) message in the digest; screens read it back with
// errorText(e). In development both give the same text.

const PREFIX = 'APPMSG:';

/** Create an error whose message stays readable for the user in production. */
export function appError(message?: unknown): Error {
  const text = String(message ?? 'Something went wrong.');
  const e = new Error(text) as Error & { digest?: string };
  e.digest = PREFIX + text;
  return e;
}

/** The message to show for an error caught on the screen. */
export function errorText(e: unknown): string {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest === 'string' && digest.startsWith(PREFIX)) return digest.slice(PREFIX.length);
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
}
