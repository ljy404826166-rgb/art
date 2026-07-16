const {
  canUseWxCapability,
  getWxApi,
  normalizePlatformError,
} = require("./platform-capabilities");

function resolveArtworkPreviewUrl(artwork) {
  if (!artwork) return "";
  const safeImageSrc = artwork.imageSrc && artwork.imageSrc !== artwork.download_url
    ? artwork.imageSrc
    : "";
  return artwork.display_url || artwork.cloud_file_id || artwork.thumbnail_url || safeImageSrc || "";
}

function createPreviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function previewArtwork(artwork, wxApi) {
  const api = getWxApi(wxApi);
  const url = resolveArtworkPreviewUrl(artwork);
  if (!url) return Promise.reject(createPreviewError("invalid-data", "暂无可预览图片"));
  if (!api || !canUseWxCapability("previewImage", api)) {
    return Promise.reject(createPreviewError("unsupported", "当前微信版本不支持图片预览"));
  }

  return new Promise((resolve, reject) => {
    api.previewImage({
      current: url,
      urls: [url],
      success(result) {
        resolve({ url, result });
      },
      fail(error) {
        reject(normalizePlatformError(error, "remote-failed"));
      },
    });
  });
}

module.exports = {
  previewArtwork,
  resolveArtworkPreviewUrl,
};
