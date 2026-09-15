export type EntryState = {
  status: "idle" | "walking" | "joining" | "joined" | "failed";
  reasonCode?: string;
};
export type ArrivalState = {
  status: "walking" | "arrived" | "cancelled" | "failed";
  reasonCode?: string;
};

/** 요청을 먼저 기록하므로 방 안에서 발생하는 동기 도착도 한 번만 처리한다. */
export class MeetingEntryController {
  state: EntryState = { status: "idle" };
  constructor(
    private effect: (event: "request" | "cancel" | "exit") => void,
    private changed: (state: EntryState) => void = () => {},
  ) {}
  private set(state: EntryState) {
    this.state = state;
    this.changed(state);
  }
  request() {
    if (!["idle", "failed"].includes(this.state.status)) return;
    this.set({ status: "walking" });
    this.effect("request");
  }
  arrival(next: ArrivalState) {
    if (this.state.status !== "walking") return;
    if (next.status === "arrived") this.set({ status: "joining" });
    else if (next.status === "cancelled") this.cancel();
    else if (next.status === "failed") this.fail(next.reasonCode ?? "unknown");
  }
  joined() {
    if (this.state.status === "joining") this.set({ status: "joined" });
  }
  fail(reasonCode: string) {
    this.set({ status: "failed", reasonCode });
    this.effect("cancel");
    this.effect("exit");
  }
  cancel() {
    this.set({ status: "idle" });
    this.effect("cancel");
    this.effect("exit");
  }
}
