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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/offer" element={<Offer />} />
        <Route path="/arena" element={<Arena />} />
        <Route path="/studio" element={<Studio />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
