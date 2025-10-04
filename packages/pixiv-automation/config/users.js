module.exports = {
  taskName: "Pixiv 用户信息抓取",
  scriptFile: "./scripts/extract-pixiv-user-info.js",
  inputFile: "./inputs/users.txt",
  configKey: "USER_IDS",
  apiObject: "userScraper",
  finishMessage: "所有用户均已处理完毕",
  downloadTasks: ["generateUpdateSQL", "downloadImages"]
};
