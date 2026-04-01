'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useIngestRecipe } from '@/lib/hooks';

const MAX_DIMENSION = 1500;
const JPEG_QUALITY = 0.85;

// ── Card bounds detection (Sobel + projection) ────────────────────────────────

function detectCardBounds(
  canvas: HTMLCanvasElement,
): { x1: number; y1: number; x2: number; y2: number } {
  const { width, height } = canvas;
  const WORK = 400;
  const scale = Math.min(1, WORK / Math.max(width, height));
  const ww = Math.round(width * scale);
  const wh = Math.round(height * scale);

  const work = document.createElement('canvas');
  work.width = ww;
  work.height = wh;
  work.getContext('2d')!.drawImage(canvas, 0, 0, ww, wh);
  const { data } = work.getContext('2d')!.getImageData(0, 0, ww, wh);

  const g = new Float32Array(ww * wh);
  for (let i = 0; i < ww * wh; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const rowE = new Float32Array(wh);
  const colE = new Float32Array(ww);
  for (let y = 1; y < wh - 1; y++) {
    for (let x = 1; x < ww - 1; x++) {
      const gx =
        -g[(y - 1) * ww + x - 1] + g[(y - 1) * ww + x + 1] +
        -2 * g[y * ww + x - 1]   + 2 * g[y * ww + x + 1] +
        -g[(y + 1) * ww + x - 1] + g[(y + 1) * ww + x + 1];
      const gy =
        -g[(y - 1) * ww + x - 1] - 2 * g[(y - 1) * ww + x] - g[(y - 1) * ww + x + 1] +
        g[(y + 1) * ww + x - 1]  + 2 * g[(y + 1) * ww + x] + g[(y + 1) * ww + x + 1];
      rowE[y] += Math.sqrt(gx * gx + gy * gy);
      colE[x] += Math.sqrt(gx * gx + gy * gy);
    }
  }

  const rowMax = Math.max(1, ...Array.from(rowE));
  const colMax = Math.max(1, ...Array.from(colE));
  const T = 0.08;

  let y1 = 0, y2 = wh - 1, x1 = 0, x2 = ww - 1;
  for (let y = 0; y < wh; y++)      { if (rowE[y] / rowMax > T) { y1 = y; break; } }
  for (let y = wh - 1; y >= 0; y--) { if (rowE[y] / rowMax > T) { y2 = y; break; } }
  for (let x = 0; x < ww; x++)      { if (colE[x] / colMax > T) { x1 = x; break; } }
  for (let x = ww - 1; x >= 0; x--) { if (colE[x] / colMax > T) { x2 = x; break; } }

  // Skip crop unless it removes at least 5% from some edge AND keeps >70% of the image
  const cropFraction = (x2 - x1) * (y2 - y1) / (ww * wh);
  const trimsFraction = 1 - cropFraction;
  if (trimsFraction < 0.05 || cropFraction < 0.70) return { x1: 0, y1: 0, x2: width, y2: height };

  const px = Math.round(ww * 0.015);
  const py = Math.round(wh * 0.015);
  return {
    x1: Math.max(0,      Math.round((x1 - px) / scale)),
    y1: Math.max(0,      Math.round((y1 - py) / scale)),
    x2: Math.min(width,  Math.round((x2 + px) / scale)),
    y2: Math.min(height, Math.round((y2 + py) / scale)),
  };
}

// ── Main image pipeline ───────────────────────────────────────────────────────
// createImageBitmap with imageOrientation:'from-image' applies EXIF rotation
// before we ever touch canvas — the most reliable cross-browser approach.
// (Chrome 84+, Firefox 90+, Safari 15+)

async function processImage(file: File): Promise<File> {
  // Decode with EXIF orientation already applied
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const w = bitmap.width;
  const h = bitmap.height;

  // Draw at natural (post-rotation) size
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  full.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Detect card bounds and crop
  const crop = detectCardBounds(full);
  const cropW = crop.x2 - crop.x1;
  const cropH = crop.y2 - crop.y1;

  // Resize so longest edge ≤ MAX_DIMENSION
  const scale = Math.min(1, MAX_DIMENSION / Math.max(cropW, cropH));
  const outW = Math.round(cropW * scale);
  const outH = Math.round(cropH * scale);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  out.getContext('2d')!.drawImage(full, crop.x1, crop.y1, cropW, cropH, 0, 0, outW, outH);

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
import { getIngestStatus, getIngestReview, confirmIngest } from '@/lib/api';
import type { IngestReviewPayload } from '@/lib/types';

type FlowState = 'upload' | 'processing' | 'review' | 'done';
type ApiStatus = 'uploading' | 'queued' | 'processing' | 'review';

const STAGES: { key: ApiStatus; label: string; icon: string }[] = [
  { key: 'uploading', label: 'Uploading photo',      icon: '📤' },
  { key: 'queued',    label: 'In the queue',          icon: '⏳' },
  { key: 'processing', label: 'Reading the card',    icon: '🤖' },
  { key: 'review',    label: 'Almost ready!',         icon: '✨' },
];

const FUN_MESSAGES: Record<ApiStatus, string[]> = {
  uploading: [
    'Squishing your photo down to size...',
    'Sending the card over...',
  ],
  queued: [
    'Waiting for the AI chef to wake up...',
    'Your card is next in line!',
    'Warming up the neural networks...',
  ],
  processing: [
    'Teaching AI to read handwriting...',
    'Counting ingredients very carefully...',
    'Figuring out what a "knob of butter" is...',
    'Converting ounces to something sensible...',
    'Interrogating the recipe for hidden steps...',
    'Making sure it\'s actually food...',
    'Cross-referencing with 10,000 HelloFresh cards...',
    'Decoding chef\'s scrawl...',
  ],
  review: [
    'Checking everything looks tasty...',
    'Almost on your plate!',
  ],
};

export default function IngestPage() {
  const [flowState, setFlowState] = useState<FlowState>('upload');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reviewPayload, setReviewPayload] = useState<IngestReviewPayload | null>(null);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('uploading');
  const [funMessageIdx, setFunMessageIdx] = useState(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ingestMutation = useIngestRecipe();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Revoke preview URLs on unmount
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cycle fun messages while processing
  useEffect(() => {
    if (flowState !== 'processing') {
      if (tickerRef.current) clearInterval(tickerRef.current);
      return;
    }
    tickerRef.current = setInterval(() => {
      setFunMessageIdx((i) => i + 1);
    }, 3500);
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, [flowState, apiStatus]);

  // File picker: replaces all selected files (supports multi-select)
  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const raw = Array.from(files).slice(0, 2);
    const resized = await Promise.all(raw.map(processImage));
    setSelectedFiles(resized);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews(resized.map((f) => URL.createObjectURL(f)));
  }

  // Camera: accumulates up to 2 photos (each capture = one photo)
  async function handleCameraCapture(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Reset the input so the same button can be pressed again
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    const [raw] = Array.from(files);
    let processed: File;
    try {
      processed = await processImage(raw);
    } catch {
      processed = raw;
    }
    setSelectedFiles((prev) => {
      const next = prev.length >= 2 ? [prev[0], processed] : [...prev, processed];
      // Revoke old previews for replaced slot, create new ones
      setPreviews((oldPreviews) => {
        oldPreviews.forEach((u) => URL.revokeObjectURL(u));
        return next.map((f) => URL.createObjectURL(f));
      });
      return next;
    });
  }

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const status = await getIngestStatus(id);
        if (status.status === 'queued') {
          setApiStatus('queued');
        } else if (status.status === 'processing') {
          setApiStatus('processing');
        } else if (status.status === 'review' || status.status === 'complete') {
          setApiStatus('review');
          clearInterval(pollRef.current!);
          pollRef.current = null;
          const payload = await getIngestReview(id);
          setReviewPayload(payload);
          setFlowState('review');
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setProcessingError(status.error_message ?? 'Processing failed');
          setFlowState('upload');
        }
      } catch (err: any) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setProcessingError(err.message ?? 'Failed to check status');
        setFlowState('upload');
      }
    }, 2000);
  }, []);

  async function handleUpload() {
    if (selectedFiles.length === 0) return;
    const fd = new FormData();
    selectedFiles.forEach((f) => fd.append('images', f));

    try {
      setApiStatus('uploading');
      setFunMessageIdx(0);
      const result = await ingestMutation.mutateAsync(fd);
      setJobId(result.job_id);
      setProcessingError(null);
      setApiStatus('queued');
      setFlowState('processing');
      startPolling(result.job_id);
    } catch (err: any) {
      setProcessingError(err.message ?? 'Upload failed');
    }
  }

  async function handleConfirm() {
    if (!jobId || !reviewPayload) return;
    setConfirmLoading(true);
    try {
      const recipe = await confirmIngest(jobId, reviewPayload.parsed_recipe);
      setSavedRecipeId(recipe.id);
      setFlowState('done');
    } catch (err: any) {
      setProcessingError(err.message ?? 'Confirmation failed');
    } finally {
      setConfirmLoading(false);
    }
  }

  function handleStartOver() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickerRef.current) clearInterval(tickerRef.current);
    setFlowState('upload');
    setSelectedFiles([]);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews([]);
    setJobId(null);
    setReviewPayload(null);
    setSavedRecipeId(null);
    setProcessingError(null);
    setApiStatus('uploading');
    setFunMessageIdx(0);
  }

  // ---- Upload step ----
  if (flowState === 'upload') {
    return (
      <main className="max-w-lg mx-auto px-4 pt-6 pb-4 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Scan Recipe Card</h1>
          <p className="text-sm text-gray-500 mt-1">Take the recipe back first, then the front cover</p>
        </div>

        {processingError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {processingError}
          </div>
        )}

        {/* Upload buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-gray-200 rounded-2xl text-gray-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors bg-white"
          >
            <span className="text-3xl">📷</span>
            <span className="text-sm font-medium">
              {selectedFiles.length === 0 ? 'Take Photo' : selectedFiles.length === 1 ? 'Add 2nd Photo' : 'Retake Photo'}
            </span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-gray-200 rounded-2xl text-gray-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors bg-white"
          >
            <span className="text-3xl">📁</span>
            <span className="text-sm font-medium">Choose File</span>
          </button>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleCameraCapture(e.target.files)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
        </div>

        {/* Previews */}
        {previews.length > 0 && (
          <div className="flex gap-3">
            {previews.map((url, i) => (
              <div key={i} className="relative flex-1 aspect-video rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
                <img src={url} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => {
                    URL.revokeObjectURL(url);
                    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i));
                    setPreviews((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white text-xs flex items-center justify-center hover:bg-black/70"
                  aria-label="Remove photo"
                >
                  ×
                </button>
                <span className="absolute bottom-1 left-1 text-xs bg-black/40 text-white px-1.5 py-0.5 rounded">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={selectedFiles.length === 0 || ingestMutation.isPending}
          className="w-full py-4 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {ingestMutation.isPending ? 'Uploading...' : 'Upload & Process'}
        </button>
      </main>
    );
  }

  // ---- Processing step ----
  if (flowState === 'processing') {
    const currentStageIdx = STAGES.findIndex((s) => s.key === apiStatus);
    const messages = FUN_MESSAGES[apiStatus];
    const funMessage = messages[funMessageIdx % messages.length];

    return (
      <main className="max-w-lg mx-auto px-4 pt-10 pb-4 flex flex-col gap-8">
        {/* Stage steps */}
        <div className="space-y-3">
          {STAGES.map((stage, idx) => {
            const done = idx < currentStageIdx;
            const active = idx === currentStageIdx;
            return (
              <div
                key={stage.key}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  active
                    ? 'bg-emerald-50 border-emerald-200 shadow-sm'
                    : done
                    ? 'bg-white border-gray-100 opacity-50'
                    : 'bg-white border-gray-100 opacity-30'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${
                  active ? 'bg-emerald-100' : done ? 'bg-gray-100' : 'bg-gray-50'
                }`}>
                  {done ? '✅' : active ? (
                    <span className="inline-block animate-spin">⚙️</span>
                  ) : stage.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${active ? 'text-emerald-800' : 'text-gray-600'}`}>
                    {stage.label}
                  </p>
                  {active && (
                    <p className="text-xs text-emerald-600 mt-0.5 truncate">{funMessage}</p>
                  )}
                </div>
                {active && (
                  <div className="w-4 h-4 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={handleStartOver}
          className="text-sm text-gray-400 hover:text-gray-600 text-center"
        >
          Cancel
        </button>
      </main>
    );
  }

  // ---- Review step ----
  if (flowState === 'review' && reviewPayload) {
    const pr = reviewPayload.parsed_recipe;
    return (
      <main className="max-w-lg mx-auto px-4 pt-6 pb-4 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Review Recipe</h1>
          <button onClick={handleStartOver} className="text-sm text-gray-400 hover:text-gray-600">
            Start Over
          </button>
        </div>

        {processingError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {processingError}
          </div>
        )}

        {/* Parsed recipe summary */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
          <h2 className="font-semibold text-gray-800 text-base">{pr?.title ?? 'Unknown title'}</h2>
          <div className="flex gap-4 text-sm text-gray-500">
            {pr?.cooking_time_mins && <span>⏱ {pr.cooking_time_mins} min</span>}
            {pr?.base_servings && <span>👥 Serves {pr.base_servings}</span>}
          </div>
          {pr?.mood_tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pr.mood_tags.map((tag: string) => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ingredients */}
        {pr?.ingredients?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Ingredients</h3>
            <ul className="space-y-1.5">
              {pr.ingredients.map((ing: any, i: number) => {
                const isUnresolved = reviewPayload.unresolved_ingredients.includes(ing.raw_name ?? ing.name ?? '');
                return (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span>{isUnresolved ? '⚠️' : '✅'}</span>
                    <span className={isUnresolved ? 'text-yellow-700' : 'text-gray-800'}>
                      {ing.raw_name ?? ing.name}
                    </span>
                    {ing.quantity && (
                      <span className="text-gray-400 text-xs ml-auto">
                        {ing.quantity} {ing.unit ?? ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {reviewPayload.unresolved_ingredients.length > 0 && (
              <p className="text-xs text-yellow-600 mt-2">
                ⚠️ {reviewPayload.unresolved_ingredients.length} ingredient(s) could not be automatically resolved
              </p>
            )}
          </div>
        )}

        {/* Steps */}
        {pr?.steps?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Steps ({pr.steps.length})</h3>
            <ol className="space-y-2">
              {pr.steps.map((step: any, i: number) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step.text ?? step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={confirmLoading}
          className="w-full py-4 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {confirmLoading ? 'Saving...' : 'Confirm Recipe'}
        </button>
      </main>
    );
  }

  // ---- Done step ----
  if (flowState === 'done') {
    return (
      <main className="max-w-lg mx-auto px-4 pt-16 pb-4 flex flex-col items-center gap-5 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">
          ✅
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Recipe Saved!</h1>
          <p className="text-sm text-gray-500 mt-1">Your recipe card has been added to the library</p>
        </div>
        <div className="flex gap-3 w-full">
          {savedRecipeId && (
            <Link
              href={`/recipes/${savedRecipeId}`}
              className="flex-1 py-3.5 bg-emerald-600 text-white text-center font-semibold rounded-2xl hover:bg-emerald-700 transition-colors"
            >
              View Recipe
            </Link>
          )}
          <button
            onClick={handleStartOver}
            className="flex-1 py-3.5 border border-gray-200 text-gray-700 font-medium rounded-2xl hover:bg-gray-50 transition-colors"
          >
            Scan Another
          </button>
        </div>
      </main>
    );
  }

  return null;
}
