import Fastify from "fastify";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 4000);

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ ok: true }));

const address = await app.listen({ port: PORT, host: "0.0.0.0" });

const io = new Server(app.server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  app.log.info({ socketId: socket.id }, "socket connected");
});

app.log.info(`daifugo server listening at ${address}`);
