import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAdmin } from '../lib/admin/admin-context';
import {
  createCatalogCategory,
  createCatalogProduct,
  fetchAdminCatalog,
  normalizeCatalogPrice,
  setCatalogCategoryActive,
  setCatalogProductActive,
  setCatalogProductAvailable,
  updateCatalogCategory,
  updateCatalogProduct,
} from '../lib/catalog/catalog';
import type { CatalogCategory, CatalogProduct } from '../lib/catalog/catalog';
import { OptionGroupsPanel } from '../components/catalog/option-groups-panel';

const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome da categoria.')
    .max(80, 'Use no máximo 80 caracteres.'),
});

const productSchema = z.object({
  category_id: z.string().trim().min(1, 'Selecione uma categoria.').max(120, 'Categoria inválida.'),
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome do produto.')
    .max(120, 'Use no máximo 120 caracteres.'),
  description: z.string().trim().max(500, 'Use no máximo 500 caracteres.'),
  price: z.string().transform((value, ctx) => {
    try {
      return normalizeCatalogPrice(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  }),
});

type CategoryFormValues = z.infer<typeof categorySchema>;
type ProductFormValues = z.infer<typeof productSchema>;

const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30';
const secondaryButtonClass =
  'min-h-11 rounded-md border border-pedon-navy/25 px-3 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5 disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass =
  'min-h-11 rounded-md bg-pedon-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60';

interface CategoryFormProps {
  initialName?: string;
  submitLabel: string;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
  onCancel: () => void;
}

function CategoryForm({ initialName = '', submitLabel, onSubmit, onCancel }: CategoryFormProps) {
  const formId = useId();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: initialName },
  });

  return (
    <form
      className="mt-4 rounded-md border border-pedon-orange/30 bg-pedon-surface p-4"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div>
        <label htmlFor={`category-name-${formId}`} className="block text-sm font-medium">
          Nome da categoria
        </label>
        <input
          id={`category-name-${formId}`}
          className={inputClass}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name !== undefined ? `category-name-error-${formId}` : undefined}
          {...register('name')}
        />
        {errors.name !== undefined && (
          <p
            id={`category-name-error-${formId}`}
            role="alert"
            className="mt-1 text-sm text-red-700"
          >
            {errors.name.message}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? 'Salvando…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

interface ProductFormProps {
  categories: CatalogCategory[];
  initialProduct?: CatalogProduct;
  initialCategoryId: string;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  onCancel: () => void;
}

function ProductForm({
  categories,
  initialProduct,
  initialCategoryId,
  submitLabel,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const formId = useId();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      category_id: initialCategoryId,
      name: initialProduct?.name ?? '',
      description: initialProduct?.description ?? '',
      price: initialProduct?.price ?? '',
    },
  });

  return (
    <form
      className="mt-4 rounded-md border border-pedon-orange/30 bg-pedon-surface p-4"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`product-category-${formId}`} className="block text-sm font-medium">
            Categoria
          </label>
          <select
            id={`product-category-${formId}`}
            className={inputClass}
            aria-invalid={errors.category_id !== undefined}
            aria-describedby={
              errors.category_id !== undefined ? `product-category-error-${formId}` : undefined
            }
            {...register('category_id')}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {!category.is_active ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
          {errors.category_id !== undefined && (
            <p
              id={`product-category-error-${formId}`}
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {errors.category_id.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`product-name-${formId}`} className="block text-sm font-medium">
            Nome do produto
          </label>
          <input
            id={`product-name-${formId}`}
            className={inputClass}
            aria-invalid={errors.name !== undefined}
            aria-describedby={
              errors.name !== undefined ? `product-name-error-${formId}` : undefined
            }
            {...register('name')}
          />
          {errors.name !== undefined && (
            <p
              id={`product-name-error-${formId}`}
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {errors.name.message}
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`product-description-${formId}`} className="block text-sm font-medium">
            Descrição (opcional)
          </label>
          <textarea
            id={`product-description-${formId}`}
            rows={3}
            className={inputClass}
            aria-invalid={errors.description !== undefined}
            aria-describedby={
              errors.description !== undefined ? `product-description-error-${formId}` : undefined
            }
            {...register('description')}
          />
          {errors.description !== undefined && (
            <p
              id={`product-description-error-${formId}`}
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {errors.description.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`product-price-${formId}`} className="block text-sm font-medium">
            Preço (R$)
          </label>
          <input
            id={`product-price-${formId}`}
            type="text"
            inputMode="decimal"
            placeholder="29,90"
            className={inputClass}
            aria-invalid={errors.price !== undefined}
            aria-describedby={
              errors.price !== undefined ? `product-price-error-${formId}` : undefined
            }
            {...register('price')}
          />
          {errors.price !== undefined && (
            <p
              id={`product-price-error-${formId}`}
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {errors.price.message}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? 'Salvando…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function formatPrice(price: string): string {
  const [integer = '0', fraction = '00'] = price.split('.');
  return `R$ ${integer},${fraction.padEnd(2, '0')}`;
}

function CatalogForUnit({ unitId, unitName }: { unitId: string; unitName: string }) {
  const { canManageUnit } = useAdmin();
  const queryClient = useQueryClient();
  const queryKey = ['admin-catalog', unitId] as const;
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [creatingProductCategoryId, setCreatingProductCategoryId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [optionsProductId, setOptionsProductId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const catalogQuery = useQuery({
    queryKey,
    queryFn: () => fetchAdminCatalog(unitId),
  });
  const canManageCatalog = catalogQuery.data?.can_manage ?? canManageUnit;

  async function confirmed(message: string) {
    setFeedback({ type: 'success', message });
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }

  function failed(error: Error) {
    setFeedback({ type: 'error', message: error.message });
  }

  async function submitMutation(action: () => Promise<unknown>) {
    try {
      await action();
    } catch {
      // The mutation onError callback has already exposed the confirmed server error.
    }
  }

  const createCategoryMutation = useMutation({
    mutationFn: (values: CategoryFormValues) => createCatalogCategory(unitId, values.name),
    onSuccess: async () => {
      setCreatingCategory(false);
      await confirmed('Categoria criada com sucesso.');
    },
    onError: failed,
  });
  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCatalogCategory(id, name),
    onSuccess: async () => {
      setEditingCategoryId(null);
      await confirmed('Categoria atualizada com sucesso.');
    },
    onError: failed,
  });
  const categoryActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCatalogCategoryActive(id, isActive),
    onSuccess: async (_data, variables) =>
      confirmed(
        variables.isActive ? 'Categoria ativada com sucesso.' : 'Categoria desativada com sucesso.',
      ),
    onError: failed,
  });
  const createProductMutation = useMutation({
    mutationFn: (values: ProductFormValues) =>
      createCatalogProduct(
        unitId,
        values.category_id,
        values.name,
        values.description === '' ? null : values.description,
        values.price,
      ),
    onSuccess: async () => {
      setCreatingProductCategoryId(null);
      await confirmed('Produto criado com sucesso.');
    },
    onError: failed,
  });
  const updateProductMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProductFormValues }) =>
      updateCatalogProduct(
        id,
        values.category_id,
        values.name,
        values.description === '' ? null : values.description,
        values.price,
      ),
    onSuccess: async () => {
      setEditingProductId(null);
      await confirmed('Produto atualizado com sucesso.');
    },
    onError: failed,
  });
  const productActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCatalogProductActive(id, isActive),
    onSuccess: async (_data, variables) =>
      confirmed(
        variables.isActive ? 'Produto ativado com sucesso.' : 'Produto desativado com sucesso.',
      ),
    onError: failed,
  });
  const productAvailableMutation = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      setCatalogProductAvailable(id, isAvailable),
    onSuccess: async (_data, variables) =>
      confirmed(
        variables.isAvailable
          ? 'Produto marcado como disponível.'
          : 'Produto marcado como indisponível.',
      ),
    onError: failed,
  });

  const header = (
    <header>
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">{unitName}</p>
      <h2 className="mt-1 text-2xl font-bold text-pedon-navy">Catálogo</h2>
      <p className="mt-1 text-sm text-pedon-text/70">
        Gerencie as categorias, produtos, variações, adicionais e remoções desta unidade.
      </p>
      <p className="mt-3 rounded-md border border-pedon-orange/20 bg-pedon-surface px-3 py-2 text-sm text-pedon-text/80">
        Este é o catálogo administrativo. A publicação do cardápio será configurada em uma etapa
        posterior.
      </p>
      {!canManageCatalog && (
        <p
          role="note"
          className="mt-3 rounded-md bg-pedon-surface px-3 py-2 text-sm text-pedon-text"
        >
          Como operador, você pode alterar apenas a disponibilidade dos produtos.
        </p>
      )}
    </header>
  );

  if (catalogQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <p
          role="status"
          className="mt-6 rounded-lg border border-pedon-navy/10 bg-white p-5 text-pedon-text/70"
        >
          Carregando catálogo da unidade…
        </p>
      </div>
    );
  }

  if (catalogQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5 text-red-700"
        >
          <p>Não foi possível carregar o catálogo: {catalogQuery.error.message}</p>
          <button
            type="button"
            className={`${secondaryButtonClass} mt-3 border-red-300 text-red-700`}
            onClick={() => void catalogQuery.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const categories = catalogQuery.data?.categories ?? [];

  return (
    <div className="mx-auto max-w-4xl">
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

      {canManageCatalog && (
        <div className="mt-6">
          {!creatingCategory && categories.length > 0 && (
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                setFeedback(null);
                setCreatingCategory(true);
              }}
            >
              Nova categoria
            </button>
          )}
          {creatingCategory && (
            <CategoryForm
              submitLabel="Criar categoria"
              onSubmit={async (values) => {
                await submitMutation(() => createCategoryMutation.mutateAsync(values));
              }}
              onCancel={() => setCreatingCategory(false)}
            />
          )}
        </div>
      )}

      {categories.length === 0 ? (
        <section className="mt-6 rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6 text-center">
          <h3 className="font-semibold text-pedon-navy">Nenhuma categoria cadastrada.</h3>
          <p className="mt-1 text-sm text-pedon-text/70">
            {canManageCatalog
              ? 'Crie a primeira categoria para começar a cadastrar produtos.'
              : 'Ainda não há categorias ou produtos cadastrados nesta unidade.'}
          </p>
          {canManageCatalog && !creatingCategory && (
            <button
              type="button"
              className={`${primaryButtonClass} mt-4`}
              onClick={() => setCreatingCategory(true)}
            >
              Criar primeira categoria
            </button>
          )}
        </section>
      ) : (
        <div className="mt-6 space-y-5">
          {categories.map((category) => (
            <section
              key={category.id}
              aria-labelledby={`category-${category.id}`}
              className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      id={`category-${category.id}`}
                      className="break-words text-lg font-semibold text-pedon-navy"
                    >
                      {category.name}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${
                        category.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {category.is_active ? 'ATIVA' : 'INATIVA'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-pedon-text/60">
                    {category.products.length}{' '}
                    {category.products.length === 1 ? 'produto' : 'produtos'}
                  </p>
                </div>
                {canManageCatalog && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => setEditingCategoryId(category.id)}
                    >
                      Editar categoria
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={categoryActiveMutation.isPending}
                      onClick={() => {
                        const isActive = !category.is_active;
                        if (
                          !isActive &&
                          !window.confirm(`Desativar a categoria “${category.name}”?`)
                        ) {
                          return;
                        }
                        categoryActiveMutation.mutate({ id: category.id, isActive });
                      }}
                    >
                      {category.is_active ? 'Desativar categoria' : 'Ativar categoria'}
                    </button>
                  </div>
                )}
              </div>

              {editingCategoryId === category.id && (
                <CategoryForm
                  initialName={category.name}
                  submitLabel="Salvar categoria"
                  onSubmit={async (values) => {
                    await submitMutation(() =>
                      updateCategoryMutation.mutateAsync({
                        id: category.id,
                        name: values.name,
                      }),
                    );
                  }}
                  onCancel={() => setEditingCategoryId(null)}
                />
              )}

              {canManageCatalog && creatingProductCategoryId !== category.id && (
                <button
                  type="button"
                  className={`${secondaryButtonClass} mt-4`}
                  onClick={() => setCreatingProductCategoryId(category.id)}
                >
                  Novo produto em {category.name}
                </button>
              )}
              {creatingProductCategoryId === category.id && (
                <ProductForm
                  categories={categories}
                  initialCategoryId={category.id}
                  submitLabel="Criar produto"
                  onSubmit={async (values) => {
                    await submitMutation(() => createProductMutation.mutateAsync(values));
                  }}
                  onCancel={() => setCreatingProductCategoryId(null)}
                />
              )}

              {category.products.length === 0 ? (
                <p className="mt-4 rounded-md bg-pedon-surface px-3 py-4 text-sm text-pedon-text/70">
                  Nenhum produto nesta categoria.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {category.products.map((product) => (
                    <li
                      key={product.id}
                      className="min-w-0 rounded-lg border border-pedon-navy/10 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="break-words font-semibold text-pedon-navy">
                            {product.name}
                          </h4>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold ${
                                product.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {product.is_active ? 'ATIVO' : 'INATIVO'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold ${
                                product.is_available
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {product.is_available ? 'DISPONÍVEL' : 'INDISPONÍVEL'}
                            </span>
                          </div>
                        </div>
                        <p className="shrink-0 font-semibold text-pedon-text">
                          {formatPrice(product.price)}
                        </p>
                      </div>
                      {product.description !== null && product.description !== '' && (
                        <p className="mt-2 break-words text-sm text-pedon-text/70">
                          {product.description}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={() => setOptionsProductId(product.id)}
                        >
                          Opções e adicionais
                          <span className="sr-only">: {product.name}</span>
                        </button>
                        {canManageCatalog && (
                          <>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() => setEditingProductId(product.id)}
                            >
                              Editar {product.name}
                            </button>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              disabled={productActiveMutation.isPending}
                              onClick={() => {
                                const isActive = !product.is_active;
                                if (
                                  !isActive &&
                                  !window.confirm(`Desativar o produto “${product.name}”?`)
                                ) {
                                  return;
                                }
                                productActiveMutation.mutate({ id: product.id, isActive });
                              }}
                            >
                              {product.is_active ? 'Desativar produto' : 'Ativar produto'}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          disabled={productAvailableMutation.isPending}
                          onClick={() =>
                            productAvailableMutation.mutate({
                              id: product.id,
                              isAvailable: !product.is_available,
                            })
                          }
                        >
                          {product.is_available
                            ? 'Marcar como indisponível'
                            : 'Marcar como disponível'}
                          <span className="sr-only">: {product.name}</span>
                        </button>
                      </div>

                      {editingProductId === product.id && (
                        <ProductForm
                          categories={categories}
                          initialProduct={product}
                          initialCategoryId={category.id}
                          submitLabel="Salvar produto"
                          onSubmit={async (values) => {
                            await submitMutation(() =>
                              updateProductMutation.mutateAsync({ id: product.id, values }),
                            );
                          }}
                          onCancel={() => setEditingProductId(null)}
                        />
                      )}

                      {optionsProductId === product.id && (
                        <OptionGroupsPanel
                          unitId={unitId}
                          productId={product.id}
                          productName={product.name}
                          canManage={canManageCatalog}
                          onClose={() => setOptionsProductId(null)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function CatalogoPage() {
  const { selectedUnit } = useAdmin();

  if (selectedUnit === null) {
    return (
      <section className="mx-auto max-w-4xl rounded-lg border border-dashed border-pedon-navy/25 bg-white p-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">Catálogo</p>
        <h2 className="mt-1 text-xl font-bold text-pedon-navy">Nenhuma unidade selecionada</h2>
        <p className="mt-1 text-sm text-pedon-text/70">
          Cadastre ou selecione uma unidade para visualizar o catálogo.
        </p>
      </section>
    );
  }

  return (
    <CatalogForUnit key={selectedUnit.id} unitId={selectedUnit.id} unitName={selectedUnit.name} />
  );
}
