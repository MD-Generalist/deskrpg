// src/lib/tiled-map.ts — Tiled JSON 맵 타입. 맵 에디터가 제거된 뒤에도 3D 렌더러·사무환경
// 빌더·서버 모션 레이아웃이 같은 형태를 공유하므로 여기서 정본으로 유지한다.

export interface TiledTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  tiles?: Array<{
    id: number;
    properties?: Array<{ name: string; type: string; value: unknown }>;
    objectgroup?: unknown;
  }>;
}

export interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}

export interface TiledLayer {
  id: number;
  name: string;
  type: "tilelayer" | "objectgroup";
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
  draworder?: string;
  properties?: TiledProperty[];
}

export interface TiledObject {
  properties?: TiledProperty[];
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: string;
  renderorder: string;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  nextlayerid: number;
  nextobjectid: number;
  infinite: boolean;
  type: string;
  version: string;
  tiledversion: string;
  compressionlevel: number;
}

export interface TileRegion {
  firstgid: number;
  col: number;
  row: number;
  width: number;
  height: number;
  gids: number[][];
}

export interface TilesetImageInfo {
  img: HTMLImageElement;
  firstgid: number;
  columns: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  name: string;
}
