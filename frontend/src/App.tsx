import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import CampaignOverview from './pages/CampaignOverview'
import BudgetSimulator from './pages/BudgetSimulator'
import PersonalizationView from './pages/PersonalizationView'
import GeoMapView from './pages/GeoMapView'
import StreamAnalytics from './pages/StreamAnalytics'
import Ontology from './pages/Ontology'
import WebIQ from './pages/WebIQ'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="sidebar">
          <div className="logo">
            <h2>☕ Mybrew</h2>
            <span className="subtitle">CMO Command Center</span>
          </div>
          <ul>
            <li><NavLink to="/">📊 Campaign Overview</NavLink></li>
            <li><NavLink to="/geo">🗺️ Geo Command</NavLink></li>
            <li><NavLink to="/budget">💰 Budget Optimizer</NavLink></li>
            <li><NavLink to="/personalization">🎯 Personalization</NavLink></li>
            <li><NavLink to="/streams">📡 Stream Analytics</NavLink></li>
            <li><NavLink to="/ontology">🧠 Business Context</NavLink></li>
            <li><NavLink to="/webiq">🌐 WW IQ</NavLink></li>
          </ul>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<CampaignOverview />} />
            <Route path="/geo" element={<GeoMapView />} />
            <Route path="/budget" element={<BudgetSimulator />} />
            <Route path="/personalization" element={<PersonalizationView />} />
            <Route path="/streams" element={<StreamAnalytics />} />
            <Route path="/ontology" element={<Ontology />} />
            <Route path="/webiq" element={<WebIQ />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
