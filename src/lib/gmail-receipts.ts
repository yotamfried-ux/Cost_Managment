import { createHash, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { cleanFilename, pdfMaxSize, validPdf } from "./documents";
import { businessDate } from "./finance";
import type { InboxReceipt } from "./repository";

const senderSchema = z.object({ email: z.email(), dkim: z.string().regex(/^[a-z0-9.-]+$/), emailReceipt: z.boolean().optional() });
type Config = { clientId: string; clientSecret: string; refreshToken: string; label: string; allowed: z.infer<typeof senderSchema>[] };
export function gmailConfig(): Config | undefined {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_RECEIPTS_LABEL, GMAIL_RECEIPTS_SENDERS } = process.env;
  if (!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN && GMAIL_RECEIPTS_LABEL && GMAIL_RECEIPTS_SENDERS) ||
      !/^Label_[A-Za-z0-9_-]+$/.test(GMAIL_RECEIPTS_LABEL)) return;
  try {
    const allowed = z.array(senderSchema).min(1).max(20).parse(JSON.parse(GMAIL_RECEIPTS_SENDERS));
    return { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN, label: GMAIL_RECEIPTS_LABEL, allowed };
  } catch {
    return;
  }
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,250}$/);
const messageList = z.object({ messages: z.array(z.object({ id })).optional() });
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
    (sender === "receipts@openrouter.ai" && /^your openrouter, inc\.? receipt \[[\d-]+\]$/i.test(title));
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

export async function googleReceipts(config: Config, previous: InboxReceipt[]) {
  const oauth = new OAuth2Client(config.clientId, config.clientSecret);
  oauth.setCredentials({ refresh_token: config.refreshToken });
  const { token } = await oauth.getAccessToken().catch(cause => { throw GmailImportError.from("oauth", cause); });
  if (!token) throw new GmailImportError("oauth", undefined, undefined);
  const api = async (stage: GmailStage, path: string) => {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new GmailImportError(stage, response.status, undefined);
    return response.json() as Promise<unknown>;
  };
  const query = `newer_than:90d has:attachment filename:pdf { ${config.allowed.map(row => "from:" + row.email).join(" ")} }`;
  const params = new URLSearchParams({ labelIds: config.label, q: query, maxResults: "20" });
  const list = messageList.parse(await api("list", "messages?" + params));
  const packets = new Map((list.messages ?? []).map(row => [row.id, row]));
  const emailSenders = config.allowed.filter(row => row.emailReceipt);
  if (emailSenders.length) {
    const emailQuery = `newer_than:90d {subject:receipt subject:invoice} { ${emailSenders.map(row => "from:" + row.email).join(" ")} }`;
    const emailParams = new URLSearchParams({ labelIds: config.label, q: emailQuery, maxResults: "20" });
    const emails = messageList.parse(await api("list", "messages?" + emailParams));
    for (const row of emails.messages ?? []) packets.set(row.id,row);
  }
  const processed = new Set(previous.map(item => item.messageId + ":" + item.attachmentId));
  const digests = new Set(previous.map(item => item.digest));
  const counts = { messages: packets.size, visited: 0, skippedLabel: 0, skippedSender: 0,
    skippedDate: 0, candidates: 0, missingLocator: 0, existing: 0, invalidPdf: 0, duplicatedContent: 0, invalidEmail: 0 };
  const output: { item: InboxReceipt; bytes: Buffer }[] = [];
  for (const packet of packets.values()) {
    if (output.length >= 5) break;
    counts.visited++;
    const row = message.parse(await api("message", "messages/" + packet.id + "?format=full"));
    if (row.id !== packet.id || !row.labelIds.includes(config.label)) { counts.skippedLabel++; continue; }
    const sender = alignedSender(row.payload.headers, config.allowed);
    if (!sender) { counts.skippedSender++; continue; }
    const parsedDate = new Date(Number(row.internalDate));
    if (!Number.isFinite(parsedDate.getTime())) { counts.skippedDate++; continue; }
    const subject = (row.payload.headers?.find(item => item.name.toLowerCase() === "subject")?.value ?? "").slice(0,200);
    const pdfFiles = pdfs(row.payload);
    if (!pdfFiles.length && isReceiptEmail(sender, subject, config.allowed)) {
      const marker = "original-email";
      counts.candidates++;
      if (processed.has(row.id + ":" + marker)) { counts.existing++; continue; }
      const original = rawMessage.parse(await api("message", "messages/" + row.id + "?format=raw"));
      if (original.id !== row.id || original.raw.length > Math.ceil(emailMaxSize * 4 / 3) + 4) { counts.invalidEmail++; continue; }
      const bytes = Buffer.from(original.raw, "base64url");
      if (!bytes.length || bytes.length > emailMaxSize || !/\r?\n\r?\n/.test(bytes.toString("latin1"))) { counts.invalidEmail++; continue; }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digests.has(digest)) { counts.duplicatedContent++; continue; }
      digests.add(digest);
      output.push({ bytes, item: {
        id: randomUUID(), sender, subject, receivedOn: businessDate(parsedDate),
        originalName: `receipt-${businessDate(parsedDate)}.eml`, digest, messageId: row.id, attachmentId: marker, format: "eml",
      } });
    }
    for (const pdf of pdfFiles) {
      if (output.length >= 5) break;
      counts.candidates++;
      const locator = pdf.body?.attachmentId;
      if (!locator) { counts.missingLocator++; continue; }
      if (processed.has(row.id + ":" + locator)) { counts.existing++; continue; }
      const { data } = attachment.parse(await api("attachment", `messages/${row.id}/attachments/${locator}`));
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
  }
  return { output, counts };
}
