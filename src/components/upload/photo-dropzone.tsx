"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PhotoDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export function PhotoDropzone({ onFilesSelected, disabled }: PhotoDropzoneProps) {
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newPreviews = acceptedFiles.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      setPreviews((prev) => [...prev, ...newPreviews]);
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/heic": [".heic"],
    },
    disabled,
    multiple: true,
  });

  function removePreview(index: number) {
    setPreviews((prev) => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleUpload() {
    if (previews.length === 0) return;
    onFilesSelected(previews.map((p) => p.file));
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <input {...getInputProps()} />
        <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
        {isDragActive ? (
          <p className="text-sm font-medium">Drop your photos here</p>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drag & drop photos of your writing
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              or click to select files (JPG, PNG, WebP, HEIC)
            </p>
          </>
        )}
      </div>

      {previews.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {previews.map((preview, index) => (
              <div key={preview.url} className="group relative">
                <div className="aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.url}
                    alt={`Page ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <button
                  onClick={() => removePreview(index)}
                  className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Page {index + 1}
                </p>
              </div>
            ))}
          </div>

          <Button onClick={handleUpload} disabled={disabled} className="w-full">
            <ImageIcon className="mr-2 h-4 w-4" />
            Upload {previews.length} page{previews.length !== 1 ? "s" : ""}
          </Button>
        </>
      )}
    </div>
  );
}
