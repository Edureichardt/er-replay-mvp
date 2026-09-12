import { v2 as cloudinary } from "cloudinary";

export function cloudStorageEnabled() {
  return Boolean(process.env.CLOUDINARY_URL);
}
export async function uploadReplay(filePath: string, publicId: string) {
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "video",
    public_id: publicId,
    folder: "er-replay",
    overwrite: false,
  });
  return { url: result.secure_url, cloudPublicId: result.public_id };
}
export async function deleteCloudReplay(publicId?: string) {
  if (!publicId || !cloudStorageEnabled()) return;
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "video",
    invalidate: true,
  });
}
export async function uploadBrandImage(dataUri: string, arenaId: string) {
  if (!cloudStorageEnabled())
    throw new Error("Configure o Cloudinary para enviar a marca d'água.");
  const result = await cloudinary.uploader.upload(dataUri, {
    resource_type: "image",
    public_id: `watermark-${arenaId}`,
    folder: "er-replay/branding",
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}
