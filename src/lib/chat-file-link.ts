/**
 * 대화창의 링크가 **파일**인지 판정한다 — 파일이면 화면이 다운로드 아이콘을 붙인다.
 *
 * 왜 필요한가: 직원이 문서를 만들어 링크로 알려 줘도 대화창에는 밑줄 친 글자만 있었다.
 * 다운로드 버튼은 결과물 뷰어(`ArtifactViewer.tsx:371`)와 카드 첨부(`TaskDrawer.tsx:760`)에만
 * 있어서, 대화 중에 받은 파일은 새 탭에서 열어 브라우저에 맡기는 수밖에 없었다(2026-09-20 실측).
 *
 * 모든 링크에 아이콘을 붙이지는 않는다 — 참고 사이트 링크까지 아이콘을 달면 소음이 되고,
 * 미리보기 카드 승격과도 겹친다. 판정은 두 갈래다.
 *
 *   1. 우리 자신의 파일 경로(결과물 콘텐츠·카드 첨부) — 상대 경로로 온다.
 *   2. 그 밖의 http(s) 링크는 마지막 경로 조각의 확장자가 파일 확장자일 때만.
 *
 * 순수 함수다. 클라이언트 번들에 실리므로 `node:*`·`@/db` 를 import 하지 않는다.
 */

/** 브라우저가 페이지로 여는 확장자는 제외한다 — 그것은 링크지 파일이 아니다. */
const FILE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "md",
  "txt",
  "rtf",
  "log",
  "zip",
  "tar",
  "gz",
  "tgz",
  "7z",
  "rar",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
  "ico",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "mp4",
  "webm",
  "mov",
  "m4a",
]);

/** 결과물 콘텐츠: `/api/channels/<id>/artifacts/<id>/versions/<n>/content` */
const ARTIFACT_CONTENT = /^\/api\/channels\/[^/]+\/artifacts\/[^/]+\/versions\/\d+\/content$/;
/** 카드 첨부: `/api/channels/<id>/kanban/attachments/<id>` */
const KANBAN_ATTACHMENT = /^\/api\/channels\/[^/]+\/kanban\/attachments\/[^/]+$/;

/**
 * 인라인 이미지 중 **래스터만**. `svg+xml` 은 스크립트를 품는 문서라 제외한다.
 * `markdown-url.ts` 의 주소 정책과 이 파일의 내려받기 판정이 같은 목록을 본다.
 */
export const DATA_IMAGE_RASTER = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i;

export type ChatFileLink = {
  /** 다운로드에 쓸 주소. 결과물이면 `?download=1` 이 붙는다(Content-Disposition 을 서버가 준다). */
  href: string;
  /** `download` 속성에 쓸 이름. 서버가 이름을 주는 경로에서는 비운다. */
  filename: string | undefined;
};

function extensionOf(pathname: string): string | null {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase();
}

export function chatFileLink(href: string | undefined | null): ChatFileLink | null {
  if (!href) return null;

  // 직원이 만든 그림은 인라인 base64 로 오는 일이 잦다 — 그것도 사용자에게는 파일이다.
  const inline = DATA_IMAGE_RASTER.exec(href);
  if (inline) {
    const ext = inline[1].toLowerCase() === "jpg" ? "jpeg" : inline[1].toLowerCase();
    return { href, filename: `image.${ext}` };
  }

  // 상대 경로는 우리 자신의 라우트다. `new URL` 에 기준을 줘서 쿼리·해시를 정확히 가른다.
  const base = "https://deskrpg.invalid";
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const isOwnPath = href.startsWith("/");
  if (isOwnPath && ARTIFACT_CONTENT.test(url.pathname)) {
    url.searchParams.set("download", "1");
    return { href: `${url.pathname}${url.search}`, filename: undefined };
  }
  if (isOwnPath && KANBAN_ATTACHMENT.test(url.pathname)) {
    return { href, filename: undefined };
  }

  const ext = extensionOf(decodeURIComponent(url.pathname));
  if (!ext || !FILE_EXTENSIONS.has(ext)) return null;
  const name = decodeURIComponent(url.pathname).split("/").pop() || undefined;
  return { href, filename: name };
}
