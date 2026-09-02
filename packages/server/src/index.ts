/**
 * Server entrypoint (§8, §14): Fastify HTTP + Socket.IO on :4000, backed by
 * Firestore.
 *
 * State lives in Firestore, one doc per room, so this process holds no
 * authoritative game state and a redeploy or a crash does not destroy an in-flight
 * match (§14). `/healthz` is what Cloud Run probes. The wiring itself
 * lives in `buildServer`; this file only chooses the deployed edges — Firestore
 * and the wall clock — re-arms the deadlines the dead process left behind (§14),
 * and starts listening.
 */
import { buildServer } from "./app.js";
import { createFirestore, FirestoreRoomRepository } from "./firestore.js";

const PORT = Number(process.env.PORT ?? 4000);

const { app, manager } = buildServer({
  repo: new FirestoreRoomRepository(createFirestore()),
  logger: true,
});

// The fast-path `setTimeout` died with the previous process, so every room that
// had a deadline pending is re-armed before this one starts serving (§14). A
// failure here must not keep the service down: the rooms without live deadlines
// are unaffected, and crash-looping the instance would strand all of them.
try {
  const rearmed = await manager.rearmAll();
  app.log.info(`re-armed ${rearmed} room(s) with a pending deadline`);
} catch (error) {
  app.log.error(error, "boot re-arm failed; in-flight deadlines are not armed");
}

const address = await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`daifugo server listening at ${address}`);
