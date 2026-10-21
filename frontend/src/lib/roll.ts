/**
 * Pull a roll number out of whatever an ID-card barcode or QR code contains. IIIT Allahabad roll
 * numbers look like IIT2023042 or MML2022010: letters then digits. Falls back to the whole text
 * when it already looks like a roll number, else null.
 */
export const extractRollNo = (text: string): string | null => {
  const cleaned = text.trim();
  const match = cleaned.match(/\b([A-Za-z]{2,5}\d{5,9})\b/);
  if (match) return match[1].toUpperCase();
  return /^[A-Za-z0-9-]{3,20}$/.test(cleaned) ? cleaned.toUpperCase() : null;
};
