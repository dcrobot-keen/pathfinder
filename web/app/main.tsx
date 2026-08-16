import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { WizardPage } from './pages/WizardPage';
import { PipelinePage } from './pages/PipelinePage';
import { ReportPage } from './pages/ReportPage';

function App() {
  return (
    <BrowserRouter basename="/app.html">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/new" element={<WizardPage />} />
        <Route path="/projects/:name/pipeline" element={<PipelinePage />} />
        <Route path="/projects/:name/report" element={<ReportPage />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
