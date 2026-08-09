import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-start px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Erro 404</p>
      <h1 className="mt-2 text-2xl font-bold text-pedon-navy md:text-4xl">Página não encontrada</h1>
      <p className="mt-3 max-w-xl leading-relaxed text-pedon-text/80">
        A rota acessada não existe no Ped-On.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center rounded-md bg-pedon-navy px-4 py-2 font-medium text-white"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
