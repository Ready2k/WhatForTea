'use client';

import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { cropRecipePhoto, autoCropRecipePhoto } from '@/lib/api';

interface ImageCropModalProps {
  recipeId: string;
  imageIndex: number;
  imageVersion: number;
  onClose: () => void;
  /** Called after a successful crop/auto-crop so the parent can bust its cache */
  onSaved: () => void;
}

function defaultCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, width / height, width, height),
    width,
    height,
  );
}

export function ImageCropModal({
  recipeId,
  imageIndex,
  imageVersion,
  onClose,
  onSaved,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoCropping, setIsAutoCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const imageUrl = `/api/v1/recipes/${recipeId}/image?index=${imageIndex}&v=${imageVersion}`;

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    setCrop(defaultCrop(width, height));
  }, []);

  const handleApply = async () => {
    if (!completedCrop || !imgRef.current) return;
    const img = imgRef.current;
    // Convert pixel crop to fractions of the natural image size
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const fracCrop = {
      x:      (completedCrop.x * scaleX) / img.naturalWidth,
      y:      (completedCrop.y * scaleY) / img.naturalHeight,
      width:  (completedCrop.width * scaleX) / img.naturalWidth,
      height: (completedCrop.height * scaleY) / img.naturalHeight,
    };
    setIsSaving(true);
    setError(null);
    try {
      await cropRecipePhoto(recipeId, fracCrop, imageIndex);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save crop');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoCrop = async () => {
    setIsAutoCropping(true);
    setError(null);
    try {
      await autoCropRecipePhoto(recipeId, imageIndex);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Auto-crop failed');
    } finally {
      setIsAutoCropping(false);
    }
  };

  const busy = isSaving || isAutoCropping;

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/95 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
        <h2 className="text-white font-semibold text-sm">Crop Image</h2>
        <button
          onClick={onClose}
          disabled={busy}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-40"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Crop area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <ReactCrop
          crop={crop}
          onChange={(_, percentCrop) => setCrop(percentCrop)}
          onComplete={(c) => setCompletedCrop(c)}
          minWidth={20}
          minHeight={20}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Crop preview"
            onLoad={onImageLoad}
            style={{ maxWidth: '100%', maxHeight: 'calc(100dvh - 180px)', objectFit: 'contain' }}
          />
        </ReactCrop>
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-xs text-center px-4 pb-2 flex-shrink-0">{error}</p>
      )}

      {/* Controls */}
      <div className="flex gap-3 px-4 pb-6 pt-3 flex-shrink-0 border-t border-white/10">
        {/* Auto-crop */}
        <button
          onClick={handleAutoCrop}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors shadow-lg"
        >
          {isAutoCropping ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Auto-cropping…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Auto-crop
            </>
          )}
        </button>

        {/* Apply manual crop */}
        <button
          onClick={handleApply}
          disabled={busy || !completedCrop}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors shadow-lg"
        >
          {isSaving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Saving…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Apply crop
            </>
          )}
        </button>
      </div>
    </div>,
    document.body,
  );
}
