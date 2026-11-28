import { acknowledgeAttention } from "@/app/approval-actions";
import { PendingButton } from "./pending-button";

/** Owner-only "seen / handled" button. The item stays hidden until what it is about changes. */
export function AckButton({ id, fingerprint, month, back = "", children = "ראיתי" }: { id: string; fingerprint: string; month: string; back?: string; children?: React.ReactNode }) {
  return <form action={acknowledgeAttention} className="ack-form">
    <input type="hidden" name="id" value={id}/><input type="hidden" name="fingerprint" value={fingerprint}/>
    <input type="hidden" name="month" value={month}/><input type="hidden" name="back" value={back}/>
    <PendingButton className="button">{children}</PendingButton>
  </form>;
}
