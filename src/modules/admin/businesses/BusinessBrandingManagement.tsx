'use client';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';

// U033 — Business Branding admin UI. Global Super Admin only (see actions.ts).
// SF-08: store address / phone / email for printed documents.
// Build 62: logo upload. Build 63: store theme (whole-app colours, light or
// dark), tagline, presets and a live preview.

import { useState, useTransition } from 'react';
import { useDialog } from '@/core/ui/Dialog';
import { updateBusinessBrandingAction } from './actions';
import { THEME_FIELDS, THEME_PRESETS, parseTheme, headerBackground, onAccentHex, type BrandTheme } from '@/core/theme/brandTheme';

type Branding = { primary_color?: string; logo_url?: string; tagline?: string; theme?: unknown };
type Business = { id: string; code: string; legal_name: string; trade_name: string | null; branding: Branding | null; address?: string | null; phone?: string | null; email?: string | null };

const DEFAULT_THEME: BrandTheme = THEME_PRESETS.sky.theme;

function Preview({ t, name, tagline, logo }: { t: BrandTheme; name: string; tagline: string; logo: string | null }) {
  const soft = (c: string, a: string) => `color-mix(in srgb, ${c} ${a}, transparent)`;
  return (
    <div className="overflow-hidden rounded-lg border shadow-sm" style={{ background: t.page, color: t.text, borderColor: t.border }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: headerBackground(t), color: t.headerText }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain" />
        ) : <div className="h-8 w-8 rounded-lg" style={{ background: soft(t.headerText, '20%') }} />}
        <div className="leading-tight">
          <div className="text-sm font-extrabold uppercase tracking-wide">{name}</div>
          <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ opacity: 0.75 }}>{tagline || '5H13 Business Solutions'}</div>
        </div>
      </div>
      <div className="flex">
        <div className="w-24 space-y-1 p-2 text-[10px]" style={{ background: t.header, color: t.headerText, opacity: 0.95 }}>
          <div className="rounded px-1.5 py-1" style={{ background: soft(t.headerText, '15%') }}>Dashboard</div>
          <div className="px-1.5 py-1">Finance</div>
          <div className="px-1.5 py-1">Sales</div>
        </div>
        <div className="flex-1 p-3">
          <div className="rounded-md border p-2 text-[11px]" style={{ background: t.panel, borderColor: t.border }}>
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: t.accent }}>Live preview</div>
            <div className="mb-2 font-semibold">Catalog item</div>
            <div className="mb-2 rounded border px-2 py-1" style={{ borderColor: t.border, background: t.page, opacity: 0.9 }}>Search…</div>
            <div className="flex items-center gap-2">
              <span className="rounded px-2 py-1 text-[10px] font-semibold" style={{ background: t.accent, color: onAccentHex(t) }}>Save</span>
              <span className="rounded border px-2 py-1 text-[10px]" style={{ borderColor: t.border }}>Cancel</span>
              <span className="text-[10px] underline" style={{ color: t.accent }}>A link</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BusinessBrandingManagement({ businesses }: { businesses: Business[] }) {
  const dialog = useDialog();
  const [editing, setEditing] = useState<Business | null>(null);
  const [busy, startTransition] = useTransition();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [themeOn, setThemeOn] = useState(false);
  const [theme, setTheme] = useState<BrandTheme>(DEFAULT_THEME);
  const [tagline, setTagline] = useState('');

  function openEditor(b: Business) {
    const t = parseTheme(b.branding?.theme);
    setEditing(b); setLogoPreview(b.branding?.logo_url || null); setRemoveLogo(false);
    setThemeOn(Boolean(t)); setTheme(t ?? DEFAULT_THEME); setTagline(b.branding?.tagline || '');
  }
  const setColor = (k: keyof BrandTheme, v: string) => setTheme((t) => ({ ...t, [k]: v, preset: 'custom' }));

  function save(fd: FormData) {
    startTransition(async () => {
      try {
        await updateBusinessBrandingAction(fd);
        setEditing(null);
      } catch (e: any) {
        await dialog.alert(errorText(e) || 'Failed to update branding.', { tone: 'danger' });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Business Branding</h1>
        <p className="text-sm text-slate-500">Logo, tagline, contact details (printed on DRs and quotations) and colour theme for each store. The theme colours the whole app for everyone in that business (and for the Super Admin while acting as it).</p>
      </div>

      <div className="overflow-x-auto rounded bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>{['Business', 'Logo', 'Theme', 'Tagline', 'Contact', 'Actions'].map((h) => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {businesses.map((b) => {
              const t = parseTheme(b.branding?.theme);
              return (
                <tr key={b.id} className="border-t">
                  <td className="px-4 py-3"><div className="font-medium">{b.trade_name || b.legal_name}</div><div className="text-xs text-slate-500">{b.code}</div></td>
                  <td className="px-4 py-3">
                    {b.branding?.logo_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={b.branding.logo_url} alt="" className="h-10 w-10 rounded border bg-white object-contain p-0.5" />
                      : <span className="text-slate-400">Not set</span>}
                  </td>
                  <td className="px-4 py-3">
                    {t ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex overflow-hidden rounded border">{[t.header, t.page, t.panel, t.accent].map((c, i) => <span key={i} className="inline-block h-5 w-5" style={{ background: c }} />)}</span>
                        <span className="text-xs text-slate-500">{THEME_PRESETS[t.preset ?? '']?.label ?? 'Custom'} · {t.mode}</span>
                      </span>
                    ) : <span className="text-slate-400">Default</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{b.branding?.tagline || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {b.address || b.phone || b.email ? (
                      <div className="max-w-xs space-y-0.5">
                        {b.address && <div className="whitespace-pre-line">{b.address}</div>}
                        {[b.phone, b.email].filter(Boolean).join(' · ') && <div>{[b.phone, b.email].filter(Boolean).join(' · ')}</div>}
                      </div>
                    ) : <span className="text-slate-400">Not set</span>}
                  </td>
                  <td className="px-4 py-3"><button onClick={() => openEditor(b)} className="rounded border px-2 py-1 text-xs">Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-4xl rounded bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Branding — {editing.trade_name || editing.legal_name}</h2>
            <Form action={(fd) => save(fd)} className="grid gap-6 lg:grid-cols-2">
              <input type="hidden" name="business_id" value={editing.id} />
              <div className="space-y-4">
                <div className="text-sm">
                  <div className="font-medium">Logo</div>
                  <div className="mt-1 flex items-center gap-3">
                    {logoPreview && !removeLogo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={logoPreview} alt="Logo preview" className="h-14 w-14 rounded border bg-white object-contain p-1" />
                      : <div className="flex h-14 w-14 items-center justify-center rounded border text-xs text-slate-400">No logo</div>}
                    <div className="space-y-1">
                      <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-sm"
                        onChange={(e) => { const f = e.target.files?.[0]; setRemoveLogo(false); setLogoPreview(f ? URL.createObjectURL(f) : editing.branding?.logo_url || null); }} />
                      <div className="text-xs text-slate-500">PNG, JPG, WebP or SVG, up to 2 MB. A square image works best.</div>
                      {editing.branding?.logo_url && (
                        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} /> Remove logo</label>
                      )}
                    </div>
                  </div>
                  {removeLogo && <input type="hidden" name="remove_logo" value="true" />}
                </div>

                <label className="block text-sm">Tagline <span className="text-xs text-slate-500">(under the store name, e.g. &quot;Aircon &amp; Refrigeration Parts Trading&quot;)</span>
                  <input name="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} className="input mt-1" />
                </label>

                <fieldset className="space-y-2 rounded border p-3">
                  <legend className="px-1 text-sm font-medium">Contact details <span className="text-xs font-normal text-slate-500">(printed on DRs and quotations)</span></legend>
                  <label className="block text-sm">Address
                    <textarea name="address" defaultValue={editing.address ?? ''} maxLength={300} rows={2} className="input mt-1" placeholder="Street, barangay, city, province" />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-sm">Phone
                      <input name="phone" defaultValue={editing.phone ?? ''} maxLength={80} className="input mt-1" placeholder="e.g. (054) 123 4567 / 0917 123 4567" />
                    </label>
                    <label className="block text-sm">Email
                      <input name="email" type="email" defaultValue={editing.email ?? ''} maxLength={120} className="input mt-1" placeholder="sales@store.ph" />
                    </label>
                  </div>
                </fieldset>

                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={themeOn} onChange={(e) => setThemeOn(e.target.checked)} /> Use a colour theme for this store
                </label>
                {themeOn && <input type="hidden" name="theme_enabled" value="true" />}

                {themeOn && (
                  <div className="space-y-3 rounded border p-3">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(THEME_PRESETS).map(([k, p]) => (
                        <button key={k} type="button" onClick={() => setTheme(p.theme)}
                          className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${theme.preset === k ? 'ring-2 ring-slate-500' : ''}`}>
                          <span className="inline-flex overflow-hidden rounded">{[p.theme.header, p.theme.panel, p.theme.accent].map((c, i) => <span key={i} className="inline-block h-4 w-4" style={{ background: c }} />)}</span>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-medium">Mode</span>
                      {(['light', 'dark'] as const).map((m) => (
                        <label key={m} className="flex items-center gap-1"><input type="radio" checked={theme.mode === m} onChange={() => setTheme((t) => ({ ...t, mode: m, preset: 'custom' }))} /> {m === 'light' ? 'Light' : 'Dark'}</label>
                      ))}
                    </div>
                    <input type="hidden" name="theme_mode" value={theme.mode} />
                    <input type="hidden" name="theme_preset" value={theme.preset ?? 'custom'} />
                    <div className="grid grid-cols-2 gap-2">
                      {THEME_FIELDS.map((f) => (
                        <label key={f.key} className="flex items-center gap-2 text-xs">
                          <input type="color" value={theme[f.key]} onChange={(e) => setColor(f.key, e.target.value)} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0" />
                          <span className="flex-1">{f.label}</span>
                          <input name={`theme_${f.key}`} value={theme[f.key]} onChange={(e) => setColor(f.key, e.target.value)} className="w-20 rounded border px-1 py-0.5 font-mono text-[11px]" />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Preview</div>
                {themeOn
                  ? <Preview t={theme} name={editing.trade_name || editing.legal_name} tagline={tagline} logo={removeLogo ? null : logoPreview} />
                  : <div className="rounded border p-6 text-sm text-slate-500">No theme: the store uses the standard look. Tick “Use a colour theme” to design one.</div>}
                <p className="text-xs text-slate-500">After saving, everyone in this business sees the new theme on their next page load.</p>
              </div>

              <div className="flex justify-end gap-2 lg:col-span-2">
                <button type="button" onClick={() => setEditing(null)} className="rounded border px-3 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={busy} className="button">{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}
