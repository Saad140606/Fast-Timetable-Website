import React from 'react'

export default function Teachers(){
  return (
    <main>
      <div style={{maxWidth:900,margin:'18px auto'}}>
        <div className="panel">
          <h2>Teachers</h2>
          <p className="secondary">A quick directory of teachers could be added here (name, email, subjects). Use a separate sheet to keep the list up to date.</p>
          <ul className="secondary" style={{paddingLeft:18}}>
            <li>No teachers configured yet — add a teachers sheet in the config endpoint.</li>
          </ul>
        </div>
      </div>
    </main>
  )
}
