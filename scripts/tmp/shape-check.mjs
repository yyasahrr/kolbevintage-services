const API='http://127.0.0.1:4000/api/v1'
const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@kolbe.test',password:'Kolbe!TestPassword123'})})
const cookie=String((r.headers.getSetCookie?.()??[r.headers.get('set-cookie')]).filter(Boolean)[0]).split(';')[0]
const res=await fetch(`${API}/catalog/products?q=${encodeURIComponent('پیراهن لینن کانونیکال')}&channel=wholesale&limit=20`,{headers:{cookie}})
const b=await res.json()
console.log('isArray:', Array.isArray(b))
console.log('top-level keys:', Array.isArray(b)?'(array)':Object.keys(b))
console.log(JSON.stringify(b).slice(0,300))
