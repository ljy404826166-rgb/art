const {
  DEFAULT_LEGAL_DOCUMENT_ID,
  LEGAL_DOCUMENTS,
  legalDocumentById,
} = require("../../data/legal-documents");

function requestedDocumentId(options = {}) {
  const value = options && typeof options === "object" ? options.document || options.id || "" : "";
  try {
    return decodeURIComponent(String(value || "")).trim();
  } catch (error) {
    return DEFAULT_LEGAL_DOCUMENT_ID;
  }
}

function resolveLegalDocument(options = {}) {
  return legalDocumentById(requestedDocumentId(options));
}

const INITIAL_DOCUMENT = legalDocumentById(DEFAULT_LEGAL_DOCUMENT_ID);

Page({
  data: {
    document: INITIAL_DOCUMENT,
    sections: INITIAL_DOCUMENT.sections,
  },

  onLoad(options = {}) {
    const document = resolveLegalDocument(options);
    this.setData({
      document,
      sections: document.sections,
    });
    if (typeof wx !== "undefined" && typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: document.title });
    }
    return document;
  },
});

module.exports = {
  DEFAULT_LEGAL_DOCUMENT_ID,
  LEGAL_DOCUMENTS,
  requestedDocumentId,
  resolveLegalDocument,
};
