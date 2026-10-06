import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import {
  attachmentsAtom,
  hasManuallySelectedChatModeAtom,
  homeChatInputValueAtom,
  homeSelectedAppAtom,
} from "../atoms/chatAtoms";
import { useSettings } from "@/hooks/useSettings";
import { useEffect, useCallback, useMemo } from "react";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { usePostHog } from "posthog-js/react";
import { PrivacyBanner } from "@/components/TelemetryBanner";

import { FeaturedAppShowcase } from "@/components/FeaturedAppShowcase";
import { Button } from "@/components/ui/button";

import type { FileAttachment } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { hasDyadProKey, type ChatMode } from "@/lib/schemas";
import { PRO_BILLING_FEATURES_ENABLED } from "@/lib/proBillingFlags";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
} from "@/lib/freeProModel";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { Sparkles, Zap } from "lucide-react";
import { ipc } from "@/ipc/types";
import {
  useFirstPromptSaga,
  useFirstPromptSend,
} from "@/first_prompt/FirstPromptProvider";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";

// Adding an export for attachments
export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
  selectedApp?: ListedApp;
  requestedChatMode?: "ask" | "local-agent";
}

export default function HomePage() {
  const { t } = useTranslation("home");
  const [inputValue] = useAtom(homeChatInputValueAtom);
  const selectedApp = useAtomValue(homeSelectedAppAtom);
  const attachments = useAtomValue(attachmentsAtom);
  const firstPromptSaga = useFirstPromptSaga();
  const sendFirstPrompt = useFirstPromptSend();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const { settings, envVars, loading: isSettingsLoading } = useSettings();
  const { isAnyProviderSetup, isLoading: isLoadingLanguageModelProviders } =
    useLanguageModelProviders();
  const hasDyadProApiKey = settings ? hasDyadProKey(settings) : false;
  const hasConfiguredAiProvider =
    !isLoadingLanguageModelProviders && isAnyProviderSetup();
  const homeInitialChatMode = useMemo<ChatMode | undefined>(() => {
    if (!settings) {
      return undefined;
    }

    return getHomeDefaultChatMode(settings, envVars);
  }, [envVars, settings]);

  const posthog = usePostHog();

  // Get the appId from search params
  const appId = search.appId ? Number(search.appId) : null;

  // Redirect to app details page if appId is present. Use `replace` so the
  // intermediate `/?appId=…` entry doesn't sit in history and trap the back
  // button on app-details in a redirect loop.
  useEffect(() => {
    if (appId) {
      navigate({ to: "/app-details", search: { appId }, replace: true });
    }
  }, [appId, navigate]);

  const hasManuallySelectedChatMode = useAtomValue(
    hasManuallySelectedChatModeAtom,
  );

  // Honor a manually picked mode (e.g. "plan") on submit; otherwise fall back
  // to the effective default so it still tracks provider/quota state. Apply the
  // Free Pro fallback for an invalid build-mode + free-pro-model combination.
  const homeSubmitChatMode = useMemo<ChatMode | undefined>(() => {
    const selected =
      hasManuallySelectedChatMode && settings?.selectedChatMode
        ? settings.selectedChatMode
        : homeInitialChatMode;
    if (
      settings &&
      isFreeProBuildModeCombination(settings.selectedModel, selected)
    ) {
      return FREE_PRO_MODEL_FALLBACK_CHAT_MODE;
    }
    return selected;
  }, [settings, homeInitialChatMode, hasManuallySelectedChatMode]);

  const handleSubmit = useCallback(
    (options?: HomeSubmitOptions) => {
      const submittedAttachments = options?.attachments ?? [];
      if (!inputValue.trim() && submittedAttachments.length === 0) return false;
      return sendFirstPrompt({
        type: "SUBMIT",
        payload: {
          prompt: inputValue,
          attachments: submittedAttachments,
          selectedApp: options?.selectedApp,
          chatMode: options?.requestedChatMode ?? homeSubmitChatMode,
          isChatModeExplicit: options?.requestedChatMode !== undefined,
        },
      });
    },
    [
      hasManuallySelectedChatMode,
      homeSubmitChatMode,
      inputValue,
      sendFirstPrompt,
    ],
  );

  const isLoading = [
    "creating",
    "postCreate",
    "dispatching",
    "navigating",
  ].includes(firstPromptSaga.phase);
  const isCheckingProviders = firstPromptSaga.phase === "checkingProviders";

  // Loading overlay for app creation
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center max-w-3xl m-auto p-8">
        <div className="w-full flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute top-0 left-0 w-full h-full border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-8 border-t-primary rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-gray-200">
            {firstPromptSaga.isExistingAppSubmission
              ? t("startingChat")
              : t("buildingApp")}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-8">
            {firstPromptSaga.isExistingAppSubmission ? (
              t("creatingNewChat")
            ) : (
              <>
                {t("settingUp")} <br />
                {t("mightTakeMoment")}
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const setupAction =
    !isSettingsLoading &&
    !isLoadingLanguageModelProviders &&
    !hasDyadProApiKey ? (
      <button
        type="button"
        onClick={() => {
          posthog.capture("home:setup-pill:click");
          sendFirstPrompt({
            type: "ARM_FOR_SETUP",
            payload: {
              prompt: inputValue,
              attachments,
              selectedApp: selectedApp ?? undefined,
              chatMode: homeSubmitChatMode,
              isChatModeExplicit: hasManuallySelectedChatMode,
            },
          });
        }}
        className={
          hasConfiguredAiProvider
            ? "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground hover:underline"
            : "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 hover:underline"
        }
      >
        <Zap aria-hidden="true" className="size-3.5" />
        {hasConfiguredAiProvider
          ? "Manage AI setup"
          : "Connect AI to build — takes a minute"}
      </button>
    ) : null;

  // Main Home Page Content
  return (
    <div className="relative flex min-h-full w-full flex-col overflow-hidden pb-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden text-[var(--brand-wordmark)] opacity-[0.08]"
        data-testid="home-watermark"
      >
        <span className="whitespace-nowrap text-[clamp(5rem,17vw,17rem)] font-black tracking-[-0.09em] [transform:scale(1.15,2.5)]">
          Crackerbox
        </span>
      </div>
      <div className="relative flex flex-col items-center justify-center max-w-3xl w-full m-auto p-8">
        <div className="w-full">
          {PRO_BILLING_FEATURES_ENABLED && !hasDyadProApiKey && (
            <div className="mb-4 flex justify-center">
              <Button
                size="sm"
                onClick={() =>
                  ipc.system.openExternalUrl(
                    "https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=home-upgrade-to-pro",
                  )
                }
              >
                <Sparkles aria-hidden="true" />
                Upgrade to Pro
              </Button>
            </div>
          )}
          <HomeChatInput
            onSubmit={handleSubmit}
            disabled={isCheckingProviders}
            setupAction={setupAction}
          />

          {setupAction && (
            <div className="-mt-2 hidden justify-end px-4 md:flex">
              {setupAction}
            </div>
          )}
        </div>
        <PrivacyBanner />
      </div>
      <div className="relative">
        <FeaturedAppShowcase />
      </div>
    </div>
  );
}
