import { Outlet } from 'react-router';

export function App() {
  return (
    <div className="flex min-h-svh flex-col bg-pedon-surface text-pedon-text">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-pedon-navy focus:px-4 focus:py-2 focus:font-medium focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <main id="conteudo" className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
