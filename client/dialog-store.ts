import type { Server } from "../shared/rpc";
import { createStore } from "./util";

/** Dialogs shared by the whole app (new session, edit, imports). */
export type Dialog =
  | { kind: "new"; group?: string }
  | { kind: "edit"; server: Server }
  | { kind: "duplicate"; server: Server }
  | { kind: "import-ssh" }
  | { kind: "import-moba" }
  | null;

export const dialogStore = createStore<Dialog>(null);
