// Default config — points to local backend server
// The backend serves demo timetable data that works immediately

const DEFAULT_LOCAL = '/demo-config.json'
const DEFAULT_API = '/api/config'

// Priority: env var -> local API endpoint -> static demo file
const DEFAULT_CONFIG_URL = process.env.NEXT_PUBLIC_CONFIG_URL || DEFAULT_API || DEFAULT_LOCAL

export default {
  configUrl: DEFAULT_CONFIG_URL
}