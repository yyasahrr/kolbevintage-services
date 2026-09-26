import pg from 'pg'
const c=new pg.Client({connectionString:process.env.DATABASE_URL})
await c.connect()
for (const t of ['product_variant_inventory']) {
  const r=await c.query(`select column_name from information_schema.columns where table_name=$1 order by ordinal_position`,[t])
  console.log(t+':', r.rows.map(x=>x.column_name).join(', '))
}
await c.end()
