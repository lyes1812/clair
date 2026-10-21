"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="linklike"
      onClick={async () => {
        await authClient.signOut();
        router.push("/connexion");
        router.refresh();
      }}
    >
      Se déconnecter
    </button>
  );
}
