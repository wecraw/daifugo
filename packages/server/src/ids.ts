/**
 * Server-side identifier and seed generation (§8.1, §2).
 *
 * Everything random the server mints goes through Node's CSPRNG (`node:crypto`),
 * never `Math.random()`. The `START_GAME.seed` in particular is security-relevant
 * only insofar as it must be unpredictable and, once minted, persisted: a state
 * rebuilt on any instance from the same seed deals identically (§2, §14), so the
 * seed is generated here and then stored, never regenerated.
 *
 * None of this lives in `@daifugo/core`: the core package is pure and clockless
 * and takes the seed as data (`createRng(seed)`). Minting it is the server's job.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";

/**
 * Join-code alphabet: digits and uppercase letters with the visually ambiguous
 * ones removed (`0/O`, `1/I`, no `L`). A code is read aloud and typed on a phone,
 * so legibility matters more than entropy density here.
 */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 6;

/** A short, human-friendly room code (§8). Uniqueness is enforced by the repository. */
export function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The `resumeToken` a seat is reclaimed with (§8.1). Opaque to the client, which
 * only stores it in localStorage and replays it, so a UUID is plenty.
 */
export function generateResumeToken(): string {
  return randomUUID();
}

/** A stable player id, distinct from any socket id (§8.1). */
export function generatePlayerId(): string {
  return `p_${randomUUID()}`;
}

/**
 * The `START_GAME.seed` (§2): unpredictable, minted once, then persisted with the
 * dealt state so any instance rebuilds the same deal. 128 bits of CSPRNG hex is
 * far more than the seeded PRNG needs and costs nothing.
 */
export function generateGameSeed(): string {
  return randomBytes(16).toString("hex");
}
