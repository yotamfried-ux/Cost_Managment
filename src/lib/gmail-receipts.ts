import { createHash, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { cleanFilename, pdfMaxSize, validPdf } from "./documents";
import { businessDate } from "./finance";
import type { GmailScan, InboxReceipt } from "./repository";

const senderSchema = z.object({ email: z.email(), dkim: z.string().regex(/^[a-z0-9.-]+$/), emailReceipt: z.boolean().optional() });
const namecheapSender = "support@namecheap.com";
type Config = { clientId: string; clientSecret: string; refreshToken: string; label: string; allowed: z.infer<typeof senderSchema>[] };
export function gmailConfig(): Config | undefined {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_RECEIPTS_LABEL, GMAIL_RECEIPTS_SENDERS } = process.env;
  if (!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN && GMAIL_RECEIPTS_LABEL && GMAIL_RECEIPTS_SENDERS) ||
      !/^Label_[A-Za-z0-9_-]+$/.test(GMAIL_RECEIPTS_LABEL)) return;
  try {
    const allowed = z.array(senderSchema).min(1).max(20).parse(JSON.parse(GMAIL_RECEIPTS_SENDERS));
    if (process.env.GMAIL_RECEIPTS_NAMECHEAP === "true" && !allowed.some(row => row.email.toLowerCase() === namecheapSender)) {
      allowed.push({ email: namecheapSender, dkim: "namecheap.com", emailReceipt: true });
    }
    return { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN, label: GMAIL_RECEIPTS_LABEL, allowed };
  } catch {
    return;
  }
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,250}$/);
const messageList = z.object({ messages: z.array(z.object({ id })).optional(), nextPageToken: z.string().min(1).max(2048).optional() });
const header = z.object({ name: z.string(), value: z.string() });
type Part = { filename?: string; mimeType?: string; body?: { size: number; attachmentId?: string; data?: string }; parts?: Part[]; headers?: z.infer<typeof header>[] };
const part: z.ZodType<Part> = z.lazy(() => z.object({
  filename: z.string().optional(), mimeType: z.string().optional(), headers: z.array(header).optional(),
  body: z.object({ size: z.number().nonnegative(), attachmentId: z.string().regex(/^[A-Za-z0-9_-]{1,600}$/).optional(), data: z.string().optional() }).optional(),
  parts: z.array(part).optional(),
}));
const message = z.object({ id, labelIds: z.array(z.string()), internalDate: z.string().regex(/^\d{10,15}$/), payload: part });
const rawMessage = z.object({ id, raw: z.string() });
const emailMaxSize = 1024 * 1024;
const attachment = z.object({ data: z.string(), size: z.number().min(1).max(pdfMaxSize) });

export function alignedSender(headers: Part["headers"], allowed: Config["allowed"]) {
  const from = headers?.find(row => row.name.toLowerCase() === "from")?.value?.trim().toLowerCase() ?? "";
  const emailAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  const account = allowed.find(item => item.email.toLowerCase() === emailAddress);
  if (!account) return;
  const auth = headers?.find(row => row.name.toLowerCase() === "authentication-results" && /^mx\.google\.com\s*;/i.test(row.value))?.value ?? "";
  const escaped = account.dkim.replaceAll(".", "\\.");
  const dkim = new RegExp(`(?:^|;)\\s*dkim=pass\\b[^;]*header\\.(?:i|d)=(?:[^@;\\s]+@|@)?${escaped}(?=\\s|;|$)`, "i");
  if (dkim.test(auth)) return account.email;
}

export function isPdfAttachment(node: Part) {
  const supportedType = node.mimeType === "application/pdf" || node.mimeType === "application/octet-stream";
  return Boolean(supportedType && node.filename?.toLowerCase().endsWith(".pdf") &&
    node.body && node.body.size > 0 && node.body.size <= pdfMaxSize);
}

const pdfs = (node: Part): Part[] => {
  if (isPdfAttachment(node)) return [node];
  return (node.parts ?? []).flatMap(pdfs);
};

export function isReceiptEmail(sender: string, subject: string, allowed: Config["allowed"]) {
  if (!allowed.some(row => row.email === sender && row.emailReceipt === true)) return false;
  const title = subject.trim();
  return /^(?:your\s+)?(?:receipt|invoice)\b/i.test(title) ||
    (sender === namecheapSender && /^Namecheap Order Summary \(Order# \d+\);?$/i.test(title)) ||
    (sender === "receipts@openrouter.ai" && /^your openrouter, inc\.? receipt \[#?\d+-\d+\]$/i.test(title));
}

type GmailStage = "oauth" | "list" | "message" | "attachment";
const knownOAuthErrors = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "access_denied", "invalid_scope", "temporarily_unavailable"]);
export class GmailImportError extends Error {
  constructor(readonly stage: GmailStage, readonly status: number | undefined, readonly code: string | undefined) {
    super("Gmail import failed");
  }

  static from(stage: GmailStage, cause: unknown) {
    const response = z.object({
      response: z.object({ status: z.number().int().min(100).max(599).optional(), data: z.object({ error: z.string() }).optional().catch(undefined) }),
    }).safeParse(cause);
    const details = response.success ? response.data.response : undefined;
    const rawCode = details?.data?.error;
    return new GmailImportError(stage, details?.status, rawCode && knownOAuthErrors.has(rawCode) ? rawCode : undefined);
  }
}

export function nextGmailPage(page: { ids: string[]; next?: string; cursor?: string }, settled: ReadonlySet<string>) {
  return page.ids.every(id => settled.has(id)) ? page.next : page.cursor;
}

export async function googleReceipts(config: Config, previous: InboxReceipt[], prior?: GmailScan) {
  const oauth = new OAuth2Client(config.clientId, config.clientSecret);
  oauth.setCredentials({ refresh_token: config.refreshToken });
  const { token } = await oauth.getAccessToken().catch(cause => { throw GmailImportError.from("oauth", cause); });
  if (!token) throw new GmailImportError("oauth", undefined, undefined);
  const deadline = AbortSignal.timeout(35_000);
  const api = async (stage: GmailStage, path: string) => {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.any([deadline, AbortSignal.timeout(7000)]),
    });
    if (!response.ok) throw new GmailImportError(stage, response.status, undefined);
    return response.json() as Promise<unknown>;
  };
  const scope = createHash("sha256").update(JSON.stringify(["v1", config.label, config.allowed])).digest("hex");
  const emailSenders = config.allowed.filter(row => row.emailReceipt);
  const lanes = {
    pdf: `has:attachment filename:pdf { ${config.allowed.map(row => "from:" + row.email).join(" ")} }`,
    email: emailSenders.length ? `{subject:receipt subject:invoice subject:"Namecheap Order Summary"} { ${emailSenders.map(row => "from:" + row.email).join(" ")} }` : undefined,
  };
  const pages = await Promise.all((["pdf", "email"] as const).map(async lane => {
    const query = lanes[lane];
    if (!query) return { lane, ids: [] as string[] };
    let cursor = prior?.scope === scope ? prior[lane] : undefined;
    const params = new URLSearchParams({ labelIds: config.label, q: "newer_than:1y " + query, maxResults: "8" });
    if (cursor) params.set("pageToken", cursor);
    const list = await api("list", "messages?" + params).catch(error => {
      if (!cursor || !(error instanceof GmailImportError) || error.status !== 400) throw error;
      cursor = undefined;
      params.delete("pageToken");
      return api("list", "messages?" + params);
    });
    const page = messageList.parse(list);
    return { lane, ids: (page.messages ?? []).map(row => row.id), next: page.nextPageToken, cursor };
  }));
  const packets = new Set(pages.flatMap(page => page.ids));
  const processed = new Set(previous.map(item => item.messageId + ":" + item.attachmentId));
  const digests = new Set(previous.map(item => item.digest));
  const counts = { messages: packets.size, visited: 0, skippedLabel: 0, skippedSender: 0,
    skippedDate: 0, candidates: 0, missingLocator: 0, existing: 0, invalidPdf: 0, duplicatedContent: 0, invalidEmail: 0, failedMessages: 0 };
  const output: { item: InboxReceipt; bytes: Buffer }[] = [];
  const settled = new Set<string>();
  async function processMessage(packet: string) {
    counts.visited++;
    const row = message.parse(await api("message", "messages/" + packet + "?format=full"));
    if (row.id !== packet || !row.labelIds.includes(config.label)) { counts.skippedLabel++; return true; }
    const sender = alignedSender(row.payload.headers, config.allowed);
    if (!sender) { counts.skippedSender++; return true; }
    const parsedDate = new Date(Number(row.internalDate));
    if (!Number.isFinite(parsedDate.getTime())) { counts.skippedDate++; return true; }
    const subject = (row.payload.headers?.find(item => item.name.toLowerCase() === "subject")?.value ?? "").slice(0,200);
    const pdfFiles = pdfs(row.payload);
    if (!pdfFiles.length && isReceiptEmail(sender, subject, config.allowed)) {
      const marker = "original-email";
      counts.candidates++;
      if (processed.has(row.id + ":" + marker)) { counts.existing++; return true; }
      const original = rawMessage.parse(await api("message", "messages/" + row.id + "?format=raw"));
      if (original.id !== row.id || original.raw.length > Math.ceil(emailMaxSize * 4 / 3) + 4) { counts.invalidEmail++; return true; }
      const bytes = Buffer.from(original.raw, "base64url");
      if (!bytes.length || bytes.length > emailMaxSize || !/\r?\n\r?\n/.test(bytes.toString("latin1"))) { counts.invalidEmail++; return true; }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digests.has(digest)) { counts.duplicatedContent++; return true; }
      digests.add(digest);
      output.push({ bytes, item: {
        id: randomUUID(), sender, subject, receivedOn: businessDate(parsedDate),
        originalName: `receipt-${businessDate(parsedDate)}.eml`, digest, messageId: row.id, attachmentId: marker, format: "eml",
      } });
    }
    for (const pdf of pdfFiles) {
      if (output.length >= 5) return false;
      counts.candidates++;
      const locator = pdf.body?.attachmentId ?? (pdf.body?.data ? "inline-" + createHash("sha256").update(pdf.body.data).digest("hex") : undefined);
      if (!locator) { counts.missingLocator++; continue; }
      if (processed.has(row.id + ":" + locator)) { counts.existing++; continue; }
      const data = pdf.body?.data ?? attachment.parse(await api("attachment", `messages/${row.id}/attachments/${locator}`)).data;
      if (data.length > Math.ceil(pdfMaxSize * 4 / 3) + 4) { counts.invalidPdf++; continue; }
      const bytes = Buffer.from(data,"base64url");
      if (!validPdf(bytes)) { counts.invalidPdf++; continue; }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digests.has(digest)) { counts.duplicatedContent++; continue; }
      digests.add(digest);
      output.push({ bytes, item: {
        id: randomUUID(), sender, subject, receivedOn: businessDate(parsedDate), originalName: cleanFilename(pdf.filename ?? ""),
        digest, messageId: row.id, attachmentId: locator,
      } });
    }
    return true;
  }
  for (const packet of packets) {
    if (output.length >= 5 || deadline.aborted) break;
    try {
      if (await processMessage(packet)) settled.add(packet);
    } catch (error) {
      if (error instanceof GmailImportError && error.status === 404) settled.add(packet);
      else counts.failedMessages++;
    }
  }
  const progress: GmailScan = { scope };
  for (const page of pages) progress[page.lane] = nextGmailPage(page, settled);
  const hasMore = Boolean(progress.pdf || progress.email || settled.size < packets.size);
  return { output, counts, progress, hasMore };
}
