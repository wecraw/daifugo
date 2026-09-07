import { normalizePlayerIcon } from "@daifugo/core";

export function PlayerIcon({ icon }: { icon?: string }) {
  return (
    <span className="player-icon" aria-hidden="true">
      {normalizePlayerIcon(icon)}
    </span>
  );
}
