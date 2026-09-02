/**
 * Server entrypoint (§8, §14): Fastify HTTP + Socket.IO on :4000, backed by
 * Firestore.
 *
 * State lives in Firestore, one doc per room, so this process holds no
 * authoritative game state and a redeploy or a crash does not destroy an in-flight
 * match (§14). `/healthz` is what Cloud Run probes. The wiring itself
 * lives in `buildServer`; this file only chooses the deployed edges — Firestore
 * and the wall clock — and starts listening.
 */
import { buildServer } from "./app.js";
import { createFirestore, FirestoreRoomRepository } from "./firestore.js";

const PORT = Number(process.env.PORT ?? 4000);

const { app } = buildServer({
  repo: new FirestoreRoomRepository(createFirestore()),
  logger: true,
});

const address = await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`daifugo server listening at ${address}`);
