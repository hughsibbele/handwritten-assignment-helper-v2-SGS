"use client";

import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Upload, X, Camera, GripVertical, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Preview {
  id: string;
  file: File;
  url: string;
}

interface PhotoDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export function PhotoDropzone({
  onFilesSelected,
  disabled,
}: PhotoDropzoneProps) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: File[]) => {
    const newPreviews = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => addFiles(acceptedFiles),
    [addFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/heic": [".heic"],
      "image/heif": [".heif"],
    },
    disabled,
    multiple: true,
  });

  // DnD sensors — pointer for desktop, touch for mobile with a small
  // activation distance so scrolling doesn't accidentally trigger a drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setPreviews((prev) => {
        const oldIndex = prev.findIndex((p) => p.id === active.id);
        const newIndex = prev.findIndex((p) => p.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  function removePreview(id: string) {
    setPreviews((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function handleCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
    // Reset so the same file can be captured again
    e.target.value = "";
  }

  async function handleUpload() {
    if (previews.length === 0) return;
    const compressed = await Promise.all(
      previews.map((p) => compressImage(p.file))
    );
    onFilesSelected(compressed);
  }

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
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
              Tap to select photos of your writing
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              JPG, PNG, WebP, or HEIC
            </p>
          </>
        )}
      </div>

      {/* Camera button — useful on mobile, harmless on desktop */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraCapture}
        disabled={disabled}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
      >
        <Camera className="mr-2 h-4 w-4" />
        Take Photo
      </Button>

      {/* Sortable preview grid */}
      {previews.length > 0 && (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={previews.map((p) => p.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {previews.map((preview, index) => (
                  <SortablePhoto
                    key={preview.id}
                    preview={preview}
                    index={index}
                    onRemove={removePreview}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {previews.length > 1 && (
            <p className="text-center text-xs text-muted-foreground">
              Drag to reorder pages
            </p>
          )}

          <Button
            onClick={handleUpload}
            disabled={disabled}
            className="w-full"
          >
            <ImageIcon className="mr-2 h-4 w-4" />
            Upload {previews.length} page{previews.length !== 1 ? "s" : ""}
          </Button>
        </>
      )}
    </div>
  );
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
const HEIC_TYPES = ["image/heic", "image/heif"];

/** Convert HEIC/HEIF to JPEG blob using heic2any (needed for Chrome). */
async function heicToJpeg(file: File): Promise<Blob> {
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  return Array.isArray(result) ? result[0] : result;
}

/**
 * Compress an image file: convert HEIC→JPEG if needed, then resize via Canvas API.
 * Resizes to MAX_DIMENSION on the longest side and re-encodes as JPEG.
 */
async function compressImage(file: File): Promise<File> {
  let source: Blob = file;

  // Convert HEIC/HEIF to JPEG first (needed on Chrome/Firefox)
  const isHeic =
    HEIC_TYPES.includes(file.type) ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name);

  if (isHeic) {
    try {
      source = await heicToJpeg(file);
    } catch {
      // Safari can decode HEIC natively — fall through to canvas path
    }
  }

  // If already small enough after any HEIC conversion, skip resize
  if (source.size <= 1024 * 1024) {
    if (source === file) return file;
    const name = file.name.replace(/\.[^.]+$/, ".jpg");
    return new File([source], name, { type: "image/jpeg" });
  }

  try {
    const bitmap = await createImageBitmap(source);
    const { width, height } = bitmap;

    // Calculate new dimensions preserving aspect ratio
    let newWidth = width;
    let newHeight = height;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width > height) {
        newWidth = MAX_DIMENSION;
        newHeight = Math.round(height * (MAX_DIMENSION / width));
      } else {
        newHeight = MAX_DIMENSION;
        newWidth = Math.round(width * (MAX_DIMENSION / height));
      }
    }

    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
    bitmap.close();

    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
    });

    const name = file.name.replace(/\.[^.]+$/, ".jpg");
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    // Last resort — return whatever we have
    if (source !== file) {
      const name = file.name.replace(/\.[^.]+$/, ".jpg");
      return new File([source], name, { type: "image/jpeg" });
    }
    return file;
  }
}

function SortablePhoto({
  preview,
  index,
  onRemove,
}: {
  preview: Preview;
  index: number;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: preview.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <div
        className={`aspect-[3/4] overflow-hidden rounded-lg border bg-muted ${
          isDragging ? "ring-2 ring-primary" : ""
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview.url}
          alt={`Page ${index + 1}`}
          className="h-full w-full object-cover"
        />
      </div>

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1 rounded bg-black/50 p-1 text-white touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Remove button — always visible (no hover trick, works on touch) */}
      <button
        onClick={() => onRemove(preview.id)}
        className="absolute -right-2 -top-2 rounded-full bg-destructive p-1.5 text-destructive-foreground"
        aria-label={`Remove page ${index + 1}`}
      >
        <X className="h-3 w-3" />
      </button>

      <p className="mt-1 text-center text-xs text-muted-foreground">
        Page {index + 1}
      </p>
    </div>
  );
}
