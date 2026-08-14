import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildWatermarkedPdf } from "../pdfStamp";

async function makeSourcePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    doc.addPage([600, 800]);
  }
  return doc.save();
}

describe("buildWatermarkedPdf", () => {
  it("produces a loadable PDF with the same page count", async () => {
    const source = await makeSourcePdf(3);
    const result = await buildWatermarkedPdf(source, { text: "DRAFT", opacity: 0.2 });
    const doc = await PDFDocument.load(await result.arrayBuffer());
    expect(doc.getPageCount()).toBe(3);
  });

  it("grows the output when the watermark is drawn", async () => {
    const source = await makeSourcePdf(1);
    const stamped = await buildWatermarkedPdf(source, { text: "CONFIDENTIAL", opacity: 0.3 });
    expect(stamped.size).toBeGreaterThan(source.length);
  });

  it("rejects a whitespace-only watermark", async () => {
    const source = await makeSourcePdf(1);
    await expect(buildWatermarkedPdf(source, { text: "   ", opacity: 0.5 })).rejects.toThrow();
  });
});
