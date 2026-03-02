export function hasVerifiedQuery(search: string): boolean {
  return new URLSearchParams(search).get("verified") === "true";
}

export function mapLoginError(errorMessage: string): string {
  if (errorMessage === "CredentialsSignin") {
    return "Invalid email or password";
  }

  if (errorMessage === "Configuration") {
    return "Server configuration error - missing environment variables";
  }

  return errorMessage;
}
