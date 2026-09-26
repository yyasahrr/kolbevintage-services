import pg from 'pg'
const API='http://127.0.0.1:4000/api/v1'
const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@kolbe.test',password:'Kolbe!TestPassword123'})})
const cookie=String((r.headers.getSetCookie?.()??[r.headers.get('set-cookie')]).filter(Boolean)[0]).split(';')[0]
const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect()
const sub=await c.query("select id,status,approved_product_id from supplier_product_submission where status='approved_existing_product' order by created_at desc limit 1")
const row=sub.rows[0]; console.log('submission:', JSON.stringify(row))
const res=await fetch(`${API}/catalog/supplier-submissions/${row.id}/approve-existing`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({productId:row.approved_product_id})})
console.log('re-approve status:', res.status)
console.log('body:', JSON.stringify(await res.json().catch(()=>({}))).slice(0,300))
await c.end()
