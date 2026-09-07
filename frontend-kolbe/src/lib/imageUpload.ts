/** فایل تصویر را برای ذخیرهسازی localStorage بهینه میکند (حداکثر maxSize، JPEG). */
export async function fileToOptimizedDataUrl(file: File, maxSize = 1920, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode-failed"));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  if (scale === 1 && dataUrl.length < 900_000) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
