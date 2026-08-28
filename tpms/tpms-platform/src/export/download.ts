/**
 * 共享的文件下载工具
 * 从各导出器中抽取，避免重复定义。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 文本下载（INP/polyMesh 等文本格式导出共用） */
export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
