"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordKey } from "@/lib/business";
import { resolveMonth } from "@/lib/finance";
import { dismissible } from "@/lib/owner-attention";
import { reviewPublications } from "@/lib/publishing";
import { normalizeCrm } from "@/lib/business";
import { requireWorkspace } from "@/lib/session";

/** The click on "approve" is the owner's explicit approval; the server records who approved exactly which content hash. */
export async function reviewPosts(form: FormData) {
  const { ledger, role, user } = await requireWorkspace();
  const base = `/approvals?month=${resolveMonth(String(form.get("month")))}`;
  if (!ledger || role !== "owner") redirect(base + "&error=permission");
  const input = z.object({ decision: z.enum(["approve", "reject", "cancel"]), keys: z.array(recordKey).min(1).max(30) })
    .safeParse({ decision: form.get("decision"), keys: form.getAll("key") });
  if (!input.success) redirect(base + "&error=validation");
  let outcome: { done: number; skipped: number } | null = null;
  try {
    outcome = await ledger.transaction(data => {
      const result = reviewPublications(data, input.data.keys, input.data.decision, user.email);
      return { result, changed: result.done > 0 };
    });
  } catch { outcome = null; }
  if (!outcome || (outcome.done === 0 && outcome.skipped > 0)) redirect(base + "&error=save");
  revalidatePath("/approvals");
  redirect(`${base}&saved=1&done=${outcome.done}&skipped=${outcome.skipped}`);
}

/** "Seen / handled": hides one attention item until what it is about changes. Owner only; never touches the posts or the agents' data. */
export async function acknowledgeAttention(form: FormData) {
  const { ledger, role, user } = await requireWorkspace();
  const month = resolveMonth(String(form.get("month")));
  const back = ({ outputs: "/outputs", settings: "/settings" } as Record<string, string>)[String(form.get("back"))] ?? "/";
  const base = `${back}?month=${month}`;
  if (!ledger || role !== "owner") redirect(base + "&error=permission");
  const input = z.object({ id: z.string().refine(value => value === "alerts" || (dismissible as string[]).includes(value)), fingerprint: z.string().max(400) })
    .safeParse({ id: form.get("id"), fingerprint: form.get("fingerprint") });
  if (!input.success) redirect(base + "&error=validation");
  let saved = true;
  try {
    await ledger.transaction(data => {
      const crm = data.crm = normalizeCrm(data.crm);
      crm.acks[input.data.id] = input.data.fingerprint;
      return { result: true, changed: true };
    });
  } catch { saved = false; }
  void user;
  if (!saved) redirect(base + "&error=save");
  revalidatePath("/", "layout");
  redirect(`${base}&saved=1`);
}
