export function hasVerifiedQuery(search: string): boolean {
  return new URLSearchParams(search).get("verified") === "true";
}

export function mapLoginError(errorMessage: string, code?: string | null): string {
  if (code === "account_suspended") {
    return "Your account is suspended. Contact your organization admin.";
  }

  if (code === "mfa_required") {
    return "Multi-step authentication is enabled. Enter the email verification code to continue.";
  }

  if (code === "invalid_passkey_assertion") {
    return "Passkey verification expired. Try signing in with passkey again.";
  }

  if (errorMessage === "CredentialsSignin") {
    return "Invalid email or password";
  }

  if (errorMessage === "Configuration") {
    return "Server configuration error - missing environment variables";
  }

  return errorMessage;
}
