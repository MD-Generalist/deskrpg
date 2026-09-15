import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { getDeskRpgHomeDir } from "../../runtime-paths";
import type { SetupJob } from "./types";

type StoredJob = {
  userId: string;
  /** 잡이 어느 대상(local / ssh:<host>)의 것인지. 재개는 같은 대상에만 허용된다. 화면에 나가지 않는다. */
  target?: string;
  pid: number;
  createdAt: number;
  cancelRequested: boolean;
  job: SetupJob;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sanitized progress only. No credentials, command lines, paths or upstream output. */
export class SetupJobStore {
  constructor(readonly directory = path.join(getDeskRpgHomeDir(), "gateway-setup")) {}
  private init() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  private file(id: string) {
    if (!UUID.test(id)) throw new Error("setup_not_found");
    return path.join(this.directory, `${id}.json`);
  }
  private write(record: StoredJob) {
    this.init();
    const file = this.file(record.job.id);
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    renameSync(tmp, file);
  }
  private read(userId: string, id: string): StoredJob {
    let record: StoredJob;
    try {
      record = JSON.parse(readFileSync(this.file(id), "utf8"));
    } catch {
      throw new Error("setup_not_found");
    }
    if (record.userId !== userId) throw new Error("setup_not_found");
    if (record.job.status === "running" && !alive(record.pid)) {
      record.job.status = "failed";
      record.job.error = "setup_interrupted";
      this.write(record);
    }
    return record;
  }
  create(userId: string, target?: string, seed?: { completed?: string[] }): SetupJob {
    const job: SetupJob = {
      id: randomUUID(),
      status: "running",
      steps: [],
      // 재개 잡은 앞선 잡이 끝낸 단계를 물려받고 시작한다 — 되돌리지 않고 다시 하지도 않는다.
      ...(seed?.completed?.length ? { completed: [...new Set(seed.completed)] } : {}),
    };
    this.write({
      userId,
      ...(target === undefined ? {} : { target }),
      pid: process.pid,
      createdAt: Date.now(),
      cancelRequested: false,
      job,
    });
    return job;
  }
  /**
   * 재개할 수 있는 잡만 돌려준다: 같은 사용자·같은 대상·상태 `failed`.
   * 하나라도 어긋나면 `setup_not_found` 다 — 남의 잡의 존재 여부조차 알려 주지 않는다.
   */
  resumable(userId: string, id: string, target: string): SetupJob {
    const record = this.read(userId, id);
    if (record.target !== target || record.job.status !== "failed")
      throw new Error("setup_not_found");
    return record.job;
  }
  get(userId: string, id: string) {
    return this.read(userId, id).job;
  }
  update(userId: string, id: string, patch: Partial<Omit<SetupJob, "id">>) {
    const record = this.read(userId, id);
    record.job = { ...record.job, ...patch };
    this.write(record);
    return record.job;
  }
  cancel(userId: string, id: string) {
    const record = this.read(userId, id);
    if (record.job.status === "running") {
      record.cancelRequested = true;
      this.write(record);
    }
    return record.job;
  }
  cancelled(userId: string, id: string) {
    return this.read(userId, id).cancelRequested;
  }
  lock(target: string): () => void {
    this.init();
    const lock = path.join(
      this.directory,
      `${createHash("sha256").update(target).digest("hex")}.lock`,
    );
    if (existsSync(lock)) {
      let owner = 0;
      try {
        owner = Number(readFileSync(path.join(lock, "pid"), "utf8"));
      } catch {
        /* another process is acquiring */
      }
      if (!owner || alive(owner)) throw new Error("setup_busy");
      rmSync(lock, { recursive: true, force: true });
    }
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw new Error("setup_busy");
    }
    writeFileSync(path.join(lock, "pid"), String(process.pid), { mode: 0o600 });
    return () => {
      rmSync(lock, { recursive: true, force: true });
    };
  }
}
