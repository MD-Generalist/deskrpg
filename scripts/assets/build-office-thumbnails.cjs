// Capture actual map geometry once at authoring time; cards do not allocate WebGL contexts.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "office-thumbnails-"));
  const output = "public/assets/environments/thumbnails";
  await fs.mkdir(output, { recursive: true });
  const manifest = JSON.parse(
    await fs.readFile("src/game/three/office-environment-thumbnails.json", "utf8"),
  );
  const requested = process.argv.slice(2);
  for (const id of requested)
    if (!Object.hasOwn(manifest, id)) throw new Error(`Unknown environment: ${id}`);
  for (const id of requested.length ? requested : Object.keys(manifest)) {
    const capture = path.join(temporary, id);
    execFileSync(process.execPath, ["scripts/assets/verify-office-scene.cjs", capture, id], {
      stdio: "inherit",
    });
    const bytes = await sharp(path.join(capture, "tech-overview.png"))
      .trim({ threshold: 8 })
      .resize(874, 450, { fit: "contain", background: "#f3f0e7" })
      .webp({ quality: 85 })
      .toBuffer();
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const filename = `${id}-${hash}.webp`;
    await fs.writeFile(path.join(output, filename), bytes);
    manifest[id] = `/assets/environments/thumbnails/${filename}`;
  }
  await fs.writeFile(
    "src/game/three/office-environment-thumbnails.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
