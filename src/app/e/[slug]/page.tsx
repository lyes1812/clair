import { redirect } from "next/navigation";
import { DATA_ITEM } from "@/lib/nav";

export default async function WorkspaceHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/e/${slug}/${DATA_ITEM.path}`);
}
