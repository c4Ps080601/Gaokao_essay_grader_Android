export function canRestoreCapture(ticket, result, owner) {
  return (
    !!ticket &&
    !!owner &&
    ticket.owner === owner &&
    typeof ticket.token === "string" &&
    !!ticket.token &&
    ticket.token === result?.token
  );
}
export function captureFile(result) {
  if (result?.canceled) return null;
  const data = result?.data;
  if (
    typeof data !== "string" ||
    data.length > 8 * 1024 * 1024 ||
    !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new Error("相机返回的照片无效，请重新拍摄");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new File([bytes], `拍照-${Date.now()}.jpg`, { type: "image/jpeg" });
}
