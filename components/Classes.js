import React from 'react'

export default function Classes({data}){
  if(!data || data.length===0) return null;
  return (
    <div className="classes">
      {data.map((c, i) => (
        <div className="class-card" key={i}>
          <div><strong>{c.val}</strong></div>
          <div style={{color:'#666',fontSize:'13px'}}>{c.location} • {c.slot}</div>
        </div>
      ))}
    </div>
  )
}
