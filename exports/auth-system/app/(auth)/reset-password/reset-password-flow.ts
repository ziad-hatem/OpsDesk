export interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

function readQueryParam(
  searchParams: URLSearchParams,
  hashParams: URLSearchParams,
  key: string,
): string {
  return hashParams.get(key) ?? searchParams.get(key) ?? "";
}

export function parseRecoveryTokens(
  search: string,
  hash: string,
): RecoveryTokens | null {
  const searchParams = new URLSearchParams(search.replace(/^\?/, ""));
  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));

  const type = readQueryParam(searchParams, hashParams, "type");
  const accessToken = readQueryParam(searchParams, hashParams, "access_token");
  const refreshToken = readQueryParam(
    searchParams,
    hashParams,
    "refresh_token",
  );

  if (type && type !== "recovery") {
    return null;
  }

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
  };
}

export function getResetPasswordMismatchError(
  password: string,
  confirmPassword: string,
): string | null {
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }

  return null;
}
