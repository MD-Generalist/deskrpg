/** 3D 공식 맵의 논리 타일에도 타일셋 항목이 하나는 있어야 하는 도구(맵 에디터·검증)를 위해 내장 타일셋을 채운다. 순수 기하 보조 모듈이다. */
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
