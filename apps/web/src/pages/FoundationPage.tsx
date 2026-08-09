import { pedonTokens } from '@pedon/ui';

const tokenLabels: Record<string, string> = {
  navy: 'Navy principal',
  orange: 'Laranja principal',
  'orange-secondary': 'Laranja secundário',
  surface: 'Fundo neutro',
  text: 'Texto principal',
};

const tokenEntries = Object.entries(pedonTokens.colors);

export function FoundationPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 md:py-16">
      <header className="mb-8 md:mb-12">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
          Fundação técnica
        </p>
        <h1 className="mt-2 text-3xl font-bold text-pedon-navy md:text-5xl">Ped-On</h1>
        <p className="mt-2 text-lg font-medium text-pedon-text md:text-2xl">
          Gestão de Pedidos Inteligente
        </p>
      </header>

      <section aria-labelledby="estado-titulo">
        <h2 id="estado-titulo" className="text-lg font-semibold text-pedon-navy">
          Projeto em construção
        </h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-pedon-text/80">
          Esta página valida a fundação técnica da aplicação: React, Vite, roteamento, estilos,
          testes, build e PWA. As funcionalidades do MVP serão construídas nas próximas etapas.
        </p>
      </section>

      <section aria-labelledby="tokens-titulo" className="mt-10">
        <h2 id="tokens-titulo" className="text-lg font-semibold text-pedon-navy">
          Tokens de marca
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {tokenEntries.map(([name, hex]) => (
            <li key={name} className="rounded-lg border border-pedon-navy/10 bg-white p-3">
              <div
                className="h-10 rounded-md border border-pedon-navy/10"
                style={{ backgroundColor: hex }}
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-pedon-text">
                {tokenLabels[name] ?? name}
              </p>
              <p className="text-xs text-pedon-text/60">{hex}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-12 border-t border-pedon-navy/10 pt-6">
        <p className="text-sm text-pedon-text/60">
          Ped-On — Gestão de Pedidos Inteligente. Repositório oficial:{' '}
          <a
            className="font-medium text-pedon-orange underline underline-offset-2"
            href="https://github.com/Rodrigo-Kotlin/ped-on"
            target="_blank"
            rel="noreferrer"
          >
            Rodrigo-Kotlin/ped-on
          </a>
        </p>
      </footer>
    </div>
  );
}
