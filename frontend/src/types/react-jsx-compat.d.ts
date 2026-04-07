/**
 * React 19 removed the global JSX namespace.
 * react-markdown v8 still references it in complex-types.ts (a .ts source file,
 * not a .d.ts, so skipLibCheck doesn't cover it).
 * This patch re-exports the namespace globally so the production build succeeds.
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementClass = ReactJSX.ElementClass;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}
