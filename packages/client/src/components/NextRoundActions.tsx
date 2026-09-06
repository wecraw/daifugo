/**
 * The one thing a seat can do between rounds (§8.6, §10.11, §10.12): ready up, or
 * — if it is the host's seat — deal.
 *
 * Both screens that stand between two rounds render it. The lobby is the roster
 * screen a newcomer lands on; the round-end curtain is where a player who just
 * finished the round stays (§10.12). They frame it differently and gate it
 * identically, so the gating lives here rather than twice.
 *
 * **Readiness is one way** (§10.13). A seat readies itself and then waits: the button keeps
 * its place and becomes the wait it caused. `setReady(false)` stays in the
 * protocol — the deal unreadies every seat itself — but no button sends it.
 * Between two rounds the only question being answered is whether you are staying
 * for the next one, and taking that back was mostly a way to hold up a table by
 * accident.
 *
 * **Who the deal is waiting on comes from core** — `unreadyPlayerIds`, the same
 * answer `START_GAME` checks (§8.6) — so the deal button is disabled exactly when
 * the engine would refuse it and `PLAYERS_NOT_READY` never reaches a banner. The
 * host is exempt from it: their click is their own readiness, which is why they
 * get no ready button of their own.
 */
import { MAX_PLAYERS, MIN_PLAYERS, unreadyPlayerIds, type PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useTranslate } from "../i18n/index";

/** The round a `startGame` would deal to (§7.7): queued joins and leaves land there. */
export function rosterSize(room: PublicGameState): number {
  return room.players.length + room.pendingJoins.length - room.pendingLeaves.length;
}

/**
 * This seat's readiness, off the roster the deal takes rather than the seated one.
 *
 * A player who joined mid-round waits in `pendingJoins` and readies from there
 * (§7.7, §8.6), so reading `players` alone would offer "ready up" to someone who
 * already is.
 */
export function isSeatReady(room: PublicGameState, playerId: string | null): boolean {
  if (playerId === null) return false;
  return (
    [...room.players, ...room.pendingJoins].find((seat) => seat.id === playerId)?.isReady ?? false
  );
}

export function NextRoundActions({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { playerId, send } = useSocket();

  const isHost = room.hostId === playerId;
  const matchOver = room.status === "MATCH_END";
  const betweenRounds = room.status === "ROUND_END" || matchOver;
  const size = rosterSize(room);
  const tooFew = size < MIN_PLAYERS;
  const tooMany = size > MAX_PLAYERS;
  const waitingOn = matchOver ? [] : unreadyPlayerIds(room);
  const ready = isSeatReady(room, playerId);

  // Nothing left to deal, and nothing to ready for (§9).
  if (matchOver) return <p className="ready-controls__note">{t("ui.lobby.matchOver")}</p>;

  if (!isHost) {
    return (
      <>
        <button
          type="button"
          className={
            ready ? "ready-controls__ready ready-controls__ready--sent" : "ready-controls__ready"
          }
          disabled={ready}
          onClick={() => send("setReady", true)}
        >
          {t(ready ? "ui.lobby.waitingForOthers" : "ui.lobby.readyUp")}
        </button>
        {!ready && <p className="ready-controls__note">{t("ui.lobby.waitingForHost")}</p>}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="ready-controls__deal"
        disabled={tooFew || tooMany || waitingOn.length > 0}
        onClick={() => send("startGame")}
      >
        {t(betweenRounds ? "ui.lobby.nextRound" : "ui.lobby.start")}
      </button>
      {!tooFew && !tooMany && waitingOn.length > 0 && (
        <p className="ready-controls__note">
          {waitingOn.length === 1
            ? t("ui.lobby.waitingForReadyOne")
            : t("ui.lobby.waitingForReady", { count: waitingOn.length })}
        </p>
      )}
      {tooFew && (
        <p className="ready-controls__note">
          {t("ui.lobby.needMorePlayers", { min: MIN_PLAYERS })}
        </p>
      )}
      {tooMany && (
        <p className="ready-controls__note">{t("ui.lobby.tooManyPlayers", { max: MAX_PLAYERS })}</p>
      )}
    </>
  );
}
