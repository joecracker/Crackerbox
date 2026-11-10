import { ModelPicker } from "./ModelPicker";
import { SisterPicker } from "./SisterPicker";

export function ChatInputControls() {
  return (
    <div className="flex max-w-full min-w-0 items-center">
      <SisterPicker />
      <ModelPicker />
    </div>
  );
}
