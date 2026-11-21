import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const scrypt = promisify(nodeScrypt);
const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const roleSchema = z.enum(["owner", "editor", "viewer"]);
const hashSchema = z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
const accountSchema = z.object({
  email: z.email().max(254).transform(email => email.toLowerCase()),
  role: roleSchema,
  passwordHash: hashSchema,
  totpSecret: z.string().regex(/^[A-Z2-7]{32}$/),
});
export type AccountCredentials = z.infer<typeof accountSchema>;
export type SessionAccount = Omit<AccountCredentials, "totpSecret"> & { totpSecret?: string };
const sharedEmail = "shared@d2r.invalid";

export function authConfig() {
  const sessionSecret = process.env.D2R_SESSION_SECRET;
  const accountsJson = process.env.D2R_AUTH_ACCOUNTS;
  if (!sessionSecret || !/^[A-Za-z0-9_-]{43}$/.test(sessionSecret)) return undefined;
  try {
    const accounts = z.array(accountSchema).max(20).parse(accountsJson ? JSON.parse(accountsJson) : []);
    if (accounts.some(account => account.email === sharedEmail) || new Set(accounts.map(account => account.email)).size !== accounts.length) return undefined;
    const hash = hashSchema.safeParse(process.env.D2R_DISABLE_SHARED_LOGIN === "true" ? undefined : process.env.D2R_SHARED_PASSWORD_HASH);
    const shared: SessionAccount | undefined = hash.success ? { email: sharedEmail, role: "viewer", passwordHash: hash.data } : undefined;
    if (!accounts.length && !shared) return undefined;
    return { key: Buffer.from(sessionSecret, "base64url"), accounts, shared };
  } catch {
    return undefined;
  }
}

export async function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  const key = await scrypt(password, Buffer.from(salt, "hex"), 64) as Buffer;
  return salt + ":" + key.toString("hex");
}
export function constantEqual(first: string, second: string) {
  const key = Buffer.alloc(32);
  const digest = (value: string) => createHmac("sha256", key).update(value).digest();
  return timingSafeEqual(digest(first), digest(second));
}
export async function verifyPassword(password: string, account?: SessionAccount) {
  const expected = account?.passwordHash ?? ("0".repeat(32) + ":" + "0".repeat(128));
  return constantEqual(await passwordHash(password, expected.slice(0, 32)), expected);
}

export function encodeBase32(bytes: Buffer) {
  const bits = Array.from(bytes, byte => byte.toString(2).padStart(8, "0")).join("");
  return (bits.match(/.{1,5}/g) ?? []).map(value => base32[parseInt(value.padEnd(5, "0"), 2)]).join("");
}
export function totp(secret: string, step = Math.floor(Date.now() / 30_000)) {
  const bits = Array.from(secret, character => base32.indexOf(character).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map(value => parseInt(value, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  return String((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string, step = Math.floor(Date.now() / 30_000)) {
  for (const offset of [0, -1, 1]) if (constantEqual(code, totp(secret, step + offset))) return step + offset;
  return undefined;
}

const claims = z.object({ email: z.email(), stamp: z.string(), exp: z.number().int() });
export const sessionDuration = 4 * 3600;
export const rememberedSessionDuration = 30 * 24 * 3600;
function signed(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("base64url");
}
function credentialStamp(key: Buffer, account: SessionAccount) {
  return signed(key, JSON.stringify(["account", account.email, account.passwordHash, account.totpSecret, account.role]));
}
export function issueSession(key: Buffer, account: SessionAccount, now = Math.floor(Date.now() / 1000), duration = sessionDuration) {
  const body = Buffer.from(JSON.stringify({ email: account.email, stamp: credentialStamp(key, account), exp: now + duration })).toString("base64url");
  return body + "." + signed(key, "session:" + body);
}
export function readSession(key: Buffer, accounts: SessionAccount[], value: string, now = Math.floor(Date.now() / 1000)) {
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return;
  const [body, signature] = value.split(".");
  if (!constantEqual(signature, signed(key, "session:" + body))) return;
  try {
    const data = claims.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (data.exp <= now) return;
    const account = accounts.find(row => row.email === data.email);
    if (account && constantEqual(data.stamp, credentialStamp(key, account))) return { email: account.email, role: account.role };
  } catch {
    return;
  }
}
