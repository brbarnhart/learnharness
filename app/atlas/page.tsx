import { AtlasView } from "@/components/atlas-view";
import { readAtlas } from "@/src/server";

// Dynamic: every navigation re-reads the atlas. A circuit lesson can append
// records between visits, and this page shows the fold as stored.
export const dynamic = "force-dynamic";

export default function AtlasPage() {
	return <AtlasView atlas={readAtlas()} />;
}
