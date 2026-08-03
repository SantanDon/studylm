#!/usr/bin/env node

import express from "express";

const { default: audiobookRouter } = await import("../src/routes/audiobook.js");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));
app.use("/api/audiobook", audiobookRouter);
app.get("/health", (_req, res) => {
  res.json({ status: "ok", pid: process.pid });
});

const requestedPort = Number(process.env.AUDIOBOOK_QA_PORT || 0);
const server = app.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  process.stdout.write(`AUDIOBOOK_QA_READY ${port}\n`);
});

const close = () => {
  server.close(() => process.exit(0));
  const forceExit = setTimeout(() => process.exit(0), 2_000);
  forceExit.unref();
};

process.on("SIGINT", close);
process.on("SIGTERM", close);
process.on("uncaughtException", (error) => {
  console.error("AUDIOBOOK_QA_FATAL", error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("AUDIOBOOK_QA_FATAL", error);
  process.exit(1);
});
