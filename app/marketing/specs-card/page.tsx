// Build 122 — 5H13 Specs Card Editor (the owner's tool), under Marketing.
import { requireSection } from '@/core/auth/requireSection';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { MarketingToolFrame } from '@/modules/marketing/MarketingToolFrame';

export default async function SpecsCardPage() {
  const profile = await requireSection('marketing');
  return (
    <AuthedShell profile={profile}>
      <MarketingToolFrame title="Specs Card" src="/marketing-tools/specs-card.html"
        note="Product specs card per store — PNG or animated GIF. Store logos come from Admin → Businesses → Branding. Work is kept in this browser only." />
    </AuthedShell>
  );
}
