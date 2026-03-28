import jwt from "jsonwebtoken";

const PASSKEY_ASSERTION_TYPE = "passkey_assertion";
const PASSKEY_ASSERTION_TTL_SECONDS = 5 * 60;

type PasskeyAssertionPayload = {
  sub: string;
  type: typeof PASSKEY_ASSERTION_TYPE;
  credentialId: string;
};

function getPasskeyAssertionSecret(): string {
  const secret =
    process.env.PASSKEY_ASSERTION_SECRET ??
    process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error(
      "Missing passkey assertion secret. Set PASSKEY_ASSERTION_SECRET or NEXTAUTH_SECRET.",
    );
  }

  return secret;
}

export function createPasskeyAssertionToken(params: {
  userId: string;
  credentialId: string;
}): string {
  const payload: PasskeyAssertionPayload = {
    sub: params.userId,
    type: PASSKEY_ASSERTION_TYPE,
    credentialId: params.credentialId,
  };

  return jwt.sign(payload, getPasskeyAssertionSecret(), {
    expiresIn: PASSKEY_ASSERTION_TTL_SECONDS,
  });
}

export function verifyPasskeyAssertionToken(params: {
  token: string;
  expectedUserId?: string;
}): { userId: string; credentialId: string } | null {
  try {
    const decoded = jwt.verify(
      params.token,
      getPasskeyAssertionSecret(),
    ) as PasskeyAssertionPayload;

    if (
      decoded.type !== PASSKEY_ASSERTION_TYPE ||
      (params.expectedUserId && decoded.sub !== params.expectedUserId) ||
      typeof decoded.sub !== "string" ||
      !decoded.sub.trim() ||
      typeof decoded.credentialId !== "string" ||
      !decoded.credentialId.trim()
    ) {
      return null;
    }

    return {
      userId: decoded.sub,
      credentialId: decoded.credentialId,
    };
  } catch {
    return null;
  }
}
