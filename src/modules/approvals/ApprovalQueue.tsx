'use client';
import { errorText } from '@/core/errors/appError';

import { useState, useTransition } from 'react';
import { useDialog } from '@/core/ui/Dialog';
import { decideApprovalAction, postApprovalAction } from './actions';

export type ApprovalItem = {
  id:string; sourceTable:string; section:string; module:string; number:string; description:string;
  amount?:number|null; status:string; canReview:boolean; canApprove:boolean; canPost:boolean;
};

export function ApprovalQueue({items}:{items:ApprovalItem[]}){
  const dialog = useDialog();
  const [pending,start]=useTransition();
  const [message,setMessage]=useState('');
  const [filter,setFilter]=useState<'all'|'review'|'approve'>('all');
  const [section,setSection]=useState('all');
  const run=(fn:()=>Promise<any>)=>start(async()=>{try{setMessage('');await fn();window.location.reload();}catch(e:any){setMessage(errorText(e)||'Approval action failed.');}});
  const filtered=items.filter(i=>(section==='all'||i.section===section)&&(filter==='all'||(filter==='review'?i.status==='prepared':i.status==='reviewed')));
  const sections=[...new Set(items.map(i=>i.section))];
  const pendingCount=items.filter(i=>i.status==='prepared'||i.status==='reviewed').length;
  return <div className="space-y-5">
    {message&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</div>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      <div className="rounded-xl border bg-white p-3 md:p-4"><div className="text-[11px] uppercase tracking-wide text-slate-500 md:text-xs">Pending decisions</div><div className="mt-1 text-2xl font-bold">{pendingCount}</div></div>
      <div className="rounded-xl border bg-white p-3 md:p-4"><div className="text-[11px] uppercase tracking-wide text-slate-500 md:text-xs">Prepared / review</div><div className="mt-1 text-2xl font-bold">{items.filter(i=>i.status==='prepared').length}</div></div>
      <div className="rounded-xl border bg-white p-3 md:p-4"><div className="text-[11px] uppercase tracking-wide text-slate-500 md:text-xs">Reviewed / approval</div><div className="mt-1 text-2xl font-bold">{items.filter(i=>i.status==='reviewed').length}</div></div>
      <div className="rounded-xl border bg-white p-3 md:p-4"><div className="text-[11px] uppercase tracking-wide text-slate-500 md:text-xs">Modules</div><div className="mt-1 text-2xl font-bold">{sections.length}</div></div>
    </div>
    <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
      <select className="input flex-1 sm:w-auto sm:flex-none" value={filter} onChange={e=>setFilter(e.target.value as any)}><option value="all">All pending</option><option value="review">Needs review</option><option value="approve">Needs approval</option></select>
      <select className="input flex-1 sm:w-auto sm:flex-none" value={section} onChange={e=>setSection(e.target.value)}><option value="all">All sections</option>{sections.map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select>
      <span className="hidden self-center text-xs text-slate-500 sm:inline">Decisions are checked again server-side before they are applied.</span>
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="m-cards min-w-full text-sm" data-m-title={1}>
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Section</th><th className="p-3">Module</th><th className="p-3">Reference</th><th className="p-3">Description</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3">Decision</th></tr></thead>
        <tbody>{filtered.map(i=><tr key={`${i.sourceTable}:${i.id}`} className="border-t align-top">
          <td className="p-3 capitalize">{i.section}</td><td className="p-3 font-medium">{i.module}</td><td className="p-3">{i.number}</td><td className="p-3 max-w-sm">{i.description||'—'}</td><td className="p-3 text-right">{i.amount==null?'—':`₱${Number(i.amount).toLocaleString(undefined,{minimumFractionDigits:2})}`}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{i.status}</span></td>
          <td className="p-3 whitespace-nowrap"><div className="flex flex-wrap gap-1">
            {i.canReview&&<button disabled={pending} className="button-secondary" onClick={()=>run(()=>decideApprovalAction(i.sourceTable,i.id,'review'))}>Review</button>}
            {i.canApprove&&<button disabled={pending} className="button" onClick={()=>run(()=>decideApprovalAction(i.sourceTable,i.id,'approve'))}>Approve</button>}
            {(i.canReview||i.canApprove)&&<button disabled={pending} className="button-secondary" onClick={()=>{dialog.prompt('Reason for return').then(reason=>{if(reason!==null)run(()=>decideApprovalAction(i.sourceTable,i.id,'return',reason));});}}>Return</button>}
            {i.canPost&&<button disabled={pending} className="button" onClick={()=>run(()=>postApprovalAction(i.sourceTable,i.id))}>Post</button>}
          </div></td>
        </tr>)}{filtered.length===0&&<tr><td colSpan={7} className="p-10 text-center text-slate-500">No approval items match the current filters.</td></tr>}</tbody>
      </table>
    </div>
  </div>
}
