export type AttendanceCalculation = {
  regular_hours: number;
  overtime_hours: number;
  late_minutes: number;
  undertime_minutes: number;
  status: 'present' | 'late' | 'undertime' | 'incomplete';
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function parts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get=(type:string)=>Number(p.find(x=>x.type===type)?.value||0);
  return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute'),second:get('second')};
}
export function localDateFor(date:Date,timeZone:string){const p=parts(date,timeZone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
function offsetMinutes(date:Date,timeZone:string){const name=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'shortOffset'}).formatToParts(date).find(x=>x.type==='timeZoneName')?.value||'GMT';if(name==='GMT'||name==='UTC')return 0;const m=name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);if(!m)return 0;const minutes=Number(m[2])*60+Number(m[3]||0);return m[1]==='+'?minutes:-minutes;}
export function zonedTimeToDate(date:string,time:string,timeZone:string,dayOffset=0){const [y,mo,d]=date.split('-').map(Number);const [h,mi,s=0]=time.split(':').map(Number);const local=new Date(Date.UTC(y,mo-1,d+dayOffset,h,mi,s));let result=new Date(local.getTime()-offsetMinutes(local,timeZone)*60000);result=new Date(local.getTime()-offsetMinutes(result,timeZone)*60000);return result;}
function minutesBetween(a:Date,b:Date){return Math.max(0,(b.getTime()-a.getTime())/60000);}
function roundHours(minutes:number){return Math.round((minutes/60)*100)/100;}

export function calculateAttendance(args:{attendanceDate:string;schedule:any;timeIn:string|null;breakOut:string|null;breakIn:string|null;timeOut:string|null}):AttendanceCalculation{
  const [y,m,d]=args.attendanceDate.split('-').map(Number);const weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();const key=DAY_KEYS[weekday];const s=args.schedule;
  const inTime=s[`${key}_in`];const outTime=s[`${key}_out`];const breakStart=s[`${key}_break_start`];const breakEnd=s[`${key}_break_end`];
  if(!inTime||!outTime)return {regular_hours:0,overtime_hours:0,late_minutes:0,undertime_minutes:0,status:'present'};
  const scheduledIn=zonedTimeToDate(args.attendanceDate,inTime,s.timezone);const crossesMidnight=outTime<=inTime;const scheduledOut=zonedTimeToDate(args.attendanceDate,outTime,s.timezone,crossesMidnight?1:0);
  const scheduledBreakStart=breakStart?zonedTimeToDate(args.attendanceDate,breakStart,s.timezone,breakStart<inTime?1:0):null;const scheduledBreakEnd=breakEnd?zonedTimeToDate(args.attendanceDate,breakEnd,s.timezone,breakEnd<inTime?1:0):null;
  const inDate=args.timeIn?new Date(args.timeIn):null;const outDate=args.timeOut?new Date(args.timeOut):null;const breakOutDate=args.breakOut?new Date(args.breakOut):null;const breakInDate=args.breakIn?new Date(args.breakIn):null;
  const late=inDate?Math.max(0,Math.floor(minutesBetween(scheduledIn,inDate)-Number(s.grace_minutes||0))):0;
  if(!inDate||!outDate)return {regular_hours:0,overtime_hours:0,late_minutes:late,undertime_minutes:0,status:late>0?'late':'incomplete'};
  let workedMinutes=minutesBetween(inDate,outDate);if(breakOutDate&&breakInDate)workedMinutes=Math.max(0,workedMinutes-minutesBetween(breakOutDate,breakInDate));
  const scheduledBreakMinutes=scheduledBreakStart&&scheduledBreakEnd?minutesBetween(scheduledBreakStart,scheduledBreakEnd):0;const scheduledMinutes=Math.max(0,minutesBetween(scheduledIn,scheduledOut)-scheduledBreakMinutes);
  const regularMinutes=Math.min(workedMinutes,scheduledMinutes);const overtimeMinutes=Math.max(0,minutesBetween(scheduledOut,outDate));const undertimeMinutes=Math.max(0,scheduledMinutes-regularMinutes);
  const status:AttendanceCalculation['status']=late>0?'late':undertimeMinutes>0?'undertime':'present';
  return {regular_hours:roundHours(regularMinutes),overtime_hours:roundHours(overtimeMinutes),late_minutes:late,undertime_minutes:Math.round(undertimeMinutes),status};
}
