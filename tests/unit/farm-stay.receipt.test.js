import { describe, it, expect } from "vitest";
const { buildReceiptPdf } = require("../../helpers/farm-stay-receipt");

const booking = {
  id: "bk-9",
  guest_id: "g1",
  property_id: "p1",
  from: "2030-06-10",
  to: "2030-06-13",
  guests: 2,
  state: "completed",
  quote_total: 300,
};

describe("farm-stay receipt PDF (dependency-free)", () => {
  it("produces a structurally valid PDF buffer", () => {
    const pdf = buildReceiptPdf({ booking, charged: 300, refunded: 0, guest: "g1" });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.slice(0, 5).toString("latin1")).toBe("%PDF-");
    const s = pdf.toString("latin1");
    expect(s).toContain("%%EOF");
    expect(s).toContain("/Type /Catalog");
    expect(s).toContain("startxref");
  });

  it("embeds booking identity, stay, and money detail as text", () => {
    const s = buildReceiptPdf({ booking, charged: 300, refunded: 50, guest: "g1" }).toString("latin1");
    expect(s).toContain("FS-bk-9");
    expect(s).toContain("p1");
    expect(s).toContain("2030-06-10");
    expect(s).toContain("300.00");
    expect(s).toContain("Refunded");
    expect(s).toContain("250.00"); // net = charged - refunded
  });

  it("omits the refund line when nothing was refunded", () => {
    const s = buildReceiptPdf({ booking, charged: 300, refunded: 0 }).toString("latin1");
    expect(s).not.toContain("Refunded");
  });

  it("escapes PDF-special characters in free text", () => {
    const s = buildReceiptPdf({ booking: { ...booking, property_id: "farm (west)\\north" } }).toString("latin1");
    expect(s).toContain("farm \\(west\\)\\\\north");
  });

  it("does not throw on a sparse booking", () => {
    expect(() => buildReceiptPdf({ booking: { id: "bk-x" } })).not.toThrow();
  });
});
