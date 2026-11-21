"use client";

import { useState, useTransition } from "react";
import { enrollMfa, verifyMfa } from "../auth-actions";

export function MfaForm({ factorId }: { factorId?: string }) {
  const [enrollment, setEnrollment] = useState<{ id: string; secret: string }>();
  const [error, setError] = useState<string>();
  const [busy, start] = useTransition();
  const id = factorId ?? enrollment?.id;
  return <div className="field-stack">
    {error && <p className="notice" role="alert">{error}</p>}
    {enrollment && <p>הזינו את מפתח ההגדרה ביישום האימות שלכם. <code className="mfa-key" dir="ltr">{enrollment.secret}</code></p>}
    {id ? <form className="field-stack" action={(form) => start(async () => {
      setError(await verifyMfa(id, String(form.get("code"))));
    })}>
      <label>קוד בן 6 ספרות<input name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>
      <button className="button primary" disabled={busy}>אימות</button>
    </form> : <button className="button primary" disabled={busy} onClick={() => start(async () => {
      const result = await enrollMfa();
      if (result.id && result.secret) setEnrollment({ id: result.id, secret: result.secret });
      else setError(result.error);
    })}>הגדרת יישום אימות</button>}
  </div>;
}
