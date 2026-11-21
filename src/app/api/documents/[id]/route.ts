import { workspace } from "@/lib/session";
import { isId } from "@/lib/queries";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await workspace();
  if (!access || !(access.id)) return new Response(null, { status: 401 });
  if (!isId(id)) return new Response(null, { status: 404 });

  const { data } = await access.db.from("invoices").select("archive_object_key,original_name").eq("organization_id", access.id).eq("id", id).maybeSingle();
  if (!data) return new Response(null, { status: 404 });
  const { data: signed, error } = await access.db.storage.from("d2r-invoices").createSignedUrl(data.archive_object_key, 45, { download: data.original_name });
  if (error || !signed) return new Response(null, { status: 404 });
  return new Response(null, { status: 302, headers: { Location: signed.signedUrl, "Cache-Control": "private, no-store" } });
}
