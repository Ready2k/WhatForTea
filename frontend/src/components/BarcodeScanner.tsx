'use client';

/**
 * BarcodeScanner — modal component for scanning a product barcode and resolving
 * it to a pantry ingredient via POST /api/v1/barcode/lookup.
 *
 * Scanning: uses the BarcodeDetector Web API (Chrome/Edge on HTTPS).
 * Fallback:  manual barcode number input for browsers without BarcodeDetector.
 *
 * On success, calls onResolved({ ingredient_id, canonical_name, product_name }).
 * The caller is then responsible for prompting quantity/unit and adding to pantry.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { lookupBarcode } from '@/lib/api';
import type { BarcodeLookupResponse } from '@/lib/api';

interface Props {
  onResolved: (result: BarcodeLookupResponse) => void;
  onClose: () => void;
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'loading'; barcode: string }
  | { phase: 'result'; data: BarcodeLookupResponse }
  | { phase: 'error'; message: string };

const hasBarcodeDetector =
  typeof window !== 'undefined' && 'BarcodeDetector' in window;

export function BarcodeScanner({ onResolved, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const scanLoopRef = useRef<number | null>(null);

  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const [manualInput, setManualInput] = useState('');

  // ── Camera scanning ───────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    scanLoopRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleBarcode = useCallback(async (barcode: string) => {
    stopCamera();
    setState({ phase: 'loading', barcode });
    try {
      const data = await lookupBarcode(barcode);
      setState({ phase: 'result', data });
    } catch (err: any) {
      setState({ phase: 'error', message: err.message ?? 'Lookup failed' });
    }
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    if (!hasBarcodeDetector) return;
    setState({ phase: 'scanning' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      detectorRef.current = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
      });

      const scan = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);
          if (barcodes.length > 0) {
            await handleBarcode(barcodes[0].rawValue);
            return; // stop loop on first detection
          }
        } catch { /* ignore detection errors */ }
        scanLoopRef.current = requestAnimationFrame(scan);
      };
      scanLoopRef.current = requestAnimationFrame(scan);
    } catch (err: any) {
      setState({ phase: 'error', message: 'Camera access denied. Use manual entry below.' });
    }
  }, [handleBarcode]);

  // Clean up camera on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Manual entry ──────────────────────────────────────────────────────────
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bc = manualInput.trim();
    if (!bc) return;
    await handleBarcode(bc);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const result = state.phase === 'result' ? state.data : null;
  const isLoading = state.phase === 'loading';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center px-4 pb-4">
      <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-bold text-gray-900 dark:text-white">Scan Barcode</h2>
          <button
            onClick={() => { stopCamera(); onClose(); }}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-6 space-y-4">
          {/* Camera viewfinder */}
          {hasBarcodeDetector && state.phase !== 'result' && (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {state.phase === 'scanning' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  {/* Targeting overlay */}
                  <div className="w-48 h-32 border-2 border-white/70 rounded-lg relative">
                    <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-sm" />
                    <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-sm" />
                    <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-sm" />
                    <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-sm" />
                  </div>
                  <p className="text-white text-xs mt-3 text-shadow">Point at a barcode</p>
                </div>
              )}
              {state.phase === 'idle' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={startCamera}
                    className="px-5 py-2.5 bg-emerald-500 text-white font-semibold rounded-2xl text-sm hover:bg-emerald-600 transition-colors"
                  >
                    Start Camera
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Looking up barcode <span className="font-mono text-gray-800 dark:text-gray-200">{(state as any).barcode}</span>…
              </p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {result.source === 'not_found' || result.source === 'error' ? (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded-xl">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    {result.source === 'not_found' ? 'Product not found' : 'Lookup failed'}
                  </p>
                  <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                    {result.source === 'error' ? result.error : 'Barcode not in Open Food Facts database.'}
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/60 rounded-xl space-y-1">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wide">
                    {result.source === 'cache' ? 'Cached' : 'Open Food Facts'}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{result.product_name}</p>
                  {result.canonical_name && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Matched: <span className="font-medium text-gray-700 dark:text-gray-300">{result.canonical_name}</span>
                      <span className="ml-1 text-gray-400">({Math.round(result.confidence * 100)}%)</span>
                    </p>
                  )}
                  {!result.ingredient_id && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      Could not match to a known ingredient — you can still add it manually.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => onResolved(result)}
                  className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  Add to Pantry
                </button>
                <button
                  onClick={() => {
                    setManualInput('');
                    setState({ phase: hasBarcodeDetector ? 'idle' : 'idle' });
                  }}
                  className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-semibold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Scan again
                </button>
              </div>
            </div>
          )}

          {/* Error banner */}
          {state.phase === 'error' && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded-xl px-3 py-2">
              {state.message}
            </p>
          )}

          {/* Manual entry (always visible when not showing a result) */}
          {state.phase !== 'result' && !isLoading && (
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder={hasBarcodeDetector ? 'Or enter barcode manually' : 'Enter barcode number'}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              />
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                Go
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
