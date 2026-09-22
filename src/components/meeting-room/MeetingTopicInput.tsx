"use client";
import { useId } from "react";
import { useT } from "@/lib/i18n";
import { computeMeetingTopicRows } from "./start-form";

export const MEETING_TOPIC_LIMIT = 200;
export function canSubmitMeetingTopic(value: string) {
  return value.trim().length > 0 && value.length <= MEETING_TOPIC_LIMIT;
}

export default function MeetingTopicInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const helpId = useId();
  const tooLong = value.length > MEETING_TOPIC_LIMIT;
  return (
    <div>
      <textarea
        aria-label={t("meeting.topicPlaceholder")}
        aria-describedby={helpId}
        aria-invalid={tooLong}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={computeMeetingTopicRows(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSubmitMeetingTopic(value)) onSubmit();
          }
        }}
        placeholder={t("meeting.topicPlaceholder")}
        className="w-full resize-none overflow-y-auto bg-surface-raised text-text px-3 py-2 rounded border border-border focus:ring-2 focus:ring-primary-light focus:border-transparent focus:outline-none text-body leading-relaxed"
      />
      <p
        id={helpId}
        aria-live="polite"
        className={tooLong ? "text-caption text-danger" : "text-caption text-text-muted"}
      >
        {value.length} / {MEETING_TOPIC_LIMIT}
        {tooLong && ` · ${t("meeting.topicTooLong", { limit: MEETING_TOPIC_LIMIT })}`}
      </p>
    </div>
  );
}
