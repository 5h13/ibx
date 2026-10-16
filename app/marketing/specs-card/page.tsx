// Build 122 — 5H13 Specs Card Editor (the owner's tool), under Marketing.
import { requireSection } from '@/core/auth/requireSection';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { MarketingToolFrame } from '@/modules/marketing/MarketingToolFrame';

export default async function SpecsCardPage() {
  const profile = await requireSection('marketing');
  return (
    <AuthedShell profile={profile}>
      <MarketingToolFrame title="Specs Card" src="/marketing-tools/specs-card.html"
        note="Product specs card for the store you are acting as — PNG or animated GIF." minWidth={1000} minHeight={760} />
    </AuthedShell>
  );
}
