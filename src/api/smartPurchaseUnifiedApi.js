const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
function token(){try{return JSON.parse(localStorage.getItem('dawaa_staff_session')||'null')?.session_token||'';}catch{return '';}}
async function rpc(action,payload={}){
  const t=token(); if(!t) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_unified`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({p_session_token:t,p_action:action,p_payload:payload})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false){
    const m={order_not_found:'الطلبية غير موجودة.',items_without_supplier:'يوجد أصناف معتمدة بدون مورد.',treasury_not_found:'خزنة الفرع غير موجودة.',insufficient_available_balance:'الرصيد المتاح لا يكفي لاعتماد الطلبية.',forbidden:'لا توجد صلاحية لتنفيذ الإجراء.'};
    const e=new Error(m[d?.error]||d?.error||`فشل الطلب (${r.status})`); e.details=d?.data; throw e;
  }
  return d.data;
}
export const smartPurchaseUnifiedApi={
  dashboard:()=>rpc('dashboard'),
  getOrder:(id)=>rpc('get_order',{id}),
  approveAndReserve:(payload)=>rpc('approve_and_reserve',payload),
  releaseReservation:(orderId,newStatus='مسودة')=>rpc('release_reservation',{order_id:orderId,new_status:newStatus}),
  markSent:(orderId)=>rpc('mark_sent',{order_id:orderId}),
};