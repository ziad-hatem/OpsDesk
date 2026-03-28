export function normalizeVerificationCode(code: string): string {
  return code.trim();
}

export function isVerificationCodeValid(
  providedCode: string,
  expectedCode: string,
): boolean {
  const provided = normalizeVerificationCode(providedCode);
  const expected = normalizeVerificationCode(expectedCode);

  if (!expected) {
    return false;
  }

  return provided === expected;
}
