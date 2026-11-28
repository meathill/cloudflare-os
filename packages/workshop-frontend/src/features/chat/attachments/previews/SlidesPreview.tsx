import { use, useEffect, useRef, useState } from "react";
import type { SlideDeck, SlideUnsupportedKind } from "@gadgets/office-content/pptx-slides";
import type { AttachmentPreviewProps } from "../attachmentPreviewers";
import { derivedFrom } from "../derivedFrom";
import { assertOpenXml } from "./assertOpenXml";
import { readOffice } from "./officeReader";
import { SlideFrame } from "./SlideFrame";

/** Slides are drawn no wider than this, however wide the viewer. */
const MAX_SLIDE_WIDTH = 960;

const UNSUPPORTED_NAMES: Record<SlideUnsupportedKind, string> = {
  chart: "图表",
  diagram: "SmartArt",
  object: "嵌入对象",
  picture: "部分图片",
};

/** A deck's slides, refusing a password-protected file. */
export const readDeck = async (bytes: Uint8Array): Promise<SlideDeck> => {
  assertOpenXml(bytes);
  return readOffice("slides", bytes, {}, { lane: "viewer" });
};

const listFormat = new Intl.ListFormat("zh-CN", { type: "conjunction" });

/** What the preview leaves out, for the notice above the slides. */
const omissions = (deck: SlideDeck): string | null => {
  const parts: string[] = [];
  if (deck.unsupported.length > 0) {
    const names = listFormat.format(deck.unsupported.map((kind) => UNSUPPORTED_NAMES[kind]));
    parts.push(`未绘制${names}。`);
  }
  if (deck.truncated) parts.push(`仅显示前 ${deck.slides.length} 张幻灯片。`);
  return parts.length > 0 ? `${parts.join("")}下载文件可查看全部内容。` : null;
};

/** A PowerPoint deck, each slide drawn as the file lays it out. */
export const SlidesPreview = ({ bytes }: AttachmentPreviewProps) => {
  const deck = use(derivedFrom(bytes, readDeck));
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.min(MAX_SLIDE_WIDTH, Math.floor(entry.contentRect.width)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const notice = omissions(deck);
  return (
    <div className="min-h-full">
      {notice && (
        <div className="sticky top-0 z-10 border-b border-kumo-line bg-kumo-elevated px-4 py-2 text-center text-[12px] leading-4 text-kumo-subtle">
          {notice}
        </div>
      )}
      <div className="px-4 py-4">
        <div ref={containerRef} className="flex flex-col items-center gap-3">
          {deck.slides.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-kumo-subtle">此演示文稿没有幻灯片。</div>
          ) : width > 0 && deck.slides.map((slide) => (
            <SlideFrame
              key={slide.number}
              slide={slide}
              slideWidth={deck.width}
              slideHeight={deck.height}
              width={width}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
