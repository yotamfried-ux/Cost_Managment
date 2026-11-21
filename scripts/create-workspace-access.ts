import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { encodeBase32, passwordHash } from "../src/lib/auth";

const [emailArg, directory] = process.argv.slice(2);
const email = z.email().parse(emailArg).toLowerCase();
if (!directory || !isAbsolute(directory)) throw new Error("Provide an absolute output directory outside the repository.");
await mkdir(directory, { mode: 0o700 });
const password = randomBytes(24).toString("base64url");
const totpSecret = encodeBase32(randomBytes(20));
const auth = [{ email, role: "owner", passwordHash: await passwordHash(password), totpSecret }];
const variables = {
  D2R_DATA_KEY: randomBytes(32).toString("base64url"),
  D2R_SESSION_SECRET: randomBytes(32).toString("base64url"),
  D2R_AUTH_ACCOUNTS: JSON.stringify(auth),
};
await writeFile(join(directory,"vercel-secrets.json"), JSON.stringify(variables,null,2) + "\n", { flag: "wx", mode: 0o600 });
await writeFile(join(directory,"owner-login.txt"), `Email: ${email}\nPassword: ${password}\nTOTP setup key: ${totpSecret}\n`, { flag: "wx", mode: 0o600 });
console.log("Workspace access files created in the supplied directory with owner-only permissions.");
