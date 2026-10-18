import { ThemeProvider, useTheme } from 'next-themes';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

function BrowserTheme() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#1D1D19' : '#F9FAF8');
  }, [resolvedTheme]);
  return null;
}

// biome-ignore lint/style/noNonNullAssertion: #root is guaranteed by index.html
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <BrowserTheme />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
