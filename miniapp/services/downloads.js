function resolveArtworkDownloadUrl(artwork) {
  const url = String((artwork && artwork.download_url) || "").trim();
  return url;
}

function isAlbumPermissionError(error) {
  const message = String((error && (error.errMsg || error.message)) || "");
  return /auth deny|authorize no response|auth denied|permission/i.test(message);
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    if (typeof wx === "undefined" || !wx.downloadFile) {
      reject(new Error("download-unavailable"));
      return;
    }

    wx.downloadFile({
      url,
      success(result) {
        const statusCode = Number(result && result.statusCode);
        if (statusCode && (statusCode < 200 || statusCode >= 300)) {
          reject(new Error(`download-http-${statusCode}`));
          return;
        }
        if (!result || !result.tempFilePath) {
          reject(new Error("download-empty-file"));
          return;
        }
        resolve(result.tempFilePath);
      },
      fail: reject,
    });
  });
}

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx === "undefined" || !wx.saveImageToPhotosAlbum) {
      reject(new Error("save-album-unavailable"));
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

module.exports = {
  resolveArtworkDownloadUrl,
  isAlbumPermissionError,
  downloadFile,
  saveImageToAlbum,
};
