import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createCatalogProductOption,
  createCatalogProductOptionGroup,
  fetchProductOptionGroups,
  productOptionsQueryKey,
  setCatalogProductOptionActive,
  setCatalogProductOptionAvailable,
  setCatalogProductOptionGroupActive,
  updateCatalogProductOption,
  updateCatalogProductOptionGroup,
} from '../../lib/catalog/product-options';
import type { CatalogProductOption } from '../../lib/catalog/product-options';
import { useOnline } from '../../lib/offline/useOnline';
import { GroupCard } from './group-card';
import { GroupEditor } from './group-editor';
import type { GroupFormValues } from './group-editor';
import { OptionEditor } from './option-editor';
import type { OptionFormValues } from './option-editor';

const secondaryButtonClass =
  'min-h-11 rounded-md border border-pedon-navy/25 px-3 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5 disabled:cursor-not-allowed disabled:opacity-60';

interface OptionGroupsPanelProps {
  unitId: string;
  productId: string;
  productName: string;
  canManage: boolean;
  onClose: () => void;
}

export function OptionGroupsPanel({
  unitId,
  productId,
  productName,
  canManage,
  onClose,
}: OptionGroupsPanelProps) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const queryKey = productOptionsQueryKey(unitId, productId);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creatingOptionGroupId, setCreatingOptionGroupId] = useState<string | null>(null);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchProductOptionGroups(unitId, productId),
  });

  async function confirmed(message: string) {
    setFeedback({ type: 'success', message });
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }

  function failed(error: Error) {
    setFeedback({ type: 'error', message: error.message });
  }

  const createGroupMutation = useMutation({
    mutationFn: (values: GroupFormValues) =>
      createCatalogProductOptionGroup(
        unitId,
        productId,
        values.name,
        values.kind,
        values.selection_mode,
        values.min_select,
        values.max_select,
      ),
    onSuccess: async () => {
      setCreatingGroup(false);
      await confirmed('Grupo criado com sucesso.');
    },
    onError: failed,
  });
  const updateGroupMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: GroupFormValues }) =>
      updateCatalogProductOptionGroup(
        id,
        values.name,
        values.kind,
        values.selection_mode,
        values.min_select,
        values.max_select,
      ),
    onSuccess: async () => {
      setEditingGroupId(null);
      await confirmed('Grupo atualizado com sucesso.');
    },
    onError: failed,
  });
  const groupActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCatalogProductOptionGroupActive(id, isActive),
    onSuccess: async (_data, variables) =>
      confirmed(
        variables.isActive ? 'Grupo ativado com sucesso.' : 'Grupo desativado com sucesso.',
      ),
    onError: failed,
  });
  const createOptionMutation = useMutation({
    mutationFn: ({ groupId, values }: { groupId: string; values: OptionFormValues }) =>
      createCatalogProductOption(groupId, values.name, values.price_delta),
    onSuccess: async () => {
      setCreatingOptionGroupId(null);
      await confirmed('Opção criada com sucesso.');
    },
    onError: failed,
  });
  const updateOptionMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: OptionFormValues }) =>
      updateCatalogProductOption(id, values.name, values.price_delta),
    onSuccess: async () => {
      setEditingOptionId(null);
      await confirmed('Opção atualizada com sucesso.');
    },
    onError: failed,
  });
  const optionActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCatalogProductOptionActive(id, isActive),
    onSuccess: async (_data, variables) =>
      confirmed(
        variables.isActive ? 'Opção ativada com sucesso.' : 'Opção desativada com sucesso.',
      ),
    onError: failed,
  });
  const optionAvailableMutation = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      setCatalogProductOptionAvailable(id, isAvailable),
    onSuccess: async (_data, variables) =>
      confirmed(
        variables.isAvailable
          ? 'Opção marcada como disponível.'
          : 'Opção marcada como indisponível.',
      ),
    onError: failed,
  });

  const pending =
    createGroupMutation.isPending ||
    updateGroupMutation.isPending ||
    groupActiveMutation.isPending ||
    createOptionMutation.isPending ||
    updateOptionMutation.isPending ||
    optionActiveMutation.isPending ||
    optionAvailableMutation.isPending;

  const header = (
    <header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
            Opções e adicionais
          </p>
          <h3 className="mt-1 break-words text-lg font-semibold text-pedon-navy">{productName}</h3>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={onClose}>
          Voltar ao catálogo
        </button>
      </div>
      {!online && (
        <p
          role="status"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Você está offline. A edição de grupos e opções está pausada até a conexão ser
          restabelecida.
        </p>
      )}
      {!canManage && (
        <p
          role="note"
          className="mt-3 rounded-md bg-pedon-surface px-3 py-2 text-sm text-pedon-text"
        >
          Como operador, você pode visualizar os grupos e alterar apenas a disponibilidade das
          opções.
        </p>
      )}
    </header>
  );

  if (query.isLoading) {
    return (
      <div className="mt-4 rounded-lg border border-pedon-navy/15 bg-white p-5">
        {header}
        <p
          role="status"
          className="mt-4 rounded-md border border-pedon-navy/10 bg-pedon-surface p-4 text-pedon-text/70"
        >
          Carregando opções do produto…
        </p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mt-4 rounded-lg border border-pedon-navy/15 bg-white p-5">
        {header}
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-red-700"
        >
          <p>Não foi possível carregar as opções: {query.error.message}</p>
          <button
            type="button"
            className={`${secondaryButtonClass} mt-3 border-red-300 text-red-700`}
            onClick={() => void query.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const { groups, options } = query.data ?? { groups: [], options: [] };
  const optionsByGroup = new Map<string, CatalogProductOption[]>();
  for (const option of options) {
    const list = optionsByGroup.get(option.group_id) ?? [];
    list.push(option);
    optionsByGroup.set(option.group_id, list);
  }

  function submitMutation(action: Promise<unknown>) {
    return action.catch(() => {
      // The mutation onError callback has already exposed the confirmed server error.
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-pedon-navy/15 bg-white p-4 sm:p-5">
      {header}

      {feedback !== null && (
        <p
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            feedback.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'
          }`}
        >
          {feedback.message}
        </p>
      )}

      {creatingGroup && (
        <GroupEditor
          submitLabel="Criar grupo"
          onSubmit={(values) =>
            submitMutation(createGroupMutation.mutateAsync(values)).then(() => undefined)
          }
          onCancel={() => setCreatingGroup(false)}
        />
      )}

      {groups.length === 0 ? (
        <section className="mt-4 rounded-lg border border-dashed border-pedon-navy/25 bg-pedon-surface p-6 text-center">
          <h4 className="font-semibold text-pedon-navy">
            Este produto ainda não possui grupos de opções.
          </h4>
          <p className="mt-1 text-sm text-pedon-text/70">
            Crie grupos de variação, adicionais e remoções para configurar este produto.
          </p>
          {canManage && !creatingGroup && (
            <button
              type="button"
              className={`${secondaryButtonClass} mt-4`}
              disabled={!online}
              onClick={() => setCreatingGroup(true)}
            >
              Novo grupo
            </button>
          )}
        </section>
      ) : (
        <div className="mt-4 space-y-4">
          {canManage && !creatingGroup && (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={!online}
              onClick={() => setCreatingGroup(true)}
            >
              Novo grupo
            </button>
          )}
          {groups.map((group) => {
            const groupOptions = optionsByGroup.get(group.id) ?? [];
            const editing = editingGroupId === group.id;
            const creatingOption = creatingOptionGroupId === group.id;
            const editingOption = groupOptions.find((option) => option.id === editingOptionId);

            return (
              <div key={group.id}>
                <GroupCard
                  group={group}
                  options={groupOptions}
                  canManage={canManage}
                  online={online}
                  pending={pending}
                  onEditGroup={() => setEditingGroupId(group.id)}
                  onToggleGroupActive={(isActive) => {
                    if (!isActive && !window.confirm(`Desativar o grupo “${group.name}”?`)) {
                      return;
                    }
                    groupActiveMutation.mutate({ id: group.id, isActive });
                  }}
                  onCreateOption={() => setCreatingOptionGroupId(group.id)}
                  onEditOption={(optionId) => setEditingOptionId(optionId)}
                  onToggleOptionActive={(optionId, isActive) =>
                    optionActiveMutation.mutate({ id: optionId, isActive })
                  }
                  onToggleOptionAvailable={(optionId, isAvailable) =>
                    optionAvailableMutation.mutate({ id: optionId, isAvailable })
                  }
                />

                {editing && (
                  <GroupEditor
                    submitLabel="Salvar grupo"
                    initial={{
                      name: group.name,
                      kind: group.kind,
                      selection_mode: group.selection_mode,
                      min_select: group.min_select,
                      max_select: group.max_select,
                    }}
                    onSubmit={(values) =>
                      submitMutation(
                        updateGroupMutation.mutateAsync({ id: group.id, values }),
                      ).then(() => undefined)
                    }
                    onCancel={() => setEditingGroupId(null)}
                  />
                )}

                {creatingOption && (
                  <OptionEditor
                    submitLabel="Criar opção"
                    kind={group.kind}
                    onSubmit={(values) =>
                      submitMutation(
                        createOptionMutation.mutateAsync({ groupId: group.id, values }),
                      ).then(() => undefined)
                    }
                    onCancel={() => setCreatingOptionGroupId(null)}
                  />
                )}

                {editingOption !== undefined && (
                  <OptionEditor
                    submitLabel="Salvar opção"
                    kind={group.kind}
                    initial={{
                      name: editingOption.name,
                      price_delta: editingOption.price_delta,
                    }}
                    onSubmit={(values) =>
                      submitMutation(
                        updateOptionMutation.mutateAsync({ id: editingOption.id, values }),
                      ).then(() => undefined)
                    }
                    onCancel={() => setEditingOptionId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
