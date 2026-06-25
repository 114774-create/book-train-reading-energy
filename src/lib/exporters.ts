import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export function downloadXlsx(filename: string, sheets: { name: string; rows: any[] }[]) {
  const wb = XLSX.utils.book_new();

  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
}

export async function downloadSvgAsPng(svgEl: SVGSVGElement, filename: string, scale = 2) {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);

  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    });
    img.src = url;
    await loaded;

    const width = (svgEl.viewBox?.baseVal?.width || svgEl.getBoundingClientRect().width) * scale;
    const height = (svgEl.viewBox?.baseVal?.height || svgEl.getBoundingClientRect().height) * scale;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("toBlob_failed");
    saveAs(blob, filename.endsWith(".png") ? filename : filename + ".png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
