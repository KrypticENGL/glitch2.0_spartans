import { describe, expect, it } from "vitest";
import { validateHazard, validateSOS } from "./validation";

const ok = { area: "Donar", type: "stranded", people: "4", medical: false, notes: "", contact: "" };

describe("form validation", () => {
  it("accepts a minimal valid SOS", () => expect(validateSOS(ok)).toEqual({}));
  it("rejects bad people counts", () => {
    for (const people of ["", "0", "2.5", "501", "abc"]) expect(validateSOS({ ...ok, people }).people).toBeDefined();
  });
  it("accepts Indian mobile formats and rejects junk", () => {
    expect(validateSOS({ ...ok, contact: "+91 98765-43210" }).contact).toBeUndefined();
    expect(validateSOS({ ...ok, contact: "12345" }).contact).toBeDefined();
  });
  it("requires a meaningful hazard description", () => {
    expect(validateHazard({ area: "x", type: "fallen_tree", severity: "low", description: "tree" }).description).toBeDefined();
  });
});
