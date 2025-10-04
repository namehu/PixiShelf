module.exports = {
  taskName: "Pixiv 标签信息抓取",
  scriptFile: "./scripts/extract-pixiv-tag.js",
  inputFile: "./inputs/tags.txt",
  configKey: "TAG_NAMES",
  apiObject: "pixivTagTranslator",
  finishMessage: "所有标签均已处理完毕",
  downloadTasks: ["generateUpdateSQL", "downloadTagImages"]
};
