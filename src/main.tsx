import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './state/store';
import { ToastProvider } from './ui/Toast';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ToastProvider>
  </StrictMode>,
);
