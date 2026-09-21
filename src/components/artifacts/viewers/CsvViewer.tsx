"use client";
import { useMemo } from "react";

import { useT } from "@/lib/i18n";

import { CSV_MAX_ROWS, parseCsv } from "../artifact-view-model";

/** CSV 를 표로 — 첫 행을 머리로 쓰고 `CSV_MAX_ROWS` 행에서 자른다. */
export default function CsvViewer({ text }: { text: string }) {
  const t = useT();
  const { rows, truncated } = useMemo(() => parseCsv(text), [text]);
  const [head, ...body] = rows;
  return (
    <div className="text-xs">
      {truncated && (
        <p className="mb-2 text-npc-dark">{t("artifacts.csvTruncated", { rows: CSV_MAX_ROWS })}</p>
      )}
      <div className="overflow-auto">
        <table className="border-collapse">
          {head && (
            <thead>
              <tr>
                {head.map((cell, i) => (
                  <th
                    key={i}
                    className="border border-border px-2 py-1 text-left font-semibold bg-surface-raised"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-border px-2 py-1 whitespace-pre-wrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
