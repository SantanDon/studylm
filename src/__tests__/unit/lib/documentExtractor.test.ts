import { beforeEach, describe, expect, it, vi } from "vitest";

const { readXlsxFile } = vi.hoisted(() => ({ readXlsxFile: vi.fn() }));

vi.mock("read-excel-file/browser", () => ({
  default: readXlsxFile,
}));

import { extractXLSX } from "@/lib/extraction/documentExtractor";

describe("extractXLSX", () => {
  beforeEach(() => {
    readXlsxFile.mockReset();
  });

  it("preserves CSV text without invoking the workbook parser", async () => {
    const file = new File(["topic,score\nGrounding,9"], "sources.csv", {
      type: "text/csv",
    });

    const result = await extractXLSX(file);

    expect(result.content).toBe("topic,score\nGrounding,9");
    expect(result.metadata.pageCount).toBe(1);
    expect(readXlsxFile).not.toHaveBeenCalled();
  });

  it("extracts every workbook sheet and escapes CSV cells", async () => {
    readXlsxFile.mockResolvedValue([
      { sheet: "Sources", data: [["Title", "Summary"], ["Paper", 'Useful, "quoted" text']] },
      { sheet: "Scores", data: [["Paper", 9]] },
    ]);
    const file = new File([new Uint8Array([80, 75])], "sources.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await extractXLSX(file);

    expect(result.content).toContain("=== Sources ===");
    expect(result.content).toContain('Paper,"Useful, ""quoted"" text"');
    expect(result.content).toContain("=== Scores ===");
    expect(result.metadata.pageCount).toBe(2);
  });

  it("rejects legacy XLS files with a useful conversion path", async () => {
    const file = new File(["legacy"], "sources.xls", {
      type: "application/vnd.ms-excel",
    });

    await expect(extractXLSX(file)).rejects.toThrow(
      "Convert the file to .xlsx or .csv first",
    );
  });
});
