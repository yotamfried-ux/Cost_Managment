import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import type { Allocation } from "./allocation";
import type { Evidence } from "./finance";
import type { FutureFinance } from "./plugins";
import type { PaymentDocument } from "./payment-documents";
import type { CrmData } from "./business";

export type Role = "owner" | "editor" | "viewer";
export type Project = { id: string; name: string; description: string; status: string; monthly_budget_minor: number | null; vercelProjectIds?: string[]; kind?: "overhead" };
/** Every charge from this supplier that has no explicit split is attributed to this project (or to the general-costs project). */
export type AllocationRule = { id: string; supplier_id: string; project_id: string };
export type Supplier = { id: string; name: string; category: string };
export type Charge = {
  id: string; description: string; recorded_on: string; amount_minor: number | null; currency: string; evidence: Evidence;
  category: string; supplier_id: string | null; amount_ils_minor: number | null; source: string;
  request_id: string; allocations?: Allocation[]; project_id: string | null; invoice_id: string | null;
  exchange_rate?: { quote: string; date: string; source: string };
  account_id?: string; external_key?: string; billing_period_end?: string;
  vercelBreakdown?: { platformMinor: number; projects: { id: string; minor: number }[] };
};
export type Invoice = {
  id: string; invoice_number: string; original_name: string; issued_on: string; supplier_id: string; currency: string;
  amount_minor: number; status: "review" | "matched"; sha256: string; format?: "eml";
};
export type Subscription = { id: string; supplier_id: string; label: string; amount_minor: number | null; currency: string; cycle: string; next_charge_on: string | null; status: string; starts_on?: string };
export type Account = { id: string; provider: string; external_account_id: string; supplier_id: string; last_synced_at: string | null };
export type Run = { id: string; provider_account_id: string; status: "running" | "completed" | "failed"; reason: string | null; observed_count: number; started_at: string; finished_at: string | null };
export type Audit = { id: string; entity: string; operation: "INSERT" | "UPDATE"; created_at: string; actor: string; before?: unknown; after?: unknown };
export type Alert = { id: string; code: "charge_threshold" | "verified_source_changed"; reference: string; created_at: string };
export type InboxReceipt = {
  id: string; sender: string; subject: string; receivedOn: string; originalName: string; digest: string;
  messageId: string; attachmentId: string; format?: "eml";
  supportingInvoiceId?: string;
  paymentData?: PaymentDocument | null;
};
export type GmailScan = { scope: string; pdf?: string; email?: string };
export type GmailRun = {
  at: string; status: "completed" | "partial" | "failed"; reason?: string;
  added: number; filed: number; paid: number; linked: number; review: number | null;
  hasMore: boolean;
};
export type WorkspaceData = {
  version: 1;
  business: { name: string; business_number: string | null; contact_email: string | null; alert_threshold_minor: number | null };
  projects: Project[]; suppliers: Supplier[]; subscriptions: Subscription[]; charges: Charge[]; invoices: Invoice[];
  accounts: Account[]; runs: Run[]; alerts: Alert[]; audit: Audit[];
  costEvents: { account: string; key: string; digest: string; observedAt: string; payload: unknown }[];
  lastTotp: Record<string, number>;
  allocationRules?: AllocationRule[];
  futureFinance?: FutureFinance;
  crm?: CrmData;
  inboxReceipts?: InboxReceipt[];
  gmailScan?: GmailScan;
  gmailRuns?: GmailRun[];
  usdReferenceRate?: { quote: string; quoted: string };
  usdReferenceCheckedAt?: string;
};

export function emptyData(): WorkspaceData {
  return {
    version: 1, business: { name: "D2R Management", business_number: null, contact_email: null, alert_threshold_minor: null },
    projects: [], suppliers: [], subscriptions: [], charges: [], invoices: [], accounts: [],
    runs: [], alerts: [], audit: [], costEvents: [], lastTotp: {},
  };
}

const repo = "yotamfried-ux/Cost_Managment";
const productionBranch = "d2r-data";
const previewBranch = "d2r-preview-data";
const snapshotPath = "ledger.enc";
const maxSnapshot = 670_000;
const maxDocument = 4 * 1024 * 1024;
const uuid = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const present = z.object({ sha });
type Config = { key: Buffer; mode: "git"; token: string; branch?: string } | { key: Buffer; mode: "local"; root: string };

export function storageConfig(): Config | undefined {
  const encoded = process.env.D2R_DATA_KEY;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) return undefined;
  const key = Buffer.from(encoded, "base64url");
  const local = process.env.D2R_LOCAL_DATA_DIR;
  if (local && !process.env.VERCEL && isAbsolute(local)) return { key, mode: "local", root: local };
  const token = process.env.D2R_REPO_TOKEN;
  if (token) return { key, mode: "git", token, branch: process.env.VERCEL_ENV === "preview" ? previewBranch : productionBranch };
}

function encryptionKey(key: Buffer) {
  return Buffer.from(hkdfSync("sha256", key, "", "D2R-repository-v1", 32));
}
function encrypt(key: Buffer, scope: string, bytes: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(scope));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from("D2R1"), iv, cipher.getAuthTag(), ciphertext]);
}
function decrypt(key: Buffer, scope: string, bytes: Buffer) {
  if (bytes.length < 32 || bytes.subarray(0, 4).toString() !== "D2R1") throw new Error("Unsupported storage format");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(key), bytes.subarray(4, 16));
  cipher.setAAD(Buffer.from(scope));
  cipher.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]);
}

function decodeState(key: Buffer, bytes: Buffer): WorkspaceData {
  const raw = gunzipSync(decrypt(key, snapshotPath, bytes), { maxOutputLength: 8_000_000 });
  const data = JSON.parse(raw.toString("utf8")) as WorkspaceData;
  if (data.version !== 1 || !data.business || !Array.isArray(data.charges) || !Array.isArray(data.audit)) throw new Error("Unsupported ledger version");
  return data;
}
function encodeState(key: Buffer, data: WorkspaceData) {
  const raw = Buffer.from(JSON.stringify(data));
  if (raw.length > 8_000_000) throw new Error("Ledger capacity exceeded");
  const packed = gzipSync(raw);
  if (packed.length > maxSnapshot) throw new Error("Encrypted ledger capacity exceeded");
  return encrypt(key, snapshotPath, packed);
}

function documentPath(id: string) { return `documents/${uuid.parse(id)}.enc`; }

class GithubRepository {
  constructor(private readonly token: string, private readonly branch = productionBranch) {}

  async api(path: string, method = "GET", body?: object, accept = "application/vnd.github+json") {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    return response;
  }
  async head() {
    const response = await this.api(`git/ref/heads/${this.branch}`);
    if (!response.ok) throw new Error("Data branch unavailable");
    return present.parse((await response.json()).object).sha;
  }
  async readFile(path: string, ref: string, limit: number) {
    const response = await this.api(`contents/${path}?ref=${ref}`, "GET", undefined, "application/vnd.github.object+json");
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Repository read failed");
    const item = z.object({ sha, encoding: z.string(), size: z.number().nonnegative(), content: z.string() }).parse(await response.json());
    if (item.size > limit) throw new Error("Repository object too large");
    if (item.encoding === "base64") return Buffer.from(item.content, "base64");
    const blob = await this.api(`git/blobs/${item.sha}`);
    if (!blob.ok) throw new Error("Repository blob unavailable");
    const parsed = z.object({ content: z.string(), encoding: z.literal("base64") }).parse(await blob.json());
    return Buffer.from(parsed.content, "base64");
  }
  async write(head: string, entries: { path: string; content: Buffer }[]) {
    const text = await this.api(`git/commits/${head}`);
    if (!text.ok) throw new Error("Data branch commit unavailable");
    const base = present.parse((await text.json()).tree).sha;
    const treeEntries = await Promise.all(entries.map(async entry => {
      const blob = await this.api("git/blobs", "POST", { content: entry.content.toString("base64"), encoding: "base64" });
      if (!blob.ok) throw new Error("Repository blob write failed");
      return { path: entry.path, mode: "100644", type: "blob", sha: present.parse(await blob.json()).sha };
    }));
    const tree = await this.api("git/trees", "POST", { base_tree: base, tree: treeEntries });
    if (!tree.ok) throw new Error("Repository tree write failed");
    const commit = await this.api("git/commits", "POST", {
      message: "Update encrypted workspace", tree: present.parse(await tree.json()).sha, parents: [head],
      author: { name: "D2R Management", email: "d2r-data@users.noreply.github.com" },
    });
    if (!commit.ok) throw new Error("Repository commit failed");
    const update = await this.api(`git/refs/heads/${this.branch}`, "PATCH", { sha: present.parse(await commit.json()).sha, force: false });
    if (update.ok) return true;
    if (update.status === 409 || update.status === 422) {
      if (await this.head() !== head) return false;
    }
    throw new Error("Repository reference update failed");
  }
}

export type Mutation<T> = { result: T; changed?: boolean; document?: { id: string; bytes: Buffer }; documents?: { id: string; bytes: Buffer }[] };
export class LedgerRepository {
  constructor(private readonly config: Config) {}

  async read() {
    const config = this.config;
    if (config.mode === "local") {
      try { return decodeState(config.key, await readFile(join(config.root, snapshotPath))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData(); throw error; }
    }
    const api = new GithubRepository(config.token, config.branch);
    const contents = await api.readFile(snapshotPath, await api.head(), maxSnapshot + 32);
    return contents ? decodeState(config.key, contents) : emptyData();
  }

  async transaction<T>(callback: (data: WorkspaceData) => Mutation<T>): Promise<T> {
    const config = this.config;
    if (config.mode === "local") {
      const root = config.root;
      await mkdir(join(root, "documents"), { recursive: true, mode: 0o700 });
      const lockPath = join(root, ".lock");
      for (let attempt = 0; attempt < 35; attempt++) {
        const lock = await open(lockPath, "wx", 0o600).catch(error => {
          if (error.code !== "EEXIST") throw error;
          return null;
        });
        if (!lock) { await delay(40); continue; }
        try {
          const data = await this.read();
          const mutation = callback(data);
          if (mutation.changed !== false) {
            const sealed = encodeState(config.key, data);
            for (const document of mutation.documents ?? (mutation.document ? [mutation.document] : [])) {
              const path = documentPath(document.id);
              await writeFile(join(root, path), encrypt(config.key, path, document.bytes), { mode: 0o600 });
            }
            await writeFile(join(root, snapshotPath + ".next"), sealed, { mode: 0o600 });
            await rename(join(root, snapshotPath + ".next"), join(root, snapshotPath));
          }
          return mutation.result;
        } finally {
          await lock.close();
          await rm(lockPath);
        }
      }
      throw new Error("Local ledger is busy");
    }
    const api = new GithubRepository(config.token, config.branch);
    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await api.head();
      const contents = await api.readFile(snapshotPath, head, maxSnapshot + 32);
      const data = contents ? decodeState(config.key, contents) : emptyData();
      const mutation = callback(data);
      if (mutation.changed === false) return mutation.result;
      const entries = [{ path: snapshotPath, content: encodeState(config.key, data) }];
      for (const document of mutation.documents ?? (mutation.document ? [mutation.document] : [])) {
        const path = documentPath(document.id);
        entries.push({ path, content: encrypt(config.key, path, document.bytes) });
      }
      if (await api.write(head, entries)) return mutation.result;
      await delay(30 * (attempt + 1));
    }
    throw new Error("Ledger was updated concurrently");
  }

  async document(id: string) {
    const config = this.config;
    const path = documentPath(id);
    let raw: Buffer | null;
    if (config.mode === "local") {
      raw = await readFile(join(config.root, path)).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    } else {
      const api = new GithubRepository(config.token, config.branch);
      raw = await api.readFile(path, await api.head(), maxDocument + 32);
    }
    return raw ? decrypt(config.key, path, raw) : null;
  }
}
