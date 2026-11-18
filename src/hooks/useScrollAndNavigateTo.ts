import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom, useStore } from "jotai";
import {
  activeSettingsSectionAtom,
  isSettingsSectionOpen,
  setSettingsSectionOpenAtom,
  settingsOpenSectionsAtom,
} from "@/atoms/viewAtoms";

type ScrollOptions = {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  onScrolled?: (id: string, element: HTMLElement) => void;
  highlight?: boolean;
};

/**
 * Returns an async function that navigates to the given route, then scrolls the element with the provided id into view.
 */
export function useScrollAndNavigateTo(
  to: string = "/settings",
  options?: ScrollOptions,
) {
  const navigate = useNavigate();
  const setActiveSection = useSetAtom(activeSettingsSectionAtom);
  const store = useStore();

  return useCallback(
    async (id: string, sectionId?: string) => {
      await navigate({ to });
      const found = document.getElementById(id);
      if (found) {
        let element: HTMLElement = found;
        // A folded settings section has to open before its content can be shown.
        const sectionEl = element.closest("section[id]");
        if (
          sectionEl &&
          !isSettingsSectionOpen(
            store.get(settingsOpenSectionsAtom),
            sectionEl.id,
          )
        ) {
          store.set(setSettingsSectionOpenAtom, {
            id: sectionEl.id,
            open: true,
          });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          element = document.getElementById(id) ?? element;
        }
        element.scrollIntoView({
          behavior: options?.behavior ?? "smooth",
          block: options?.block ?? "start",
          inline: options?.inline,
        });
        setActiveSection(sectionId ?? id);
        options?.onScrolled?.(id, element);

        if (options?.highlight) {
          element.classList.remove("settings-highlight");
          void element.offsetWidth; // force reflow to restart animation
          element.classList.add("settings-highlight");
          const onEnd = () => {
            element.classList.remove("settings-highlight");
          };
          element.addEventListener("animationend", onEnd, { once: true });
          element.addEventListener("animationcancel", onEnd, { once: true });
        }

        return true;
      }
      return false;
    },
    [
      navigate,
      to,
      options?.behavior,
      options?.block,
      options?.inline,
      options?.onScrolled,
      options?.highlight,
      setActiveSection,
      store,
    ],
  );
}
