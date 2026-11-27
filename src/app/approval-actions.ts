"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordKey } from "@/lib/business";
import { resolveMonth } from "@/lib/finance";
import { reviewPublications } from "@/lib/publishing";
import { requireWorkspace } from "@/lib/session";

/** The click on "approve" is the owner's explicit approval; the server records who approved exactly which content hash. */
export async function reviewPosts(form: FormData) {
  const { ledger, role, user } = await requireWorkspace();
  const base = `/approvals?month=${resolveMonth(String(form.get("month")))}`;
  if (!ledger || role !== "owner") redirect(base + "&error=permission");
  const input = z.object({ decision: z.enum(["approve", "reject"]), keys: z.array(recordKey).min(1).max(30) })
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
