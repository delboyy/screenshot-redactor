"use client";

import React from "react";
import { useRouter } from "next/navigation";

type UploadDropzoneProps = {
  className?: string;
};

/**
 * UploadDropzone
 * - Drag & drop, click-to-upload, and paste-from-clipboard support
 * - Stores the image as a Data URL in sessionStorage to keep everything client-side
 * - Navigates to /redact after successful load
 */
export function UploadDropzone({ className }: UploadDropzoneProps) {
  const router = useRouter();
  const [isDragging, setIsDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.type.startsWith("image/")) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (dataUrl) {
            sessionStorage.setItem("sr:imageDataURL", dataUrl);
            sessionStorage.setItem("sr:filename", file.name || "screenshot.png");
            router.push("/redact");
          }
        } catch (err) {
          // In a real app, surface a toast. Keeping minimal for MVP.
          console.error(err);
        }
      };
      reader.readAsDataURL(file);
    },
    [router]
  );

  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            handleFiles({ 0: file, length: 1, item: () => file } as unknown as FileList);
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFiles]);

  return (
    <div
      className={[
        "w-full max-w-2xl",
        "rounded-xl border border-dashed",
        isDragging ? "border-primary bg-secondary/50" : "border-border bg-card",
        "p-6 md:p-10 text-center cursor-pointer select-none",
        "transition-colors",
        className ?? "",
      ].join(" ")}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer?.files ?? null);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      aria-label="Upload screenshot"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.currentTarget.files)}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <span className="text-xl">⬆️</span>
        </div>
        <p className="text-base font-medium">Drop a screenshot, click to upload, or paste from clipboard</p>
        <p className="text-sm text-muted-foreground">All processing stays in your browser. No uploads.</p>
      </div>
    </div>
  );
}

export default UploadDropzone;


