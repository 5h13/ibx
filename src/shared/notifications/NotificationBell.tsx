'use client';
import { useState, useTransition } from 'react';
import { markNotificationReadAction, markAllNotificationsReadAction } from './service';

type Notification = {
  id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell({ notifications, compact = false }: { notifications: Notification[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const unread = notifications.filter(n => !n.read_at);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        className={compact
          ? 'relative flex h-9 w-9 items-center justify-center rounded-full border border-white/40 bg-white/10 text-white'
          : 'relative border border-slate-600 rounded px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500'}
      >
        {compact
          ? <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          : 'Notifications'}
        {unread.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">{unread.length > 9 ? '9+' : unread.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-96 overflow-auto bg-white text-slate-800 rounded-lg shadow-xl border z-50">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-semibold text-sm">Notifications</span>
            {unread.length > 0 && (
              <button disabled={pending} onClick={() => start(() => markAllNotificationsReadAction())} className="text-xs text-blue-600 hover:underline">Mark all read</button>
            )}
          </div>
          {notifications.length === 0 && <div className="p-4 text-sm text-slate-400 text-center">No notifications yet.</div>}
          {notifications.map(n => (
            <a
              key={n.id}
              href={n.action_url || '#'}
              onClick={() => { if (!n.read_at) start(() => markNotificationReadAction(n.id)); }}
              className={`block p-3 border-b text-sm hover:bg-slate-50 ${n.read_at ? 'opacity-60' : ''}`}
            >
              <div className="font-medium">{n.title}</div>
              {n.message && <div className="text-xs text-slate-500 mt-0.5">{n.message}</div>}
              <div className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
