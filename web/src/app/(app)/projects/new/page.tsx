import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { SDG_BRANDS } from "@/lib/brands";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    redirect("/projects");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-900">Neues Projekt</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Lade eine fertige HTML-Landingpage hoch. Die App erkennt automatisch
        die editierbaren Farben, Texte und Bilder.
      </p>
      <div className="mt-6">
        <NewProjectForm brands={[...SDG_BRANDS]} />
      </div>
    </div>
  );
}
