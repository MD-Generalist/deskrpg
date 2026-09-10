/** Sample the composed, authoritative LPC sheet so saved outfit colours survive the 3D transition. */
export function spritePalette(source?: CanvasImageSource) {
  const fallback = { skin: "#edc6a6", hair: "#51382d", shirt: "#7c9276", legs: "#344941" };
  if (!source) return fallback;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    // LPC walk sheets contain four directions; down-facing idle is frame 18.
    ctx.drawImage(source, 0, 128, 64, 64, 0, 0, 64, 64);
    const dominant = (x: number, y: number, w: number, h: number, otherwise: string) => {
      const pixels = ctx.getImageData(x, y, w, h).data,
        colors = new Map<string, number>();
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 220 || pixels[i] + pixels[i + 1] + pixels[i + 2] < 55) continue;
        const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) =>
          Math.min(255, Math.round(v / 16) * 16),
        );
        const key = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
        colors.set(key, (colors.get(key) || 0) + 1);
      }
      return [...colors].sort((a, b) => b[1] - a[1])[0]?.[0] || otherwise;
    };
    return {
      skin: dominant(26, 22, 12, 8, fallback.skin),
      hair: dominant(22, 10, 20, 10, fallback.hair),
      shirt: dominant(23, 34, 18, 10, fallback.shirt),
      legs: dominant(23, 46, 18, 8, fallback.legs),
    };
  } catch {
    return fallback;
  }
}
