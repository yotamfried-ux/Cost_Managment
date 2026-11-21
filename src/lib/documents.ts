export const pdfMaxSize = 4 * 1024 * 1024;

export function validPdf(bytes: Buffer) {
  return bytes.length >= 8 && bytes.length <= pdfMaxSize &&
    bytes.subarray(0,5).toString() === "%PDF-" && bytes.subarray(-1024).includes("%%EOF");
}

export function cleanFilename(value: string) {
  return (value.split(/[\\/]/).pop() || "invoice.pdf").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0,180) || "invoice.pdf";
}
