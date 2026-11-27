import type { AllocationRule, Charge, Project } from "./repository";

export const overheadName = "הוצאות כלליות";

/**
 * Applies the owner's supplier rules to charges at read time, so every total, filter and report agrees and new charges are covered
 * the moment they arrive. An explicit split on a charge always wins; stored charges are never rewritten.
 */
export function applyRules(charges: Charge[], rules: AllocationRule[] | undefined, projects: Project[]): Charge[] {
  if (!rules?.length) return charges;
  const known = new Set(projects.map(row => row.id));
  const bySupplier = new Map(rules.filter(rule => known.has(rule.project_id)).map(rule => [rule.supplier_id, rule.project_id]));
  return charges.map(charge => {
    if (charge.allocations || charge.project_id || !charge.supplier_id) return charge;
    const project = bySupplier.get(charge.supplier_id);
    return project ? { ...charge, project_id: project, allocations: [{ projectId: project, basisPoints: 10_000 }] } : charge;
  });
}

/** The project that holds shared costs, created on first use. */
export function overheadProject(projects: Project[], create: () => Project): Project {
  const found = projects.find(row => row.kind === "overhead");
  if (found) return found;
  const made = create();
  projects.push(made);
  return made;
}
