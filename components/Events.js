import React from 'react'

export default function Events(){
  return (
    <main>
      <div style={{maxWidth:900,margin:'18px auto'}}>
        <div className="panel">
          <h2>Events</h2>
          <p className="secondary">Upcoming events will appear here. Connect your event source (Google Sheets or API) and the list will update in real time.</p>
          <ul className="secondary" style={{paddingLeft:18}}>
            <li>No events configured yet — add your event sheet in the config endpoint.</li>
          </ul>
        </div>
      </div>
    </main>
  )
}
