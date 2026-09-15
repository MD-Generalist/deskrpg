// Natural Earth / world-atlas 2.0.2 land geometry, see sources/world-atlas-LICENSE.
const fs = require("node:fs/promises");
const sharp = require("sharp");
(async () => {
  const data = JSON.parse(await fs.readFile("scripts/assets/sources/world-land-110m.json", "utf8"));
  const arcs = data.arcs.map((arc) => {
    let x = 0,
      y = 0;
    return arc.map((p) => {
      x += p[0];
      y += p[1];
      return [
        x * data.transform.scale[0] + data.transform.translate[0],
        y * data.transform.scale[1] + data.transform.translate[1],
      ];
    });
  });
  const paths = [];
  for (const g of data.objects.land.geometries) {
    const polys = g.type === "MultiPolygon" ? g.arcs : [g.arcs];
    for (const poly of polys) {
      let path = "";
      for (const ring of poly) {
        const points = ring.flatMap((id, i) => {
          const a = id < 0 ? [...arcs[~id]].reverse() : arcs[id];
          return i ? a.slice(1) : a;
        });
        if (points.every((p) => p[1] < -60)) continue;
        path +=
          points
            .map(
              (p, i) =>
                `${i ? "L" : "M"}${(((p[0] + 180) / 360) * 1800 + 124).toFixed(1)},${(((85 - p[1]) / 145) * 820 + 50).toFixed(1)}`,
            )
            .join("") + "Z";
      }
      if (path) paths.push(`<path d="${path}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><rect width="2048" height="1024" fill="#eee9dd"/><g fill="#48657e" fill-rule="evenodd">${paths.join("")}</g><g fill="none" stroke="#8da4b4" stroke-width="3" stroke-dasharray="9 8"><path d="M460 340 Q980 -30 1610 330"/><path d="M600 560 Q980 960 1520 550"/></g></svg>`;
  await fs.writeFile(
    "public/assets/shared/trading/world-mural.webp",
    await sharp(Buffer.from(svg)).webp({ quality: 92 }).toBuffer(),
  );
})();
