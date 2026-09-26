import pg from 'pg'
const c=new pg.Client({connectionString:process.env.DATABASE_URL})
await c.connect()
const off=await c.query("select id, sku, status, moq, moq_unit, wholesale_price from seller_offer where sku like 'EEXIST%' order by id desc limit 2")
console.log('offers:', JSON.stringify(off.rows))
const o=off.rows[0]
if(o){
  console.log('packages:', JSON.stringify((await c.query('select id,package_type,total_pieces from wholesale_package where offer_id=$1',[o.id])).rows))
  console.log('tiers:', JSON.stringify((await c.query('select id,min_quantity,max_quantity,unit_price from wholesale_pricing_tier where offer_id=$1',[o.id])).rows))
}
const sub=await c.query("select id,status,commercial->>'packageType' as pt, jsonb_typeof(commercial->'packages') as pkgs, jsonb_array_length(commercial->'packages') as npkgs, jsonb_array_length(commercial->'pricingTiers') as ntiers from supplier_product_submission where sku is null order by created_at desc limit 1").catch(e=>({rows:[String(e.message)]}))
console.log('latest submission:', JSON.stringify(sub.rows))
await c.end()
