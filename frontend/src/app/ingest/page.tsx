'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useIngestRecipe } from '@/lib/hooks';
import { getIngestStatus, getIngestReview, confirmIngest } from '@/lib/api';
import type { IngestReviewPayload } from '@/lib/types';

type FlowState = 'upload' | 'processing' | 'review' | 'done';

export default function IngestPage() {
  const [flowState, setFlowState] = useState<FlowState>('upload');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reviewPayload, setReviewPayload] = useState<IngestReviewPayload | null>(null);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ingestMutation = useIngestRecipe();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Revoke preview URLs on unmount
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).slice(0, 2);
    setSelectedFiles(arr);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews(arr.map((f) => URL.createObjectURL(f)));
  }

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const status = await getIngestStatus(id);
        if (status.status === 'review' || status.status === 'complete') {
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
      const result = await ingestMutation.mutateAsync(fd);
      setJobId(result.job_id);
      setProcessingError(null);
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
    setFlowState('upload');
    setSelectedFiles([]);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews([]);
    setJobId(null);
    setReviewPayload(null);
    setSavedRecipeId(null);
    setProcessingError(null);
  }

  // ---- Upload step ----
  if (flowState === 'upload') {
    return (
      <main className="max-w-lg mx-auto px-4 pt-6 pb-4 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Scan Recipe Card</h1>
          <p className="text-sm text-gray-500 mt-1">Upload up to 2 images of a recipe card</p>
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
            <span className="text-sm font-medium">Take Photo</span>
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
            onChange={(e) => handleFilesSelected(e.target.files)}
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
              <div key={i} className="flex-1 aspect-video rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
                <img src={url} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
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
    return (
      <main className="max-w-lg mx-auto px-4 pt-16 pb-4 flex flex-col items-center gap-6">
        <div className="w-16 h-16 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Analysing your recipe card...</p>
          <p className="text-sm text-gray-500 mt-1">This usually takes 10–20 seconds</p>
        </div>
        <button
          onClick={handleStartOver}
          className="text-sm text-gray-400 hover:text-gray-600 mt-4"
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
