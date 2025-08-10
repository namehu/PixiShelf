import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { SettingService } from "./services/setting";
import { errorPlugin } from "./plugins/error";
import { authPlugin } from "./plugins/auth";
import registerRoutes from "./routes";
import { AppState } from "./types";
import bcrypt from "bcryptjs";

dotenv.config();

export async function buildServer() {
  const server = Fastify({ logger: true });

  await server.register(cors, { origin: true });

  // Prisma
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    server.log.info("Prisma connected to database successfully");
  } catch (err) {
    server.log.error({ err }, "Failed to connect to database with Prisma");
  }
  server.decorate("prisma", prisma);

  // Initialize default admin (idempotent)
  try {
    const username = process.env.INIT_ADMIN_USERNAME || "admin";
    const existing = await prisma.user.findFirst({ where: { username } });
    if (!existing) {
      const initialPassword =
        process.env.INIT_ADMIN_PASSWORD ||
        process.env.ADMIN_PASSWORD ||
        "admin123";
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(initialPassword, salt);
      await prisma.user.create({ data: { username, password: hash } });
      server.log.warn(
        "Initialized default admin account. Remember to change the password promptly."
      );
    }
  } catch (e) {
    server.log.error({ err: e }, "Failed to initialize default admin user");
  }

  // Services
  const settingService = new SettingService(prisma);
  await settingService.initDefaults();
  server.decorate("settingService", settingService);

  // App state
  const appState: AppState = {
    scanning: false,
    cancelRequested: false,
    lastProgressMessage: null,
  };
  server.decorate("appState", appState);

  // Plugins
  await errorPlugin(server);
  await authPlugin(server);

  // Routes
  await registerRoutes(server);

  return server;
}
