import React, { useState, useEffect } from 'react'

export default function Notification({ message, type = 'info', duration = 3000 }){
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), duration)
    return () => clearTimeout(timer)
  }, [duration])

  if (!visible) return null

  const bgColor = {
    success: 'linear-gradient(90deg, rgba(16,185,129,0.2), rgba(5,150,105,0.2))',
    error: 'linear-gradient(90deg, rgba(239,68,68,0.2), rgba(220,38,38,0.2))',
    info: 'linear-gradient(90deg, rgba(59,130,246,0.2), rgba(37,99,235,0.2))',
    warning: 'linear-gradient(90deg, rgba(245,158,11,0.2), rgba(217,119,6,0.2))'
  }

  const borderColor = {
    success: 'rgba(16,185,129,0.4)',
    error: 'rgba(239,68,68,0.4)',
    info: 'rgba(59,130,246,0.4)',
    warning: 'rgba(245,158,11,0.4)'
  }

  return (
    <div style={{
      position: 'fixed',
      top: 20,
      right: 20,
      padding: '12px 16px',
      background: bgColor[type] || bgColor.info,
      border: `1px solid ${borderColor[type] || borderColor.info}`,
      borderRadius: 8,
      color: '#e6eef8',
      zIndex: 2000,
      maxWidth: 300,
      animation: 'slideIn 0.3s ease-out'
    }}>
      {message}
    </div>
  )
}
