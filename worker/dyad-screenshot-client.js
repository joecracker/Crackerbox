(() => {
  // Keep the raw RGBA canvas at or below ~16 MiB. html-to-image may allocate
  // more than one intermediate surface, so relying on its 16,384px
  // per-dimension fallback is not enough to avoid renderer OOMs.
  const MAX_SCREENSHOT_DIMENSION = 4096;
  const MAX_SCREENSHOT_PIXELS = 4 * 1024 * 1024;
  let activeCapturePromise = null;

  function getLargestDimension(...values) {
    const validValues = values.filter(
      (value) => Number.isFinite(value) && value > 0,
    );
    return validValues.length > 0 ? Math.ceil(Math.max(...validValues)) : 1;
  }

  function getFullPageDimensions() {
    const root = document.documentElement;
    const body = document.body;

    return {
      width: getLargestDimension(
        root?.scrollWidth,
        root?.offsetWidth,
        root?.clientWidth,
        body?.scrollWidth,
        body?.offsetWidth,
        body?.clientWidth,
        window.innerWidth,
      ),
      height: getLargestDimension(
        root?.scrollHeight,
        root?.offsetHeight,
        root?.clientHeight,
        body?.scrollHeight,
        body?.offsetHeight,
        body?.clientHeight,
        window.innerHeight,
      ),
    };
  }

  function getViewportDimensions() {
    const root = document.documentElement;
    return {
      width: getLargestDimension(root?.clientWidth, window.innerWidth),
      height: getLargestDimension(root?.clientHeight, window.innerHeight),
    };
  }

  function fitsScreenshotBudget({ width, height }) {
    return (
      width <= MAX_SCREENSHOT_DIMENSION &&
      height <= MAX_SCREENSHOT_DIMENSION &&
      width * height <= MAX_SCREENSHOT_PIXELS
    );
  }

  function fitScreenshotToBudget({ width, height }) {
    const scale = Math.min(
      1,
      MAX_SCREENSHOT_DIMENSION / width,
      MAX_SCREENSHOT_DIMENSION / height,
      Math.sqrt(MAX_SCREENSHOT_PIXELS / (width * height)),
    );

    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
    };
  }

  function getScreenshotDimensions() {
    const fullPage = getFullPageDimensions();
    if (fitsScreenshotBudget(fullPage)) {
      return { ...fullPage, fullPage, isViewport: false };
    }

    const viewport = getViewportDimensions();
    const boundedViewport = fitScreenshotToBudget(viewport);
    console.warn(
      `[dyad-screenshot] Full page ${fullPage.width}x${fullPage.height} exceeds the screenshot memory budget; capturing viewport ${boundedViewport.width}x${boundedViewport.height} instead.`,
    );
    return {
      ...boundedViewport,
      fullPage,
      isViewport: true,
      viewport,
    };
  }

  function getScrollOffset(primaryValue, fallbackValue) {
    const value = Number.isFinite(primaryValue) ? primaryValue : fallbackValue;
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function describeError(error) {
    if (error && typeof error.message === "string" && error.message) {
      return error.message;
    }
    // html-to-image rejects with a bare DOM event when the browser cannot
    // render part of the page, which has no message of its own.
    if (error && typeof error.type === "string") {
      return `${error.type} event (the browser could not render part of the page)`;
    }
    return String(error);
  }

  function isImageElement(node) {
    return Boolean(node) && node.tagName === "IMG";
  }

  // An <img> with an empty src, or one that failed to load, is common (apps
  // keep placeholder images for later) and makes html-to-image reject the
  // whole screenshot.
  function isBrokenImage(node) {
    if (!isImageElement(node)) return false;
    const src =
      node.currentSrc ||
      (typeof node.getAttribute === "function" ? node.getAttribute("src") : "");
    if (!src) return true;
    return node.complete === true && node.naturalWidth === 0;
  }

  // The first attempt is exactly what we always did. Only if it fails do we
  // retry without the broken images, then without any images, so the app still
  // gets a picture instead of none.
  async function toPngWithFallbacks(options) {
    const attempts = [
      { label: null, extra: {} },
      {
        label: "without broken images",
        extra: { filter: (node) => !isBrokenImage(node) },
      },
      {
        label: "without any images",
        extra: { filter: (node) => !isImageElement(node) },
      },
    ];
    let lastError;
    for (let i = 0; i < attempts.length; i++) {
      try {
        return await htmlToImage.toPng(
          document.body,
          i === 0 ? options : { ...options, ...attempts[i].extra },
        );
      } catch (error) {
        lastError = error;
        if (i < attempts.length - 1) {
          console.warn(
            `[dyad-screenshot] Capture failed (${describeError(error)}); retrying ${attempts[i + 1].label}.`,
          );
        }
      }
    }
    throw lastError;
  }

  async function captureScreenshotOnce() {
    try {
      // Use html-to-image if available
      if (typeof htmlToImage !== "undefined") {
        const dimensions = getScreenshotDimensions();
        const options = {
          width: dimensions.width,
          height: dimensions.height,
          // html-to-image otherwise multiplies the canvas by devicePixelRatio,
          // which can turn a bounded screenshot into a 4-9x memory spike.
          pixelRatio: 1,
        };

        if (dimensions.isViewport) {
          const scrollX = getScrollOffset(window.scrollX, window.pageXOffset);
          const scrollY = getScrollOffset(window.scrollY, window.pageYOffset);
          const scale = Math.min(
            dimensions.width / dimensions.viewport.width,
            dimensions.height / dimensions.viewport.height,
          );

          // html-to-image always clones from the document origin. Offset the
          // clone to the current scroll position so the bounded fallback
          // captures what the user is actually viewing. Avoid a transform:
          // transforms establish a containing block for fixed descendants and
          // would shift fixed headers, floating buttons, and modals along with
          // the scrolled document content. CSS zoom keeps unusually large
          // viewports within the same pixel budget without changing that
          // fixed-position containing block.
          options.style = {
            position: "relative",
            left: `${-scrollX}px`,
            top: `${-scrollY}px`,
            zoom: `${scale}`,
            width: `${dimensions.fullPage.width}px`,
            height: `${dimensions.fullPage.height}px`,
          };
        }

        return await toPngWithFallbacks(options);
      }
      throw new Error("html-to-image library not found");
    } catch (error) {
      console.error("[dyad-screenshot] Failed to capture screenshot:", error);
      throw error;
    }
  }

  async function captureScreenshot() {
    // HMR, a commit, and the annotator can request a screenshot at nearly the
    // same time. Reuse one bounded capture instead of allocating a canvas for
    // every request.
    if (activeCapturePromise) {
      return activeCapturePromise;
    }

    activeCapturePromise = captureScreenshotOnce();
    try {
      return await activeCapturePromise;
    } finally {
      activeCapturePromise = null;
    }
  }
  async function handleScreenshotRequest(requestId) {
    try {
      console.debug("[dyad-screenshot] Capturing screenshot...");

      const dataUrl = await captureScreenshot();

      console.debug("[dyad-screenshot] Screenshot captured successfully");

      // Send success response to parent
      window.parent.postMessage(
        {
          type: "dyad-screenshot-response",
          requestId,
          success: true,
          dataUrl: dataUrl,
        },
        "*",
      );
    } catch (error) {
      console.error("[dyad-screenshot] Screenshot capture failed:", error);

      // Send error response to parent
      window.parent.postMessage(
        {
          type: "dyad-screenshot-response",
          requestId,
          success: false,
          error: describeError(error),
        },
        "*",
      );
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

    if (event.data.type === "dyad-take-screenshot") {
      handleScreenshotRequest(event.data.requestId);
    }
  });
})();
