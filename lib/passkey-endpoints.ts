export const passkeyEndpoints = {
  registerStart: "/api/passkey/register/start",
  registerFinish: "/api/passkey/register/finish",
  authenticateStart: "/api/passkey/authenticate/start",
  authenticateFinish: "/api/passkey/authenticate/finish",
  deletePasskey: "/api/passkey/delete",
  listPasskeys: "/api/passkey/list",
} as const;

