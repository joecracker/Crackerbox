import { ModelPicker } from "./ModelPicker";
import { ChatModeSelector } from "./ChatModeSelector";

export function ChatInputControls() {
  return (
    <div className="flex max-w-full min-w-0 items-center">
      <ChatModeSelector />
      <div className="w-1.5"></div>
      <ModelPicker />
    </div>
  );
}
