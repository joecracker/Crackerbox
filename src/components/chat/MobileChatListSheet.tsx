import { useEffect, useRef, type MouseEvent } from "react";
import { useAtomValue } from "jotai";
import { ChatList } from "@/components/ChatList";
import { NewProjectButton } from "@/components/NewProjectButton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

// Phone-only: the desktop sidebar's chat list has no touch equivalent (see
// mobile-bottom-nav.tsx), so the title bar's "Crackerbox" label opens this
// slide-in panel with the selected app's chats. Picking a chat switches to it
// and closes the panel.
export function MobileChatListSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const lastChatId = useRef(selectedChatId);

  // Close whenever a different chat gets selected (a tap on a row, a search
  // result, or a brand-new chat).
  useEffect(() => {
    if (lastChatId.current !== selectedChatId) {
      lastChatId.current = selectedChatId;
      onOpenChange(false);
    }
  }, [selectedChatId, onOpenChange]);

  // Tapping the chat that is already open does not change the selection, so
  // close on that tap too.
  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-testid^="chat-list-item-"]')) {
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-5/6 gap-0 p-0 sm:max-w-sm"
        data-testid="mobile-chat-list-sheet"
      >
        <SheetHeader className="pb-2">
          <SheetTitle>Chats</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-2">
          <NewProjectButton className="w-full justify-start" />
        </div>
        <div
          className="min-h-0 flex-1 overflow-hidden"
          onClickCapture={handleClickCapture}
        >
          <ChatList show />
        </div>
      </SheetContent>
    </Sheet>
  );
}
