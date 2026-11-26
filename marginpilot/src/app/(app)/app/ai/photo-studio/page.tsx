import { requireStore } from "@/lib/auth";
import { PageHeader } from "@/components/ui/app";
import { AiCredits } from "@/components/ai-tools/credits";
import { AI_TOOLS } from "@/config/ai";
import { loadStoreRules } from "@/lib/lister/store";
import { photoroomConfigured, SCENES, SCENE_KEYS } from "@/lib/photo-studio/photoroom";
import { PhotoStudio } from "./studio-client";

export const metadata = { title: "Photo studio" };

export default async function PhotoStudioPage() {
  const ctx = await requireStore();
  const rules = await loadStoreRules(ctx.store.id);
  const scenes = SCENE_KEYS.map((key) => ({ key, label: SCENES[key].label }));
  const credits = AI_TOOLS.photo_studio.credits;

  return (
    <>
      <PageHeader
        title="Photo studio"
        description="Upload one product photo. Get an eBay-ready title, description and item specifics from it, priced at your margin floor, plus clean background versions. Everything is a draft until you create the listing."
      />
      <div className="mb-6">
        <AiCredits orgId={ctx.org.id} tool="photo_studio" perRunNote={`Each AI draft uses ${credits}. Background edits don't use AI credits.`} />
      </div>
      <PhotoStudio rules={rules} photoroomEnabled={photoroomConfigured()} scenes={scenes} credits={credits} />
    </>
  );
}
