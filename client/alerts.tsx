import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { terminalWatchRpc, type Watch } from "../shared/rpc";
import type { TabModel } from "./tabs";
import { errorMessage, MONO, useLinger, type Styles } from "./util";
import { askNotificationPermission } from "./web";
import { Btn, Check } from "./widgets";

/**
 * Alerts of a terminal (MobaXterm-like): a word appears in the output, a long command ends (the
 * output stops), or a quiet terminal comes back to life. Shown as a toast, a desktop notification
 * and a bell on the tab.
 */
export function AlertModal({
  s,
  tab,
  current,
  onClose,
  onSaved,
}: {
  s: Styles;
  tab: TabModel | null;
  current: Watch | null;
  onClose(): void;
  onSaved(): void;
}) {
  const { shown, open } = useLinger(tab);
  const watch = useRpc(terminalWatchRpc);
  const toast = useToast();
  const [keywords, setKeywords] = useState("");
  const [idleOn, setIdleOn] = useState(true);
  const [idleSec, setIdleSec] = useState("10");
  const [activityOn, setActivityOn] = useState(false);
  const [activitySec, setActivitySec] = useState("60");
  const [once, setOnce] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tab) return;
    setKeywords(current?.keywords.join(", ") ?? "");
    setIdleOn(current ? current.idleSec > 0 : true);
    setIdleSec(String(current?.idleSec || 10));
    setActivityOn(!!current?.activitySec);
    setActivitySec(String(current?.activitySec || 60));
    setOnce(!!current?.once);
  }, [tab?.id]);

  if (!shown) return null;

  const save = async (remove = false) => {
    setBusy(true);
    try {
      const value: Watch | null = remove
        ? null
        : {
            keywords: keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
            idleSec: idleOn ? Math.max(2, Number(idleSec) || 10) : 0,
            activitySec: activityOn ? Math.max(5, Number(activitySec) || 60) : 0,
            once,
          };
      if (value) askNotificationPermission();
      await watch({ terminalId: shown.id, label: shown.label, watch: value });
      toast.show(remove ? "Alertes retirées" : "Alertes enregistrées", { variant: "success" });
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const seconds = (value: string, set: (v: string) => void) => (
    <TextInput value={value} onChangeText={set} keyboardType="numeric" style={[s.input, { width: 70, paddingVertical: 2, minHeight: 28 }]} />
  );

  return (
    <Modal title={`Alertes : ${shown.label}`} open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Text style={s.muted}>
          Une alerte affiche un message, une notification du bureau et une cloche sur l'onglet, même si vous êtes sur une autre page de Paseo.
        </Text>
        <View style={{ gap: 4 }}>
          <Text style={s.text}>Quand un de ces mots apparaît (séparés par des virgules)</Text>
          <TextInput
            value={keywords}
            onChangeText={setKeywords}
            placeholder="error, failed, Build succeeded"
            placeholderTextColor={s.c.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[s.input, { fontFamily: MONO }]}
          />
          <Text style={s.small}>Sans tenir compte des majuscules. La ligne de commande que vous tapez n'est pas prise en compte.</Text>
        </View>
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Check s={s} checked={idleOn} onToggle={() => setIdleOn(!idleOn)} label="Quand une commande longue se termine : plus de sortie depuis" />
          {seconds(idleSec, setIdleSec)}
          <Text style={s.text}>s</Text>
        </View>
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Check s={s} checked={activityOn} onToggle={() => setActivityOn(!activityOn)} label="Quand le terminal se réveille après" />
          {seconds(activitySec, setActivitySec)}
          <Text style={s.text}>s de silence</Text>
        </View>
        <Check s={s} checked={once} onToggle={() => setOnce(!once)} label="Une seule fois (retirer l'alerte après la première notification)" />
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          {current ? <Btn s={s} danger icon="BellOff" label="Retirer les alertes" onPress={() => void save(true)} /> : null}
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn s={s} primary icon="Bell" label="Enregistrer" busy={busy} onPress={() => void save()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
