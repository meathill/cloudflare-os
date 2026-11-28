import { useState } from "react";
import { AttachmentPreviewError, type AttachmentPreviewProps } from "../attachmentPreviewers";
import { useObjectUrl } from "../useObjectUrl";

/** An image, scaled down to fit. An `<img>` never runs an SVG's scripts. */
export const ImagePreview = ({ bytes, name, mimeType }: AttachmentPreviewProps) => {
  const url = useObjectUrl(bytes, mimeType);
  const [failed, setFailed] = useState(false);
  if (failed) throw new AttachmentPreviewError("无法显示此图片，文件可能已损坏。");
  return (
    <div className="grid h-full place-items-center p-4">
      {url && (
        <img
          src={url}
          alt={name}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      )}
    </div>
  );
};
