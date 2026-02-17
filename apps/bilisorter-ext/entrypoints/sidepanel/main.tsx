import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../popup/App';
import '../popup/App.css';

// Side panel shares the same App component as popup,
// but benefits from full browser height.
document.body.classList.add('sidepanel');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
