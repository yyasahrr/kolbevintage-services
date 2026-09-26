const API='http://127.0.0.1:4000/api/v1'
const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@kolbe.test',password:'Kolbe!TestPassword123'})})
const raw=(r.headers.getSetCookie?.()??[r.headers.get('set-cookie')]).filter(Boolean)[0]
const cookie=String(raw).split(';')[0]
const FULL=encodeURIComponent('پیراهن لینن کانونیکال')
for (const q of [
  `/catalog/products?q=${FULL}&channel=wholesale&limit=20`,
  '/catalog/products?q=%D9%BE%DB%8C%D8%B1%D8%A7%D9%87%D9%86&channel=wholesale&limit=20',
  '/catalog/products?q=%D9%BE%DB%8C%D8%B1%D8%A7%D9%87%D9%86&limit=20',
]) {
  const res=await fetch(`${API}${q}`,{headers:{cookie}})
  const b=await res.json().catch(()=>({}))
  const list=Array.isArray(b)?b:(b.results??b.items??[])
  console.log(q.slice(0,60),'→',res.status,'count=',Array.isArray(list)?list.length:'n/a',JSON.stringify((Array.isArray(list)?list:[]).slice(0,3).map(p=>({id:p.id,name:p.name,status:p.status}))))
}
