import { createHash, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { cleanFilename, pdfMaxSize, validPdf } from "./documents";
import { businessDate } from "./finance";
import type { InboxReceipt } from "./repository";

const senderSchema = z.object({ email: z.email(), dkim: z.string().regex(/^[a-z0-9.-]+$/) });
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

const pdfs = (node: Part): Part[] => {
  if (node.mimeType === "application/pdf" && node.filename && node.body && node.body.size > 0 && node.body.size <= pdfMaxSize) return [node];
  return (node.parts ?? []).flatMap(pdfs);
};

export async function googleReceipts(config: Config, previous: InboxReceipt[]): Promise<{ item: InboxReceipt; bytes: Buffer }[]> {
  const oauth = new OAuth2Client(config.clientId, config.clientSecret);
  oauth.setCredentials({ refresh_token: config.refreshToken });
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error("Gmail access unavailable");
  const api = async (path: string) => {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Gmail request failed");
    return response.json() as Promise<unknown>;
  };
  const query = `newer_than:90d has:attachment filename:pdf { ${config.allowed.map(row => "from:" + row.email).join(" ")} }`;
  const params = new URLSearchParams({ labelIds: config.label, q: query, maxResults: "20" });
  const list = messageList.parse(await api("messages?" + params));
  const processed = new Set(previous.map(item => item.messageId + ":" + item.attachmentId));
  const output: { item: InboxReceipt; bytes: Buffer }[] = [];
  for (const packet of (list.messages ?? [])) {
    if (output.length >= 5) break;
    const row = message.parse(await api("messages/" + packet.id + "?format=full"));
    if (row.id !== packet.id || !row.labelIds.includes(config.label)) continue;
    const sender = alignedSender(row.payload.headers, config.allowed);
    if (!sender) continue;
    const parsedDate = new Date(Number(row.internalDate));
    if (!Number.isFinite(parsedDate.getTime())) continue;
    const subject = (row.payload.headers?.find(item => item.name.toLowerCase() === "subject")?.value ?? "").slice(0,200);
    for (const pdf of pdfs(row.payload)) {
      if (output.length >= 5) break;
      const locator = pdf.body?.attachmentId;
      if (!locator || processed.has(row.id + ":" + locator)) continue;
      const { data } = attachment.parse(await api(`messages/${row.id}/attachments/${locator}`));
      if (data.length > Math.ceil(pdfMaxSize * 4 / 3) + 4) continue;
      const bytes = Buffer.from(data,"base64url");
      if (!validPdf(bytes)) continue;
      output.push({ bytes, item: {
        id: randomUUID(), sender, subject, receivedOn: businessDate(parsedDate), originalName: cleanFilename(pdf.filename ?? ""),
        digest: createHash("sha256").update(bytes).digest("hex"), messageId: row.id, attachmentId: locator,
      } });
    }
  }
  return output;
}
