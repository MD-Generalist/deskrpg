// 공통 내보내기로 출판 집기와 측정 보고서를 함께 생성한다.
const { buildAuthoredAssets } = require("./build-tech-startup.cjs");
buildAuthoredAssets({
  output: "public/assets/shared/publishing",
  woodColors: ["#a98150"],
  module: "./src/game/three/publishing-assets",
  builder: "buildPublishingAsset",
  definitions: "PUBLISHING_ASSETS",
  generator: "scripts/assets/build-publishing-assets.cjs",
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
