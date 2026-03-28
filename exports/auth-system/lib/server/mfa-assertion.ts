import jwt from "jsonwebtoken";

const MFA_ASSERTION_TYPE = "email_mfa_assertion";
const MFA_ASSERTION_TTL_SECONDS = 5 * 60;

type MfaAssertionPayload = {
  sub: string;
  type: typeof MFA_ASSERTION_TYPE;
};

function getMfaAssertionSecret(): string {
  const secret =
    process.env.MFA_ASSERTION_SECRET ??
    process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error(
      "Missing MFA assertion secret. Set MFA_ASSERTION_SECRET or NEXTAUTH_SECRET.",
    );
  }

  return secret;
}

export function createMfaAssertionToken(params: { userId: string }): string {
  const payload: MfaAssertionPayload = {
    sub: params.userId,
    type: MFA_ASSERTION_TYPE,
  };

  return jwt.sign(payload, getMfaAssertionSecret(), {
    expiresIn: MFA_ASSERTION_TTL_SECONDS,
  });
}

export function verifyMfaAssertionToken(params: {
  token: string;
  expectedUserId: string;
}): boolean {
  try {
    const decoded = jwt.verify(
      params.token,
      getMfaAssertionSecret(),
    ) as MfaAssertionPayload;

    return (
      decoded.type === MFA_ASSERTION_TYPE &&
      decoded.sub === params.expectedUserId
    );
  } catch {
    return false;
  }
}
