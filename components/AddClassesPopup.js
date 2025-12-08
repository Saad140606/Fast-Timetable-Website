import React, { useState, useEffect } from 'react'

export default function AddClassesPopup({ onClose, onSave }){
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState([])

  useEffect(() => {
    try {
      const existing = JSON.parse(localStorage.getItem('tt_saved_classes') || '[]')
      setSaved(Array.isArray(existing) ? existing : [])
    } catch (e) {
      setSaved([])
    }
  }, [])

  const handleAdd = () => {
    if (!input.trim()) return
    const updated = [...saved, input.trim()]
    setSaved(updated)
    localStorage.setItem('tt_saved_classes', JSON.stringify(updated))
    setInput('')
    onSave && onSave()
  }

  const handleRemove = (idx) => {
    const updated = saved.filter((_, i) => i !== idx)
    setSaved(updated)
    localStorage.setItem('tt_saved_classes', JSON.stringify(updated))
    onSave && onSave()
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="panel" style={{ width: '90%', maxWidth: 400, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Add Your Classes</h2>
        <p className="secondary">Save your classes to view only your timetable.</p>
        
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. BCS-3A, COAL, Room 101"
            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: 'var(--glass)',
              border: '1px solid rgba(255,255,255,0.03)',
              borderRadius: 8,
              color: 'inherit',
              fontSize: 14
            }}
          />
          <button
            onClick={handleAdd}
            style={{
              padding: '8px 16px',
              background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
              border: 'none',
              borderRadius: 8,
              color: 'white',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Add
          </button>
        </div>

        {saved.length > 0 && (
          <>
            <h3 className="secondary">Saved Classes</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {saved.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.02)'
                  }}
                >
                  <span>{s}</span>
                  <button
                    onClick={() => handleRemove(i)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ec4899',
                      cursor: 'pointer',
                      fontSize: 16
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'var(--glass)',
              border: '1px solid rgba(255,255,255,0.03)',
              borderRadius: 8,
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
