module.exports = {
  taskName: "Pixiv 作品信息抓取",
  scriptFile: "./scripts/extract-pixiv-info.js",
  inputFile: "./inputs/artworks.txt",
  configKey: "ARTWORK_IDS",
  apiObject: "pixivScraper",
  finishMessage: "所有作品均已处理完毕",
  downloadTasks: ["generateUpdateSQL", "downloadArtworks", "downloadArtists"]
};
