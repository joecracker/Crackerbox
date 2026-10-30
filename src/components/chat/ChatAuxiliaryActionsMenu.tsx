import { useState } from "react";
import {
  AuxiliaryActionsMenu,
  type AuxiliaryActionsMenuProps,
} from "./AuxiliaryActionsMenu";
import { HandoffDialog } from "./HandoffDialog";
import { useHandoff } from "@/hooks/useHandoff";

/**
 * The "+" menu for a chat: the shared menu plus the handoff entry. It lives in
 * its own component because the handoff hooks only work inside a chat page;
 * the home page's menu must not call them.
 */
export function ChatAuxiliaryActionsMenu(
  props: Omit<AuxiliaryActionsMenuProps, "handoffItem">,
) {
  const { chatId, saved, isStreaming, startNewChat } = useHandoff();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <AuxiliaryActionsMenu
        {...props}
        handoffItem={
          chatId == null
            ? undefined
            : {
                label: saved ? "New chat from handoff" : "Write handoff",
                disabled: !saved && isStreaming,
                onSelect: () => {
                  if (saved) void startNewChat();
                  else setDialogOpen(true);
                },
              }
        }
      />
      <HandoffDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
