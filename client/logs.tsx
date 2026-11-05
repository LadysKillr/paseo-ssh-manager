import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { logsDeleteRpc, logsListRpc, logsReadRpc } from "../shared/rpc";
import { errorMessage, formatBytes, formatDate, MONO, type Styles } from "./util";
import { useVisible } from "./visibility";
import { base64ToBytes, confirmAction, isWeb, saveDownload } from "./web";
import { Btn, Empty, ErrorBox, IconBtn } from "./widgets";

export const LOGS_KEY = ["ssh-manager", "logs"];

/** Session logs recorded on the Paseo host (MobaXterm "log terminal output"). */
export function Logs({ s }: { s: Styles }) {
  const list = useRpc(logsListRpc);
  const read = useRpc(logsReadRpc);
  const del = useRpc(logsDeleteRpc);
  const qc = useQueryClient();
  const toast = useToast();
  const visible = useVisible();
  const query = useQuery({ queryKey: LOGS_KEY, queryFn: () => list({}), refetchInterval: 5000, enabled: visible });
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (name: string) => {
    setBusy(name);
    try {
      const parts: Uint8Array[] = [];
      let offset = 0;
      let size = 1;
      while (offset < size) {
        const res = await read({ name, offset, length: 2 * 1024 * 1024 });
        size = res.size;
        const bytes = base64ToBytes(res.base64);
        if (!bytes.length) break;
        parts.push(bytes);
        offset += bytes.length;
      }
      saveDownload(name, parts);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string) => {
    if (!(await confirmAction("Supprimer le journal", `Supprimer ${name} ?`, "Supprimer"))) return;
    try {
      await del({ name });
      void qc.invalidateQueries({ queryKey: LOGS_KEY });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const files = query.data?.files ?? [];
  const active = new Set(query.data?.active ?? []);
  return (
    <View style={{ padding: 12, gap: 8, maxWidth: 900, width: "100%" }}>
      <Text style={s.muted}>
        Journaux enregistrés sur l'hôte Paseo (~/.paseo/plugin-data/ssh-manager/logs), en texte brut sans codes couleur. Activez l'enregistrement par
        session (paramètres avancés) ou pour un onglet (clic droit sur l'onglet).
      </Text>
      {query.error ? <ErrorBox s={s} message={errorMessage(query.error)} /> : null}
      {query.data && files.length === 0 ? <Empty s={s} icon="ScrollText" text="Aucun journal pour l'instant." /> : null}
      {files.map((f) => (
        <View key={f.name} style={[s.card, s.row, { padding: 8, gap: 8 }]}>
          <Icon name="ScrollText" size={16} color={active.has(f.name) ? s.x.red : s.c.foregroundMuted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.text, { fontFamily: MONO, fontSize: 12 }]} numberOfLines={1}>
              {f.name}
            </Text>
            <Text style={s.small}>
              {formatBytes(f.size)}  -  {formatDate(f.mtime)}
              {active.has(f.name) ? "  -  enregistrement en cours" : ""}
            </Text>
          </View>
          {isWeb ? <Btn s={s} compact icon="Download" label="Télécharger" busy={busy === f.name} onPress={() => void download(f.name)} /> : null}
          {!active.has(f.name) ? <IconBtn s={s} icon="Trash2" label="Supprimer" color={s.x.red} onPress={() => void remove(f.name)} /> : null}
        </View>
      ))}
    </View>
  );
}
