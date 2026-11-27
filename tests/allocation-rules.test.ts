import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRules } from "../src/lib/allocation-rules";
import type { Charge, Project } from "../src/lib/repository";

const project = (id: string, kind?: "overhead"): Project => ({ id, name: id, description: "", status: "active", monthly_budget_minor: null, ...(kind ? { kind } : {}) });
const charge = (id: string, supplier: string | null, extra: Partial<Charge> = {}): Charge => ({ id, description: id, recorded_on: "2026-11-01", amount_minor: 1000, currency: "ILS", evidence: "manual", category: "x", supplier_id: supplier, amount_ils_minor: 1000, source: "manual", request_id: id, project_id: null, invoice_id: null, ...extra });
const rules = [{ id: "r1", supplier_id: "claude", project_id: "general" }];

test("a supplier rule attributes unsplit charges, including future ones", () => {
  const out = applyRules([charge("a", "claude"), charge("b", "other"), charge("c", null)], rules, [project("general", "overhead")]);
  assert.deepEqual(out[0].allocations, [{ projectId: "general", basisPoints: 10_000 }]);
  assert.equal(out[1].allocations, undefined);
  assert.equal(out[2].allocations, undefined);
});

test("an explicit split or project on a charge always beats the rule, and nothing is mutated", () => {
  const own = charge("a", "claude", { project_id: "tori" });
  const split = charge("b", "claude", { allocations: [{ projectId: "tori", basisPoints: 5000 }] });
  const input = [own, split, charge("c", "claude")];
  const out = applyRules(input, rules, [project("general", "overhead"), project("tori")]);
  assert.equal(out[0], own);
  assert.equal(out[1], split);
  assert.equal(input[2].allocations, undefined);
});

test("a rule pointing at a deleted project is ignored instead of hiding the cost", () => {
  const out = applyRules([charge("a", "claude")], rules, [project("tori")]);
  assert.equal(out[0].allocations, undefined);
});
