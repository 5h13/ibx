'use client';
// Build 83 (Next.js 16 / React 19): React 19 resets a <form action={fn}> by
// itself when the action's transition ends — also when the save was refused —
// which cleared what the user typed and closed the pop-up (PopupAction closes
// on reset). Every app form uses <Form>, which keeps the earlier behaviour:
// it calls the action with the form's data on submit and leaves resetting to
// the page (each form already resets itself after a successful save).
// Everything else is passed to a plain <form>.
import type { ComponentProps } from 'react';

type Props = Omit<ComponentProps<'form'>, 'action'> & { action?: string | ((formData: FormData) => unknown) };

export function Form({ action, onSubmit, ...rest }: Props) {
  if (typeof action !== 'function') return <form {...rest} action={action} onSubmit={onSubmit} />;
  const submit: NonNullable<Props['onSubmit']> = (e) => {
    onSubmit?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const submitter = ((e.nativeEvent as Event & { submitter?: HTMLElement | null }).submitter) ?? null;
    let fd: FormData;
    try { fd = new FormData(e.currentTarget, submitter ?? undefined); } catch { fd = new FormData(e.currentTarget); }
    void action(fd);
  };
  return <form {...rest} onSubmit={submit} />;
}
