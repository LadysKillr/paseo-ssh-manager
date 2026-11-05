import { Modal } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { createStore, useLinger, useStore, type Styles } from "./util";
import { Btn, Check } from "./widgets";

/**
 * In-app confirmation dialog. Native dialogs (window.confirm / alert) are not used: in the Paseo
 * desktop app (Electron, notably on Windows), after one of them text fields stop accepting input
 * in the whole window until it is reloaded.
 */

interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  /** Shows a "don't ask again" box; called when it is ticked and the action confirmed. */
  onDontAsk?: () => void;
  resolve(ok: boolean): void;
}

const requestStore = createStore<ConfirmRequest | null>(null);
let nextId = 1;

export function askConfirm(title: string, message: string, confirmLabel = "Confirmer", onDontAsk?: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = requestStore.get();
    previous?.resolve(false);
    requestStore.set({ id: nextId++, title, message, confirmLabel, onDontAsk, resolve });
  });
}

/* Several SSH views can be mounted (page + panels): only the last mounted host shows the dialog. */
const hosts: number[] = [];
const hostsStore = createStore(0);
let nextHost = 1;

export function ConfirmHost({ s }: { s: Styles }) {
  const me = useRef(0);
  if (!me.current) me.current = nextHost++;
  useEffect(() => {
    hosts.push(me.current);
    hostsStore.set((n) => n + 1);
    return () => {
      const i = hosts.indexOf(me.current);
      if (i >= 0) hosts.splice(i, 1);
      hostsStore.set((n) => n + 1);
    };
  }, []);
  useStore(hostsStore);
  const request = useStore(requestStore);
  const { shown, open } = useLinger(request);
  const [dontAsk, setDontAsk] = useState(false);
  useEffect(() => setDontAsk(false), [request?.id]);
  if (hosts[hosts.length - 1] !== me.current || !shown) return null;
  const answer = (ok: boolean) => {
    if (requestStore.get()?.id === shown.id) requestStore.set(null);
    if (ok && dontAsk) shown.onDontAsk?.();
    shown.resolve(ok);
  };
  return (
    <Modal title={shown.title} open={open} onOpenChange={(o) => !o && answer(false)}>
      <Modal.Content>
        {shown.message.split("\n\n").map((p, i) => (
          <Text key={i} style={s.modal.text}>
            {p}
          </Text>
        ))}
        {shown.onDontAsk ? (
          <Check s={s.modal} checked={dontAsk} onToggle={() => setDontAsk(!dontAsk)} label="Ne plus demander (réactivable dans les paramètres du plugin)" />
        ) : null}
        <View style={[s.modal.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s.modal} label="Annuler" onPress={() => answer(false)} />
          <Btn s={s.modal} primary icon="Check" label={shown.confirmLabel} onPress={() => answer(true)} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
