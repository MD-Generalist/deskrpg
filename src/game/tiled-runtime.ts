/** 3D 공식 맵의 논리 타일도 Phaser 파서가 참조할 내장 타일셋이 필요하다. */
export function withRuntimeTileset(map: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(map.tilesets) && map.tilesets.length > 0) return map;
  return {
    ...map,
    tilesets: [
      {
        firstgid: 1,
        name: "deskrpg-tileset",
        tilewidth: 32,
        tileheight: 32,
        tilecount: 16,
        columns: 16,
        image: "deskrpg-tileset.png",
        imagewidth: 512,
        imageheight: 32,
      },
    ],
  };
}
