import { useState } from 'react'

export function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: any) => void }) {
  const [query, setQuery] = useState('')
  const commands = [
    { label: 'داشبورد', page: 'dashboard' },
    { label: 'محصولات', page: 'products' },
    { label: 'سفارشات', page: 'orders' },
    { label: 'RFQ', page: 'rfqs' },
    { label: 'موجودی', page: 'inventory' },
    { label: 'مالی', page: 'finance' },
    { label: 'عملکرد', page: 'analytics' },
    { label: 'تنظیمات', page: 'settings' },
  ]
  const filtered = commands.filter(c => c.label.includes(query.trim()))
  return (
    <div style={{position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.35)',display:'flex',justifyContent:'center',paddingTop:'8vh'}} onClick={onClose}>
      <div style={{width:'min(480px,92vw)',background:'#fff',borderRadius:8,overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}} onClick={e => e.stopPropagation()}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="جستجوی سریع"
          autoFocus
          style={{width:'100%',height:48,border:0,borderBottom:'1px solid #ecebe6',padding:'0 16px',fontSize:12,outline:0}}
        />
        <div style={{maxHeight:320,overflowY:'auto'}}>
          {filtered.map(cmd => (
            <button
              key={cmd.page}
              onClick={() => { onNavigate(cmd.page); onClose() }}
              style={{display:'block',width:'100%',padding:'12px 16px',textAlign:'right',fontSize:11.5,background:'none',border:0,cursor:'pointer',borderBottom:'1px solid #f5f5f0'}}
            >
              {cmd.label}
            </button>
          ))}
          {!filtered.length && <div style={{padding:20,textAlign:'center',fontSize:11,color:'#999'}}>نتیجه‌ای یافت نشد.</div>}
        </div>
      </div>
    </div>
  )
}
