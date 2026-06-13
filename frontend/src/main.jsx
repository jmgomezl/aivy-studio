import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './i18n';
import './theme.css';
import './app.css';
import Landing from './pages/Landing.jsx';
import Offer from './pages/Offer.jsx';
import Arena from './pages/Arena.jsx';
import Studio from './pages/Studio.jsx';
import Sell from './pages/Sell.jsx';

// Subdomain-aware roots: arena.kickoff.bot serves the Arena directly,
// studio.aivylabs.xyz serves the Studio directly. Path routes still work
// everywhere (kickoff.bot/arena etc.).
const host = window.location.hostname;
const Root = host.startsWith('arena.') ? Arena : host.startsWith('studio.') ? Studio : Landing;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/offer" element={<Offer />} />
        <Route path="/sell" element={<Sell />} />
        <Route path="/arena" element={<Arena />} />
        <Route path="/studio" element={<Studio />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
