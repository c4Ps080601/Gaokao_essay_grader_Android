import type { Submission } from "../api";
export type PdfReport = {
  title: string;
  sections: { title: string; text: string }[];
};
export function buildPdfDocument(submission: Submission): PdfReport;
