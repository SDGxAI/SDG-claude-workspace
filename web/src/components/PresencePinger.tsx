"use client";

import { useEffect } from "react";
import { touchPresence } from "@/lib/actions/presence";

/**
 * Meldet regelmäßig „ich bin online" (alle 45 s und beim Zurückkehren in den
 * Tab), damit Admins sehen, wer gerade in der App ist. Rendert nichts.
 */
export function PresencePinger() {
  useEffect(() => {
    const ping = () => {
      void touchPresence();
    };
    ping();
    const id = setInterval(ping, 45_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
