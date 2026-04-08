'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useIngestRecipe } from '@/lib/hooks';
import { getIngestStatus, getIngestReview, confirmIngest, importRecipeFromUrl, ingestReceipt } from '@/lib/api';
import { ReceiptReview } from '@/components/ReceiptReview';
import type { IngestReviewPayload, ReceiptItem } from '@/lib/types';

const MAX_DIMENSION = 1500;
const JPEG_QUALITY = 0.85;
const FINGERPRINT_SIZE = 16; // px — tiny canvas used for duplicate detection
const DUPLICATE_THRESHOLD = 0.92; // fraction of pixels that must match to flag as duplicate

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

// ── EXIF parser ───────────────────────────────────────────────────────────────
// Reads the orientation tag directly from the JPEG binary.
// Returns 1 (no rotation) when orientation cannot be determined.

function readExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint16(0, false) !== 0xFFD8) return 1;
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    const segLen = view.getUint16(offset + 2, false);
    if (marker === 0xFFE1) {
      if (view.getUint32(offset + 4, false) !== 0x45786966) break; // not "Exif"
      const tiff = offset + 10;
      const le = view.getUint16(tiff, false) === 0x4949;
      const get16 = (o: number) => view.getUint16(o, le);
      const get32 = (o: number) => view.getUint32(o, le);
      const ifd0 = tiff + get32(tiff + 4);
      const entries = get16(ifd0);
      for (let i = 0; i < entries; i++) {
        const e = ifd0 + 2 + i * 12;
        if (e + 12 > view.byteLength) break;
        if (get16(e) === 0x0112) return get16(e + 8); // Orientation tag
      }
      break;
    }
    offset += 2 + segLen;
  }
  return 1;
}

/**
 * LIGHTWEIGHT IMAGE PIPELINE
 * To prevent memory crashes on mobile devices, we skip the heavy Sobel-edge detection 
 * and large canvas rotations during ingestion. 
 * Users can rotate the final image on the recipe detail page if needed.
 */
async function processImage(file: File): Promise<File> {
  return file;
}

// ── Duplicate detection ───────────────────────────────────────────────────────
// Decodes a File to a tiny FINGERPRINT_SIZE×FINGERPRINT_SIZE canvas and
// returns the flattened RGBA pixel array for similarity comparison.

async function fingerprintImage(file: File): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = FINGERPRINT_SIZE;
  c.height = FINGERPRINT_SIZE;
  c.getContext('2d')!.drawImage(bitmap, 0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
  bitmap.close();
  return c.getContext('2d')!.getImageData(0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE).data;
}

function pixelSimilarity(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const TOLERANCE = 20; // per-channel delta allowed before counting as "different"
  let matches = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) <= TOLERANCE &&
      Math.abs(a[i + 1] - b[i + 1]) <= TOLERANCE &&
      Math.abs(a[i + 2] - b[i + 2]) <= TOLERANCE
    ) matches++;
  }
  return matches / pixels;
}

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
  const [capturedPhotos, setCapturedPhotos] = useState<{ file: File; url: string }[]>([]);
  const [photoRotations, setPhotoRotations] = useState<number[]>([0, 0]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reviewPayload, setReviewPayload] = useState<IngestReviewPayload | null>(null);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<{ id: string; title: string } | null>(null);
  const [uploadTab, setUploadTab] = useState<'scan' | 'url' | 'receipt'>('scan');
  const [urlInput, setUrlInput] = useState('');
  const [receiptFlowState, setReceiptFlowState] = useState<'upload' | 'extracting' | 'review'>('upload');
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[] | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptInputMode, setReceiptInputMode] = useState<'photo' | 'pdf' | 'text'>('photo');
  const [receiptText, setReceiptText] = useState('');
  const receiptCameraRef = useRef<HTMLInputElement>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const receiptPdfRef = useRef<HTMLInputElement>(null);
  const [urlLoading, setUrlLoading] = useState(false);
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
      capturedPhotos.forEach((p) => URL.revokeObjectURL(p.url));
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

  // Apply canvas rotation to a File (used at upload time)
  async function applyRotation(file: File, degrees: number): Promise<File> {
    if (degrees === 0) return file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const rad = (degrees * Math.PI) / 180;
    if (degrees === 90 || degrees === 270) {
      canvas.width = bitmap.height;
      canvas.height = bitmap.width;
    } else {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  }

  // File picker: replaces all selected files (supports multi-select)
  async function handleFilesSelected(files: FileList | null) {
    try {
      if (!files || files.length === 0) return;
      const raw = Array.from(files).slice(0, 2);
      const resized = await Promise.all(raw.map(processImage));
      // Revoke old URLs and create new ones outside the state updater —
      // side effects inside state updaters can throw outside your try/catch
      // and trigger React's error boundary (the "Application error" screen).
      capturedPhotos.forEach((p) => URL.revokeObjectURL(p.url));
      const newPhotos = resized.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
      setCapturedPhotos(newPhotos);
      setPhotoRotations([0, 0]);
    } catch (err: any) {
      alert(`Photo capture error: ${err.message || 'Unknown error'}`);
    }
  }

  // Camera: accumulates up to 2 photos (each capture = one photo)
  async function handleCameraCapture(files: FileList | null) {
    try {
      if (!files || files.length === 0) return;
      // Extract the file BEFORE resetting the input — iOS Safari invalidates
      // the FileList when input.value is cleared, turning files[0] into undefined.
      const raw = files[0];
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      let processed: File;
      try {
        processed = await processImage(raw);
      } catch {
        processed = raw;
      }
      // Create the URL and update state outside of a state-updater callback.
      // URL.createObjectURL / revokeObjectURL inside a setState updater run
      // during React's render cycle — if they throw, React's error boundary
      // catches it instead of your try/catch, causing the "Application error" screen.
      const newUrl = URL.createObjectURL(processed);
      const newItem = { file: processed, url: newUrl };
      if (capturedPhotos.length >= 2) {
        URL.revokeObjectURL(capturedPhotos[1].url);
        setCapturedPhotos([capturedPhotos[0], newItem]);
        setPhotoRotations((r) => [r[0], 0]);
      } else {
        setCapturedPhotos([...capturedPhotos, newItem]);
        setPhotoRotations((r) => [...r.slice(0, capturedPhotos.length), 0]);
      }
    } catch (err: any) {
      alert(`Camera error: ${err.message || 'Unknown error'}`);
    }
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
    if (capturedPhotos.length !== 2) return;

    // Apply any user-requested rotations before fingerprinting or uploading
    const rotatedFiles = await Promise.all(
      capturedPhotos.map((p, i) => applyRotation(p.file, photoRotations[i] ?? 0)),
    );

    // Duplicate check — compare pixel fingerprints before paying for a Bedrock call
    try {
      const [fpA, fpB] = await Promise.all(rotatedFiles.map((f) => fingerprintImage(f)));
      const similarity = pixelSimilarity(fpA, fpB);
      if (similarity >= DUPLICATE_THRESHOLD) {
        setProcessingError(
          'Both photos look like the same side of the card. Please take one photo of the front and one of the back.',
        );
        return;
      }
    } catch {
      // If fingerprinting fails for any reason, proceed anyway
    }

    const fd = new FormData();
    rotatedFiles.forEach((f) => fd.append('images', f));

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

  async function handleConfirm(force = false) {
    if (!jobId || !reviewPayload) return;
    setConfirmLoading(true);
    try {
      const recipe = await confirmIngest(jobId, reviewPayload.parsed_recipe, force);
      setSavedRecipeId(recipe.id);
      setFlowState('done');
    } catch (err: any) {
      if (err.status === 409 && err.body?.detail?.code === 'DUPLICATE_RECIPE') {
        setDuplicateInfo({
          id: err.body.detail.duplicate_recipe_id,
          title: err.body.detail.duplicate_recipe_title,
        });
      } else {
        setProcessingError(err.message ?? 'Confirmation failed');
      }
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleUrlImport() {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    setProcessingError(null);
    try {
      const { job_id } = await importRecipeFromUrl(urlInput.trim());
      setJobId(job_id);
      const payload = await getIngestReview(job_id);
      setReviewPayload(payload);
      setFlowState('review');
    } catch (err: any) {
      setProcessingError(err.message ?? 'Failed to import recipe from URL');
    } finally {
      setUrlLoading(false);
    }
  }

  async function handleReceiptSubmit(source: File | FileList | string) {
    setReceiptError(null);
    setReceiptFlowState('extracting');
    const fd = new FormData();
    if (typeof source === 'string') {
      fd.append('text_content', source);
    } else if (source instanceof File) {
      fd.append('pdf', source);
    } else {
      Array.from(source).forEach((f) => fd.append('images', f));
    }
    try {
      const result = await ingestReceipt(fd);
      setReceiptItems(result.items);
      setReceiptFlowState('review');
    } catch (err: any) {
      setReceiptError(err?.message ?? 'Receipt processing failed. Please try again.');
      setReceiptFlowState('upload');
    }
  }

  function handleStartOver() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickerRef.current) clearInterval(tickerRef.current);
    setFlowState('upload');
    setCapturedPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
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
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Add Recipe</h1>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          <button
            onClick={() => setUploadTab('scan')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              uploadTab === 'scan'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Scan Card
          </button>
          <button
            onClick={() => setUploadTab('url')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              uploadTab === 'url'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Import URL
          </button>
          <button
            onClick={() => setUploadTab('receipt')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              uploadTab === 'receipt'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Receipt
          </button>
        </div>

        {processingError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
            {processingError}
          </div>
        )}

        {/* URL import panel */}
        {uploadTab === 'url' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Paste a recipe URL from BBC Good Food, AllRecipes, or any recipe site.
            </p>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
              placeholder="https://www.bbcgoodfood.com/recipes/..."
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
            />
            <button
              onClick={handleUrlImport}
              disabled={!urlInput.trim() || urlLoading}
              className="w-full py-4 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {urlLoading ? 'Fetching recipe…' : 'Fetch Recipe'}
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              Works best with structured recipe pages. JavaScript-heavy sites may not work.
            </p>
          </div>
        )}

        {/* Receipt tab */}
        {uploadTab === 'receipt' && (
          <div className="space-y-4">
            {receiptFlowState === 'review' && receiptItems ? (
              <ReceiptReview
                items={receiptItems}
                onDone={() => {
                  setReceiptFlowState('upload');
                  setReceiptItems(null);
                  setReceiptText('');
                }}
              />
            ) : (
              <>
                {/* Sub-tab: photo / pdf / text */}
                <div className="flex gap-1 bg-gray-50 dark:bg-gray-900 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                  {(['photo', 'pdf', 'text'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setReceiptInputMode(mode)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                        receiptInputMode === mode
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {mode === 'photo' ? 'Photo' : mode === 'pdf' ? 'PDF' : 'Paste Text'}
                    </button>
                  ))}
                </div>

                {receiptError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
                    {receiptError}
                  </div>
                )}

                {receiptInputMode === 'photo' && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Take a photo of your supermarket receipt or upload an image.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => receiptCameraRef.current?.click()}
                        className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-500 hover:text-emerald-700 transition-colors bg-white dark:bg-gray-800"
                      >
                        <span className="text-3xl">📷</span>
                        <span className="text-sm font-medium">Camera</span>
                      </button>
                      <button
                        onClick={() => receiptFileRef.current?.click()}
                        className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-500 hover:text-emerald-700 transition-colors bg-white dark:bg-gray-800"
                      >
                        <span className="text-3xl">📁</span>
                        <span className="text-sm font-medium">Choose File</span>
                      </button>
                    </div>
                    <input
                      ref={receiptCameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => { if (e.target.files?.length) handleReceiptSubmit(e.target.files); }}
                    />
                    <input
                      ref={receiptFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { if (e.target.files?.length) handleReceiptSubmit(e.target.files); }}
                    />
                    {receiptFlowState === 'extracting' && (
                      <div className="text-center py-6 space-y-2">
                        <div className="w-8 h-8 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin mx-auto" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">Reading your receipt…</p>
                      </div>
                    )}
                  </div>
                )}

                {receiptInputMode === 'pdf' && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Upload an Ocado, Amazon Fresh, or other grocery order PDF.
                    </p>
                    <button
                      onClick={() => receiptPdfRef.current?.click()}
                      disabled={receiptFlowState === 'extracting'}
                      className="w-full flex flex-col items-center gap-2 p-6 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl text-gray-600 dark:text-gray-300 hover:border-emerald-300 hover:text-emerald-700 transition-colors bg-white dark:bg-gray-800 disabled:opacity-50"
                    >
                      <span className="text-3xl">📄</span>
                      <span className="text-sm font-medium">
                        {receiptFlowState === 'extracting' ? 'Processing…' : 'Choose PDF'}
                      </span>
                    </button>
                    <input
                      ref={receiptPdfRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) handleReceiptSubmit(e.target.files[0]); }}
                    />
                    {receiptFlowState === 'extracting' && (
                      <div className="text-center py-4 space-y-2">
                        <div className="w-8 h-8 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin mx-auto" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">Extracting items from PDF…</p>
                      </div>
                    )}
                  </div>
                )}

                {receiptInputMode === 'text' && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Paste the text from an online order confirmation email.
                    </p>
                    <textarea
                      value={receiptText}
                      onChange={(e) => setReceiptText(e.target.value)}
                      placeholder="Paste your order items here…"
                      rows={8}
                      className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                    />
                    <button
                      onClick={() => receiptText.trim() && handleReceiptSubmit(receiptText.trim())}
                      disabled={!receiptText.trim() || receiptFlowState === 'extracting'}
                      className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {receiptFlowState === 'extracting' ? 'Processing…' : 'Extract Items'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Upload buttons */}
        {uploadTab === 'scan' && <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-500 hover:text-emerald-700 transition-colors bg-white dark:bg-gray-800"
          >
            <span className="text-3xl">📷</span>
            <span className="text-sm font-medium">
              {capturedPhotos.length === 0 ? 'Take Photo' : capturedPhotos.length === 1 ? 'Add 2nd Photo' : 'Retake Photo'}
            </span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl text-gray-600 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-500 hover:text-emerald-700 transition-colors bg-white dark:bg-gray-800"
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
        </div>}

        {uploadTab === 'scan' && <>
          {/* Previews */}
          {capturedPhotos.length > 0 && (
            <div className="flex gap-3">
              {capturedPhotos.map((p, i) => (
                <div key={i} className="relative flex-1 aspect-video rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                  <img
                    src={p.url}
                    alt={`Preview ${i + 1}`}
                    className="w-full h-full object-contain transition-transform duration-300"
                    style={{ transform: `rotate(${photoRotations[i] ?? 0}deg)` }}
                  />
                  <button
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setCapturedPhotos((prev) => prev.filter((_, idx) => idx !== i));
                      setPhotoRotations((r) => r.map((v, ri) => (ri === i ? 0 : v)));
                    }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white text-xs flex items-center justify-center hover:bg-black/70"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                  <button
                    onClick={() => setPhotoRotations((r) => r.map((v, ri) => (ri === i ? (v + 90) % 360 : v)))}
                    className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
                    aria-label="Rotate photo"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <span className="absolute bottom-1 left-1 text-xs bg-black/40 text-white px-1.5 py-0.5 rounded">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {capturedPhotos.length === 1 && (
            <p className="text-sm text-center text-amber-600 dark:text-amber-400 font-medium">
              Add the other side of the card to continue
            </p>
          )}
          <button
            onClick={handleUpload}
            disabled={capturedPhotos.length !== 2 || ingestMutation.isPending}
            className="w-full py-4 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {ingestMutation.isPending ? 'Uploading...' : capturedPhotos.length === 2 ? 'Upload & Process' : `${capturedPhotos.length}/2 photos — add ${2 - capturedPhotos.length} more`}
          </button>
        </>}
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
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 shadow-sm'
                    : done
                    ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 opacity-50'
                    : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 opacity-30'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${
                  active ? 'bg-emerald-100 dark:bg-emerald-900/40' : done ? 'bg-gray-100 dark:bg-gray-700' : 'bg-gray-50 dark:bg-gray-800'
                }`}>
                  {done ? '✅' : active ? (
                    <span className="inline-block animate-spin">⚙️</span>
                  ) : stage.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${active ? 'text-emerald-800 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-400'}`}>
                    {stage.label}
                  </p>
                  {active && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 truncate">{funMessage}</p>
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
          className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-center"
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
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Review Recipe</h1>
          <button onClick={handleStartOver} className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            Start Over
          </button>
        </div>

        {processingError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
            {processingError}
          </div>
        )}

        {/* Parsed recipe summary */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm space-y-2">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-base">{pr?.title ?? 'Unknown title'}</h2>
          <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
            {pr?.cooking_time_mins && <span>⏱ {pr.cooking_time_mins} min</span>}
            {pr?.base_servings && <span>👥 Serves {pr.base_servings}</span>}
          </div>
          {pr?.mood_tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pr.mood_tags.map((tag: string) => (
                <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ingredients */}
        {pr?.ingredients?.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Ingredients</h3>
            <ul className="space-y-1.5">
              {pr.ingredients.map((ing: any, i: number) => {
                const isUnresolved = reviewPayload.unresolved_ingredients.includes(ing.raw_name ?? ing.name ?? '');
                return (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span>{isUnresolved ? '⚠️' : '✅'}</span>
                    <span className={isUnresolved ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-800 dark:text-gray-200'}>
                      {ing.raw_name ?? ing.name}
                    </span>
                    {ing.quantity && (
                      <span className="text-gray-400 dark:text-gray-500 text-xs ml-auto">
                        {ing.quantity} {ing.unit ?? ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {reviewPayload.unresolved_ingredients.length > 0 && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                ⚠️ {reviewPayload.unresolved_ingredients.length} ingredient(s) could not be automatically resolved
              </p>
            )}
          </div>
        )}

        {/* Steps */}
        {pr?.steps?.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Steps ({pr.steps.length})</h3>
            <ol className="space-y-2">
              {pr.steps.map((step: any, i: number) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step.text ?? step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <button
          onClick={() => handleConfirm(false)}
          disabled={confirmLoading}
          className="w-full py-4 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {confirmLoading ? 'Saving...' : 'Confirm Recipe'}
        </button>

        {/* Duplicate detection modal */}
        {duplicateInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Possible duplicate</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    This recipe card looks similar to <span className="font-medium text-gray-700 dark:text-gray-200">{duplicateInfo.title}</span> already in your library.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  href={`/recipes/${duplicateInfo.id}`}
                  className="w-full py-2.5 text-center bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors text-sm"
                >
                  View existing recipe
                </Link>
                <button
                  onClick={() => { setDuplicateInfo(null); handleConfirm(true); }}
                  disabled={confirmLoading}
                  className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm disabled:opacity-50"
                >
                  Save anyway
                </button>
                <button
                  onClick={() => setDuplicateInfo(null)}
                  className="w-full py-2.5 text-gray-400 dark:text-gray-500 text-sm hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ---- Done step ----
  if (flowState === 'done') {
    return (
      <main className="max-w-lg mx-auto px-4 pt-16 pb-4 flex flex-col items-center gap-5 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-3xl">
          ✅
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Recipe Saved!</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Your recipe card has been added to the library</p>
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
            className="flex-1 py-3.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Scan Another
          </button>
        </div>
      </main>
    );
  }

  return null;
}
