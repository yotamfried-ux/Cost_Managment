"use client";

import { useState } from "react";
import type { Project } from "@/lib/queries";

export function AllocationFields({ projects }: { projects: Project[] }) {
  const [count, setCount] = useState(Math.min(2, projects.length));
  return <>
    <div className="field-stack">
      {Array.from({ length: count }, (_, index) => <div className="form-grid" key={index}>
        <label>פרויקט {index + 1}<select name="projectShare" defaultValue="">
          <option value="">ללא בחירה</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <label>אחוז לפרויקט {index + 1}<input name="sharePercent" dir="ltr" inputMode="decimal" type="number" min="0.01" max="100" step="0.01"/></label>
      </div>)}
      {count < projects.length && <button type="button" className="button" onClick={() => setCount(count + 1)}>הוסף שורת חלוקה</button>}
    </div>
    <p className="notice">השמירה מחליפה את החלוקה הקיימת. יתרה מתחת ל־100% תישאר ללא שיוך.</p>
  </>;
}
