import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface StorePoint {
  id: string
  city: string
  store: string
  lat: number
  lng: number
  revenue: number
  transactions: number
  temperature: number
  condition: string
  trigger: string | null
  triggerFired: number
  impressions: number
  campaign: string
}

// Simulated live data - in production this would poll the Eventhouse KQL API
function generateLiveData(): StorePoint[] {
  const base: StorePoint[] = [
    { id: 's1', city: 'London', store: 'Covent Garden', lat: 51.512, lng: -0.124, revenue: 0, transactions: 0, temperature: 3, condition: 'Cold & Rainy', trigger: 'Cold Weather Offer', triggerFired: 0, impressions: 0, campaign: 'Winter Warmth' },
    { id: 's2', city: 'London', store: 'Canary Wharf', lat: 51.505, lng: -0.019, revenue: 0, transactions: 0, temperature: 3, condition: 'Cold & Rainy', trigger: 'Cold Weather Offer', triggerFired: 0, impressions: 0, campaign: 'Winter Warmth' },
    { id: 's3', city: 'London', store: 'Kings Cross', lat: 51.531, lng: -0.124, revenue: 0, transactions: 0, temperature: 4, condition: 'Cold & Cloudy', trigger: 'Cold Weather Offer', triggerFired: 0, impressions: 0, campaign: 'Winter Warmth' },
    { id: 's4', city: 'Manchester', store: 'Piccadilly', lat: 53.477, lng: -2.236, revenue: 0, transactions: 0, temperature: 2, condition: 'Cold & Windy', trigger: 'Cold Weather Offer', triggerFired: 0, impressions: 0, campaign: 'Winter Warmth' },
    { id: 's5', city: 'Manchester', store: 'Spinningfields', lat: 53.480, lng: -2.253, revenue: 0, transactions: 0, temperature: 2, condition: 'Cold & Windy', trigger: 'Cold Weather Offer', triggerFired: 0, impressions: 0, campaign: 'Loyalty Boost' },
    { id: 's6', city: 'Los Angeles', store: 'Santa Monica', lat: 34.019, lng: -118.491, revenue: 0, transactions: 0, temperature: 22, condition: 'Sunny', trigger: null, triggerFired: 0, impressions: 0, campaign: 'Summer Chill' },
    { id: 's7', city: 'Los Angeles', store: 'Hollywood', lat: 34.092, lng: -118.329, revenue: 0, transactions: 0, temperature: 24, condition: 'Sunny', trigger: null, triggerFired: 0, impressions: 0, campaign: 'Summer Chill' },
    { id: 's8', city: 'San Francisco', store: 'Union Square', lat: 37.788, lng: -122.407, revenue: 0, transactions: 0, temperature: 15, condition: 'Foggy', trigger: null, triggerFired: 0, impressions: 0, campaign: 'Loyalty Boost' },
    { id: 's9', city: 'San Francisco', store: 'Mission District', lat: 37.760, lng: -122.419, revenue: 0, transactions: 0, temperature: 16, condition: 'Clear', trigger: 'Tier Nudge', triggerFired: 0, impressions: 0, campaign: 'Win-Back 30d' },
    { id: 's10', city: 'New York', store: 'Times Square', lat: 40.758, lng: -73.985, revenue: 0, transactions: 0, temperature: 8, condition: 'Cloudy', trigger: 'Win-Back 30d', triggerFired: 0, impressions: 0, campaign: 'Loyalty Boost' },
    { id: 's11', city: 'New York', store: 'Brooklyn Heights', lat: 40.696, lng: -73.994, revenue: 0, transactions: 0, temperature: 7, condition: 'Cloudy', trigger: null, triggerFired: 0, impressions: 0, campaign: 'Winter Warmth' },
    { id: 's12', city: 'Edinburgh', store: 'Royal Mile', lat: 55.950, lng: -3.188, revenue: 0, transactions: 0, temperature: 1, condition: 'Freezing', trigger: 'Cold Weather Offer', triggerFired: 0, impressions: 0, campaign: 'Winter Warmth' },
  ]

  return base.map(s => ({
    ...s,
    revenue: Math.round(2000 + Math.random() * 8000),
    transactions: Math.round(40 + Math.random() * 160),
    triggerFired: s.trigger ? Math.round(200 + Math.random() * 3000) : 0,
    impressions: Math.round(5000 + Math.random() * 25000),
  }))
}

function getMarkerColor(point: StorePoint): string {
  if (point.trigger === 'Cold Weather Offer') return '#4ecdc4' // teal - cold trigger active
  if (point.trigger === 'Win-Back 30d') return '#ffd93d' // yellow - win-back
  if (point.trigger === 'Tier Nudge') return '#a78bfa' // purple - tier
  return '#51cf66' // green - normal
}

function getMarkerRadius(point: StorePoint): number {
  return Math.max(8, Math.min(25, point.revenue / 400))
}

function formatCurrency(val: number) {
  if (val >= 1000) return `£${(val / 1000).toFixed(1)}K`
  return `£${val}`
}

function FitBounds({ points }: { points: StorePoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length > 0) {
      const bounds = points.map(p => [p.lat, p.lng] as [number, number])
      map.fitBounds(bounds, { padding: [30, 30] })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function GeoMapView() {
  const [data, setData] = useState<StorePoint[]>(generateLiveData())
  const [lastUpdate, setLastUpdate] = useState(new Date())

  // Simulate live refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setData(generateLiveData())
      setLastUpdate(new Date())
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0)
  const activeTriggers = data.filter(d => d.trigger).length
  const coldCities = data.filter(d => d.temperature <= 5)

  return (
    <div>
      <h1 className="page-title">🗺️ Geo Command Center</h1>
      <p style={{ color: '#888', marginBottom: 16 }}>
        Live store performance overlaid with weather triggers. Updates every 5s.
        <span style={{ color: '#4ecdc4', marginLeft: 12 }}>
          Last update: {lastUpdate.toLocaleTimeString()}
        </span>
      </p>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Live Revenue (all stores)</div>
          <div className="value">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Active Triggers</div>
          <div className="value">{activeTriggers} / {data.length}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Cold Weather Cities</div>
          <div className="value negative">{coldCities.length} stores ❄️</div>
        </div>
        <div className="kpi-card">
          <div className="label">Stores Online</div>
          <div className="value positive">{data.length}</div>
        </div>
      </div>

      <div className="chart-card full-width geo-map-card">
        <MapContainer
          center={[40, -20]}
          zoom={3}
          className="geo-map"
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={data} />
          {data.map(point => (
            <CircleMarker
              key={point.id}
              center={[point.lat, point.lng]}
              radius={getMarkerRadius(point)}
              pathOptions={{
                color: '#0d1026',
                fillColor: getMarkerColor(point),
                fillOpacity: 0.95,
                opacity: 1,
                weight: 3,
              }}
            >
              <Popup className="geo-popup">
                <div className="geo-popup-content">
                  <strong className="geo-popup-title">☕ {point.store}</strong>
                  <br /><span className="geo-popup-city">{point.city}</span>
                  <hr />
                  <table>
                    <tbody>
                      <tr><td>💰 Revenue</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(point.revenue)}</td></tr>
                      <tr><td>🧾 Transactions</td><td style={{ textAlign: 'right' }}>{point.transactions}</td></tr>
                      <tr><td>🌡️ Temperature</td><td style={{ textAlign: 'right' }}>{point.temperature}°C — {point.condition}</td></tr>
                      <tr><td>📢 Impressions</td><td style={{ textAlign: 'right' }}>{point.impressions.toLocaleString()}</td></tr>
                      <tr><td>🎯 Campaign</td><td style={{ textAlign: 'right' }}>{point.campaign}</td></tr>
                    </tbody>
                  </table>
                  {point.trigger && (
                    <div className="geo-popup-trigger">
                      ⚡ <strong>{point.trigger}</strong> — {point.triggerFired.toLocaleString()} fired
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#4ecdc4', marginRight: 6 }}></span>
          Cold Weather Trigger
        </span>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#ffd93d', marginRight: 6 }}></span>
          Win-Back 30d
        </span>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#a78bfa', marginRight: 6 }}></span>
          Tier Nudge
        </span>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#51cf66', marginRight: 6 }}></span>
          No Active Trigger
        </span>
        <span style={{ fontSize: '0.8rem', color: '#888', marginLeft: 'auto' }}>
          Bubble size = revenue
        </span>
      </div>
    </div>
  )
}
