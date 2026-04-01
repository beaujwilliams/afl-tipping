const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_JOIN_CODE_LENGTH = 10;

export function generateJoinCode(length = DEFAULT_JOIN_CODE_LENGTH) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("Join code length must be a positive integer");
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let code = "";
  for (const byte of bytes) {
    code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
  }

  return code;
}
