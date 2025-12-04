import React, { useState, useEffect } from 'react'

export default function SearchBar({ initial = '', onSearch, placeholder = 'Search by class, teacher, room...' }){
  const [term, setTerm] = useState(initial)

  useEffect(()=>{
    setTerm(initial)
  },[initial])

  const handleSubmit = (e) =>{
    if(e) e.preventDefault()
    onSearch && onSearch(term || '')
  }

  return (
    <form className="searchbar" role="search" onSubmit={handleSubmit} style={{gap:8}}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{opacity:0.9}}>
        <path d="M21 21l-4.35-4.35" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="11" cy="11" r="6" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <input aria-label="Search timetable" value={term} onChange={(e)=>setTerm(e.target.value)} placeholder={placeholder} />
      <button type="submit" className="save-toggle" style={{padding:'6px 10px'}}>Search</button>
    </form>
  )
}
