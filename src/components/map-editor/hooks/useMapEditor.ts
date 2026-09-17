// 맵 에디터는 제거됐다. `src/game/**` 가 아직 이 경로에서 Tiled 타입을 가져오므로
// 정본(`@/lib/tiled-map`)을 타입으로만 재수출한다. 새 코드는 `@/lib/tiled-map` 을 쓴다.
export type {
  TiledTileset,
  TiledProperty,
  TiledLayer,
  TiledObject,
  TiledMap,
  TileRegion,
  TilesetImageInfo,
} from "@/lib/tiled-map";
