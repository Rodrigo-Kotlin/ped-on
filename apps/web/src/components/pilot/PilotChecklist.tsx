import { NavLink } from 'react-router';

interface ChecklistStep {
  href: string;
  title: string;
  description: string;
}

const CHECKLIST_STEPS: ChecklistStep[] = [
  {
    href: '/app/configuracoes',
    title: 'Organização e unidade',
    description: 'Confira o nome da organização e selecione a unidade que participará do piloto.',
  },
  {
    href: '/app/configuracoes',
    title: 'Configuração operacional',
    description:
      'Defina modalidades, valores, tempo de preparo, fuso horário, horários e pagamento.',
  },
  {
    href: '/app/catalogo',
    title: 'Catálogo',
    description: 'Crie categorias e produtos ativos para a unidade.',
  },
  {
    href: '/app/cardapio',
    title: 'Cardápio público',
    description: 'Publique o cardápio e compartilhe o link público.',
  },
  {
    href: '/app/pedidos',
    title: 'Central de pedidos',
    description: 'Acompanhe o status e confirme o primeiro pedido de teste.',
  },
  {
    href: '/app/equipe',
    title: 'Equipe',
    description: 'Vincule gerentes e operadores às unidades de trabalho.',
  },
  {
    href: '/app/clube',
    title: 'Clube Ped-On',
    description: 'Ative o programa de fidelidade (opcional antes do piloto).',
  },
  {
    href: '/app/diagnostico',
    title: 'Diagnóstico',
    description: 'Verifique a saúde técnica e os metadados da aplicação.',
  },
];

export function PilotChecklist() {
  return (
    <section
      aria-labelledby="pilot-checklist-title"
      className="rounded-lg border border-pedon-navy/15 bg-white p-5 shadow-sm"
    >
      <h3 id="pilot-checklist-title" className="font-semibold text-pedon-navy">
        Checklist de implantação
      </h3>
      <p className="mt-1 text-sm text-pedon-text/70">
        Cada etapa é confirmada na própria tela correspondente.
      </p>
      <ol className="mt-4 space-y-2">
        {CHECKLIST_STEPS.map((step, index) => (
          <li key={`${step.title}-${index}`}>
            <NavLink
              to={step.href}
              className="flex min-h-11 items-start gap-3 rounded-md border border-pedon-navy/15 p-3 transition hover:border-pedon-orange"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pedon-navy text-xs font-bold text-white"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-pedon-navy">{step.title}</span>
                <span className="mt-0.5 block text-sm text-pedon-text/70">{step.description}</span>
              </span>
            </NavLink>
          </li>
        ))}
      </ol>
    </section>
  );
}
