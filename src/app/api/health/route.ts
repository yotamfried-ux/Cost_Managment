export function GET() {
  return Response.json({ status: "ok", product: "D2R Management" }, { headers: { "Cache-Control": "no-store" } });
}
