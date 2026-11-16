import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useKeyedController } from "@/state_machines/react";
import {
  routePreviewIframeMessage,
  type PreviewSharedMachineEvent,
} from "./commands";
import { usePreviewIframeManager } from "./PreviewIframeProvider";
import type { PreviewIframeEvent } from "./state";
import { INITIAL_PREVIEW_IFRAME_STATE, selectIframeSrc } from "./state";

const NULL_APP_ID = -1;

export function usePreviewIframeController(appId: number | null) {
  const manager = usePreviewIframeManager();
  const state = useKeyedController(manager, appId ?? NULL_APP_ID);
  const send = useSendPreviewIframeEvent(appId);
  return { state: appId === null ? INITIAL_PREVIEW_IFRAME_STATE : state, send };
}

export function useSendPreviewIframeEvent(appId: number | null) {
  const manager = usePreviewIframeManager();
  const send = useCallback(
    (event: PreviewIframeEvent) => {
      if (appId !== null) manager.send(appId, event);
    },
    [appId, manager],
  );
  return send;
}

export function usePreviewIframe(input: {
  appId: number | null;
  appUrl: string | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onSharedMachineEvent: (
    event: PreviewSharedMachineEvent | { type: "IFRAME_LOADED" },
  ) => void;
  onComponentMessage: (event: MessageEvent) => void;
  /** The preview panel is showing. Its opening edge resets to the app root. */
  panelOpen: boolean;
}) {
  const {
    appId,
    appUrl,
    iframeRef,
    onSharedMachineEvent,
    onComponentMessage,
    panelOpen,
  } = input;
  const manager = usePreviewIframeManager();
  const { state, send } = usePreviewIframeController(appId);
  const componentHandlerRef = useRef(onComponentMessage);
  componentHandlerRef.current = onComponentMessage;
  const sharedMachineHandlerRef = useRef(onSharedMachineEvent);
  sharedMachineHandlerRef.current = onSharedMachineEvent;

  // The epoch is the iframe's identity boundary. Capture its source from the
  // same machine snapshot so SPA navigation updates history without asking
  // React to navigate the live iframe a second time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const iframeSrc = useMemo(
    () => selectIframeSrc(state, appUrl),
    [state.iframeEpoch, appUrl],
  );

  useEffect(() => {
    if (appId === null) return;
    const detach = manager.commands.attach(
      appId,
      () => iframeRef.current?.contentWindow ?? null,
    );
    send({ type: "IFRAME_REPLACED", reason: "external" });
    return detach;
  }, [appId, iframeRef, manager, send]);

  useEffect(() => {
    if (appUrl) send({ type: "APP_URL_CHANGED", url: appUrl });
  }, [appUrl, send]);

  // Opening or closing the panel drops whatever route the app was left on and
  // returns to its front page. State only: the iframe is replaced rather than
  // sent a message, so a page that is still loading cannot swallow it. Only
  // the open/close edges count (the app address is read, not watched), so
  // clicking around while the panel stays open is never undone.
  const appUrlRef = useRef(appUrl);
  appUrlRef.current = appUrl;
  const prevPanelOpenRef = useRef<boolean | null>(null);
  useEffect(() => {
    const previous = prevPanelOpenRef.current;
    prevPanelOpenRef.current = panelOpen;
    if (previous === panelOpen) return;
    const rootUrl = appUrlRef.current;
    if (!rootUrl) return;
    console.info(
      `[preview] panel ${panelOpen ? "opened" : "closed"}: back to the front page`,
    );
    send({ type: "PANEL_RESET", rootUrl });
  }, [panelOpen, send]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) =>
      routePreviewIframeMessage({
        event,
        contentWindow: iframeRef.current?.contentWindow ?? null,
        appUrl,
        send,
        onSharedMachineEvent: (message) =>
          sharedMachineHandlerRef.current(message),
        onComponentMessage: (message) => componentHandlerRef.current(message),
      });
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [appUrl, iframeRef, send]);

  const postMessage = useCallback(
    (message: { type: "dyad-take-screenshot"; requestId: string }) => {
      if (appId !== null) manager.commands.post(appId, message);
    },
    [appId, manager],
  );
  const onIframeLoaded = useCallback(() => {
    send({ type: "IFRAME_LOADED" });
    sharedMachineHandlerRef.current({ type: "IFRAME_LOADED" });
  }, [send]);

  return { state, send, iframeSrc, postMessage, onIframeLoaded };
}
