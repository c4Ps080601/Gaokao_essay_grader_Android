export type CaptureResult = {
  canceled?: boolean;
  data?: string;
  token?: string;
};
export type CaptureTicket = { owner: string; token: string; draftId: string };
export function canRestoreCapture(
  ticket: CaptureTicket | null,
  result: CaptureResult,
  owner: string,
): boolean;
export function captureFile(result: CaptureResult): File | null;
