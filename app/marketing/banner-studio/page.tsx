// Build 122 — Banner Studio (the owner's tool), under Marketing.
import { requireSection } from '@/core/auth/requireSection';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { MarketingToolFrame } from '@/modules/marketing/MarketingToolFrame';

export default async function BannerStudioPage() {
  const profile = await requireSection('marketing');
  return (
    <AuthedShell profile={profile}>
      <MarketingToolFrame title="Banner Studio" src="/marketing-tools/banner-studio.html"
        note="Square and info banners, announcements — PNG or GIF. Store logos come from Admin → Businesses → Branding. Work is kept in this browser only." />
    </AuthedShell>
  );
}
