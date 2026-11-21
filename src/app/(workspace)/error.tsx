"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="auth-shell"><section className="panel auth-card">
    <h1>טעינת הנתונים נכשלה</h1><p role="alert">לא ניתן היה לטעון את הנתונים כרגע.</p>
    <button className="button primary" onClick={reset}>נסה שוב</button>
  </section></main>;
}
