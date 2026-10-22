/** Message the embedded app sends to its parent page: `{ type: HEIGHT_MESSAGE, height }`. */
export const HEIGHT_MESSAGE = 'factory-twin:height';

/**
 * The origin to post the height message to: the parent page's origin when the browser tells us
 * (location.ancestorOrigins in Chromium/Safari, else the referrer), otherwise '*' — acceptable
 * because the message carries nothing but a pixel height.
 */
export function parentOrigin(
  ancestorOrigins: ArrayLike<string> | undefined,
  referrer: string,
): string {
  const ancestor = ancestorOrigins?.[0];
  if (ancestor && ancestor !== 'null') return ancestor;
  try {
    const origin = new URL(referrer).origin;
    return origin === 'null' ? '*' : origin;
  } catch {
    return '*';
  }
}

/**
 * Reports the document height to the parent page, now and whenever it changes, so the parent can
 * size the iframe. In embed mode the layout height depends only on the frame's width (the scene
 * keeps fixed proportions, see `.embed` in app.css), so the parent resizing the frame to the
 * reported height does not change the height again: there is no resize loop. Repeated values are
 * not re-sent. Returns a function that stops reporting.
 */
export function reportHeightToParent(win: Window = window): () => void {
  if (win.parent === win) return () => {};
  const target = parentOrigin(win.location.ancestorOrigins, win.document.referrer);
  const root = win.document.documentElement;
  let last = -1;
  const report = () => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    win.parent.postMessage({ type: HEIGHT_MESSAGE, height }, target);
  };
  const observer = new ResizeObserver(report);
  observer.observe(root);
  report();
  return () => observer.disconnect();
}
