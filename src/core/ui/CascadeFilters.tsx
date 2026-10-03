'use client';
// Build 84 — cascading filter forms. Drop <CascadeFilters /> inside a GET filter
// form; fields marked data-cascade="<level>" re-submit the form when changed, so
// the server narrows the other pick-lists to the current selection. Changing a
// field clears the fields below it (higher level), e.g. a new category clears
// the item and brand. Level 0 = re-submit only, clears nothing.
import { useEffect, useRef } from 'react';

export function CascadeFilters() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    let sent = false;
    const onChange = (e: Event) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      const lvl = el?.dataset?.cascade;
      if (lvl == null || sent) return;
      // typed text inputs: only a pick from the suggestion list (or leaving the field) re-submits
      if (e.type === 'input' && !(el instanceof HTMLInputElement && el.list && (!(e as InputEvent).inputType || (e as InputEvent).inputType === 'insertReplacementText'))) return;
      sent = true;
      const n = Number(lvl);
      if (n > 0) form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-cascade]').forEach((f) => { if (Number(f.dataset.cascade) > n) f.value = ''; });
      form.requestSubmit();
    };
    form.addEventListener('change', onChange);
    form.addEventListener('input', onChange);
    return () => { form.removeEventListener('change', onChange); form.removeEventListener('input', onChange); };
  }, []);
  return <span ref={ref} hidden />;
}
