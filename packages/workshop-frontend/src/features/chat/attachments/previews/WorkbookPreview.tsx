import { use, useState } from "react";
import { Tabs } from "@cloudflare/kumo";
import type { UndrawnFeature } from "@gadgets/office-content/xlsx-sheets";
import type { AttachmentPreviewProps } from "../attachmentPreviewers";
import { derivedFrom } from "../derivedFrom";
import { assertOpenXml } from "./assertOpenXml";
import { readOffice } from "./officeReader";
import { MAX_GRID_COLUMNS, MAX_GRID_ROWS } from "./DataGrid";
import { SheetGrid } from "./SheetGrid";

/** A workbook's sheets, refusing a password-protected file. */
export const readSheets = async (bytes: Uint8Array) => {
  assertOpenXml(bytes);
  return readOffice("workbook", bytes, { maxRows: MAX_GRID_ROWS, maxColumns: MAX_GRID_COLUMNS }, { lane: "viewer" });
};

const UNDRAWN_NAMES: Record<UndrawnFeature, string> = {
  charts: "图表",
  images: "图片",
  shapes: "形状",
  comments: "批注",
  conditionalFormatting: "条件格式",
  dataValidation: "数据验证",
  sparklines: "迷你图",
  pivotTables: "数据透视表",
};

const listed = new Intl.ListFormat("zh-CN", { type: "conjunction" });

// "Charts and conditional formatting aren't shown.", so the preview is not taken for the whole sheet.
const undrawnNotice = (undrawn: readonly UndrawnFeature[]): string => {
  const names = listed.format(undrawn.map((feature) => UNDRAWN_NAMES[feature]));
  return `未显示${names}。`;
};

/** An Excel workbook as it looks in Excel, one sheet at a time, with its sheet tabs along the bottom. */
export const WorkbookPreview = ({ bytes }: AttachmentPreviewProps) => {
  const { sheets, styles } = use(derivedFrom(bytes, readSheets));
  const [active, setActive] = useState(0);
  const sheet = sheets[active];

  if (!sheet) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-kumo-subtle">
        此工作簿没有可显示的工作表。
      </div>
    );
  }

  const notices = [
    sheet.undrawn.length > 0 ? undrawnNotice(sheet.undrawn) : "",
    // Without this an empty total reads as a real, empty value.
    sheet.uncalculatedFormulas ? "文件中没有计算结果的公式显示为空。" : "",
    sheet.truncated
      ? `最多显示前 ${MAX_GRID_ROWS.toLocaleString()} 行、${MAX_GRID_COLUMNS} 列。下载文件可查看全部内容。`
      : "",
  ].filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {sheet.rowCount === 0
          ? <div className="grid h-full place-items-center text-[13px] text-kumo-subtle">此工作表为空。</div>
          : <SheetGrid key={active} sheet={sheet} styles={styles} />}
      </div>
      {notices.length > 0 && (
        <div className="shrink-0 border-t border-kumo-line bg-kumo-base px-4 py-2 text-[12px] text-kumo-subtle">
          {notices.join(" ")}
        </div>
      )}
      {sheets.length > 1 && (
        <div className="shrink-0 overflow-x-auto border-t border-kumo-line bg-kumo-base px-3 py-2">
          <Tabs
            size="sm"
            value={String(active)}
            onValueChange={(value) => setActive(Number(value))}
            tabs={sheets.map((item, index) => ({ value: String(index), label: item.name }))}
          />
        </div>
      )}
    </div>
  );
};
