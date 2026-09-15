const { buildAuthoredAssets } = require("./build-tech-startup.cjs");
buildAuthoredAssets({
  output: "public/assets/shared/trading",
  module: "./src/game/three/trading-assets",
  builder: "buildTradingAsset",
  definitions: "TRADING_ASSETS",
  generator: "scripts/assets/build-trading-assets.cjs",
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
