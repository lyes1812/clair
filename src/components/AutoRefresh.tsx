"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Rafraîchit la page serveur tant qu'une lecture est en cours.
export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
