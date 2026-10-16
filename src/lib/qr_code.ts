// Makes the picture for "Add a phone". Wraps qrcode-generator (small, free,
// no other dependencies) so the rest of the app only deals in text -> picture.
import qrcode from "qrcode-generator";

/** The dark/light squares of the code for `text`, quiet zone not included. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** A picture (data address) a plain <img> can show. */
export function qrDataUrl(text: string, cellSize = 6, margin = 4): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, cellSize * margin);
}
