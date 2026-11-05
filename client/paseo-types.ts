import type { usePaseo } from "@getpaseo/plugin/client";

/**
 * Paseo API types, derived from what the plugin SDK provides. Plugin client code may only import the
 * modules Paseo supplies at runtime (and resolves them at install time, even for types): importing
 * "@getpaseo/client" works where it happens to be installed and breaks installs elsewhere.
 */
export type PaseoApi = ReturnType<typeof usePaseo>;
export type PaseoTerminal = Awaited<ReturnType<PaseoApi["terminals"]["list"]>>["entries"][number];
