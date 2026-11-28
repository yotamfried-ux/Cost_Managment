"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows the click was received: disabled with a "שולח…" label while the server action runs. */
export function PendingButton({ className, children }: { className: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} aria-busy={pending}>{pending ? "שולח…" : children}</button>;
}
