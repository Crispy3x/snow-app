"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

export async function setCurrentStore(formData: FormData) {
  const user = await requireUser();
  const storeId = String(formData.get("storeId") ?? "");
  const supabase = await createClient();
  // RLS: the select only returns stores in the user's orgs.
  const { data: store } = await supabase.from("ebay_stores").select("id").eq("id", storeId).maybeSingle();
  if (store) await supabase.from("profiles").update({ current_store_id: store.id }).eq("id", user.id);
  revalidatePath("/app", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
