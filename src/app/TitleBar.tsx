import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AppAvatar } from "@/components/AppAvatar";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { ipc } from "@/ipc/types";
import { useSystemPlatform } from "@/hooks/useSystemPlatform";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatTabs } from "@/components/chat/ChatTabs";
import { MobileChatListSheet } from "@/components/chat/MobileChatListSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

export const TitleBar = () => {
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { apps } = useLoadApps();
  const { navigate } = useRouter();
  const platform = useSystemPlatform();
  const isMobile = useIsMobile();
  const [chatsOpen, setChatsOpen] = useState(false);
  const showWindowControls =
    platform !== null && platform !== "darwin" && platform !== "win32";
  // On Windows, titleBarOverlay (see main.ts) draws real native caption
  // buttons instead -- that's required for the Windows 11 Snap Layout
  // flyout to appear on hover, which a custom HTML button can never trigger.
  const reserveWindowsOverlaySpace = platform === "win32";

  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp ? selectedApp.name : "No project selected";

  const handleAppClick = () => {
    if (selectedApp) {
      navigate({ to: "/app-details", search: { appId: selectedApp.id } });
    }
  };

  return (
    <>
      <div className="@container z-11 w-full h-[calc(var(--layout-title-bar-offset)+1px)] pt-1 bg-[var(--brand-header)] absolute top-0 left-0 app-region-drag flex items-center">
        {/*
         * Left region matches the sidebar's expanded width so chat tabs always
         * start past the sidebar panel's right edge. Without this, an active
         * tab's flat-bottom edge ends up over the sidebar instead of the white
         * main content area, breaking the "tab merges into content" affordance.
         */}
        <div className="flex items-center shrink-0">
          <div
            className={`${showWindowControls ? "pl-2" : reserveWindowsOverlaySpace ? "pl-2" : "pl-18"}`}
          ></div>

          {isMobile ? (
            // Phone only: tapping the name opens the old-chats panel.
            <button
              type="button"
              data-testid="title-bar-chats-button"
              aria-label="Show chats"
              className="no-app-region-drag ml-2 shrink-0 cursor-pointer px-1 py-1 text-sm font-semibold text-primary"
              onClick={() => setChatsOpen(true)}
            >
              Crackerbox
            </button>
          ) : (
            <span className="ml-2 text-sm font-semibold text-primary shrink-0">
              Crackerbox
            </span>
          )}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-testid="title-bar-app-name-button"
                  data-app-name={selectedApp?.name ?? ""}
                  data-app-path={selectedApp?.path ?? ""}
                  aria-label={
                    selectedApp
                      ? `Manage ${selectedApp.name}`
                      : "No project selected"
                  }
                  variant="outline"
                  size="sm"
                  disabled={!selectedApp}
                  className={cn(
                    "no-app-region-drag ml-1.5 h-7 px-2 flex items-center font-medium text-xs",
                    selectedApp
                      ? "cursor-pointer"
                      : "opacity-70 cursor-default disabled:opacity-70",
                  )}
                  onClick={handleAppClick}
                />
              }
            >
              {selectedApp && (
                <AppAvatar
                  appId={selectedApp.id}
                  name={selectedApp.name}
                  className="h-4 w-4 rounded-sm text-[8px]"
                />
              )}
              <span className="max-w-24 @2xl:max-w-40 truncate">
                {displayText}
              </span>
            </TooltipTrigger>
            <TooltipContent>{displayText}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 min-w-0 overflow-hidden self-end">
          <ChatTabs selectedChatId={selectedChatId} />
        </div>

        {showWindowControls && <WindowsControls />}
      </div>

      {isMobile && (
        <MobileChatListSheet open={chatsOpen} onOpenChange={setChatsOpen} />
      )}
    </>
  );
};

function WindowsControls() {
  const { isDarkMode } = useTheme();

  const minimizeWindow = () => {
    ipc.system.minimizeWindow();
  };

  const maximizeWindow = () => {
    ipc.system.maximizeWindow();
  };

  const closeWindow = () => {
    ipc.system.closeWindow();
  };

  return (
    <div className="ml-auto flex no-app-region-drag -mt-1 h-[var(--layout-title-bar-offset)] self-start">
      <button
        className="w-12 h-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        onClick={minimizeWindow}
        aria-label="Minimize"
      >
        <svg
          width="12"
          height="1"
          viewBox="0 0 12 1"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            width="12"
            height="1"
            fill={isDarkMode ? "#ffffff" : "#000000"}
          />
        </svg>
      </button>
      <button
        className="w-12 h-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        onClick={maximizeWindow}
        aria-label="Maximize"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="0.5"
            y="0.5"
            width="11"
            height="11"
            stroke={isDarkMode ? "#ffffff" : "#000000"}
          />
        </svg>
      </button>
      <button
        className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors"
        onClick={closeWindow}
        aria-label="Close"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 1L11 11M1 11L11 1"
            stroke={isDarkMode ? "#ffffff" : "#000000"}
            strokeWidth="1.5"
          />
        </svg>
      </button>
    </div>
  );
}
