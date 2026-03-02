export const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
