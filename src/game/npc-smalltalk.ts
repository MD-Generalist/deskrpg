/** Local presentation only. Never emit these lines to sockets, chat, or AI history. */
export const GREETINGS = [
  ["{name}님, 좋은 하루예요!", "{name}님도 좋은 하루 보내세요!"],
  ["{name}님, 잠깐 스트레칭 어때요?", "좋아요, {name}님! 어깨 좀 풀어야겠어요."],
  ["{name}님, 커피 한 잔 하셨어요?", "아직요! {name}님 덕분에 생각났네요."],
  ["{name}님, 오늘도 반가워요!", "저도요, {name}님. 오늘도 힘내요!"],
  ["{name}님, 점심 맛있게 드셨어요?", "네! {name}님도 식사 잘 챙기세요."],
  ["{name}님, 잠깐 바람 쐬러 가세요?", "네, {name}님. 잠깐 걸으니 좋네요."],
  ["{name}님, 오늘 컨디션 어떠세요?", "좋아요! {name}님은 어떠세요?"],
  ["{name}님, 오늘도 수고 많으세요.", "고마워요, {name}님. 같이 힘내요!"],
  ["{name}님, 물 한 잔 챙기세요!", "감사해요, {name}님도요!"],
  ["{name}님, 잠깐 쉬어 가요.", "좋은 생각이에요, {name}님!"],
  ["{name}님, 창가 쪽이 참 좋네요.", "맞아요, {name}님. 눈도 잠깐 쉬어 가요."],
  ["{name}님, 오후도 파이팅이에요!", "{name}님도요! 천천히 하나씩 해봐요."],
  ["{name}님, 오늘 옷 멋지네요!", "고마워요, {name}님! 기분 좋네요."],
  ["{name}님, 간식 생각 안 나세요?", "마침 생각했어요, {name}님!"],
  ["{name}님, 산책하니 머리가 맑아져요.", "그러게요, {name}님. 좋은 휴식이네요."],
  ["{name}님, 반가워요. 잘 지내시죠?", "네, {name}님! 안부 고마워요."],
] as const;
export type SmalltalkActor = {
  id: string;
  name: string;
  x: number;
  y: number;
  walking: boolean;
  available: boolean;
};
type Line = { text: string; start: number; end: number };
export const SMALLTALK_PAUSE_MS = 7500;
export class NpcSmalltalk {
  private encounters = new Map<string, { partner: string; until: number }>();
  partner(id: string, now: number) {
    const encounter = this.encounters.get(id);
    return encounter && now < encounter.until ? encounter.partner : undefined;
  }
  private lines = new Map<string, Line>();
  private cooldown = new Map<string, number>();
  private pairs = new Map<string, number>();
  private nextEncounter = 0;
  private lastTemplate = -1;
  text(id: string, now: number) {
    const line = this.lines.get(id);
    return line && now >= line.start && now < line.end ? line.text : undefined;
  }
  update(
    actors: SmalltalkActor[],
    now: number,
    canSee: (a: SmalltalkActor, b: SmalltalkActor) => boolean,
    random = Math.random,
  ) {
    const available = new Set(actors.filter((a) => a.available).map((a) => a.id));
    for (const [id, encounter] of this.encounters) {
      if (now >= encounter.until || !available.has(id) || !available.has(encounter.partner)) {
        this.encounters.delete(id);
        this.encounters.delete(encounter.partner);
        this.lines.delete(id);
        this.lines.delete(encounter.partner);
      }
    }
    for (const [id, line] of this.lines)
      if (now >= line.end || !available.has(id)) this.lines.delete(id);
    if (now < this.nextEncounter) return;
    for (let i = 0; i < actors.length; i++)
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i],
          b = actors[j];
        const key = JSON.stringify([a.id, b.id].sort());
        if (
          !a.available ||
          !b.available ||
          !(a.walking || b.walking) ||
          Math.hypot(a.x - b.x, a.y - b.y) > 1.8 ||
          now < (this.cooldown.get(a.id) ?? 0) ||
          now < (this.cooldown.get(b.id) ?? 0) ||
          now < (this.pairs.get(key) ?? 0) ||
          !canSee(a, b)
        )
          continue;
        // Select uniformly from all templates except the previous exchange.
        let index = Math.floor(random() * (GREETINGS.length - (this.lastTemplate >= 0 ? 1 : 0)));
        if (this.lastTemplate >= 0 && index >= this.lastTemplate) index++;
        this.lastTemplate = index;
        const name = (value: string) => value.split(/\s*[·|]\s*/)[0].trim();
        this.lines.set(a.id, {
          text: GREETINGS[index][0].replace("{name}", name(b.name)),
          start: now,
          end: now + 4500,
        });
        this.lines.set(b.id, {
          text: GREETINGS[index][1].replace("{name}", name(a.name)),
          start: now + 2000,
          end: now + 6500,
        });
        this.encounters.set(a.id, { partner: b.id, until: now + SMALLTALK_PAUSE_MS });
        this.encounters.set(b.id, { partner: a.id, until: now + SMALLTALK_PAUSE_MS });
        this.cooldown.set(a.id, now + 45000);
        this.cooldown.set(b.id, now + 45000);
        this.pairs.set(key, now + 90000);
        this.nextEncounter = now + 12000;
        return;
      }
  }
}
