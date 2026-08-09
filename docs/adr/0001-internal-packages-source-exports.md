# ADR-0001 — Pacotes internos consumidos via source exports

- **Status:** Aceito
- **Data:** 2026-08-09
- **Decisão:** DEC-036

## Contexto

O monorepo Ped-On define pacotes internos (`@pedon/ui`, `@pedon/test-utils`) consumidos pela
aplicação `apps/web`. Havia duas opções de distribuição:

1. **Build intermediário (`dist`):** cada pacote compila com `tsc` para `dist/` e o consumidor
   importa a saída. Exige ordem de build (topológica), recompilação após mudanças e arquivos
   gerados no Git/não-versionados.
2. **Source exports:** o campo `exports` do `package.json` aponta diretamente para
   `./src/index.{ts,tsx}`. Vite, Vitest e TypeScript (`moduleResolution: bundler`) resolvem a
   fonte sem passo de build intermediário.

## Decisão

Adotar **source exports** para pacotes internos privados desta etapa:

```json
{
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  }
}
```

Regras associadas:

- Pacotes internos são `private: true` e nunca publicados no npm.
- A aplicação web (única consumidora nesta fase) executa via Vite/Vitest, que suportam `.ts`.
- `tsc` continua sendo o gate de typecheck de cada pacote (`tsc --noEmit`).
- Quando um pacote precisar ser publicado ou consumido fora do ecossistema Vite, migrar para
  build `dist` com avaliação de impacto.

## Consequências

- Sem ordem de build entre pacotes; `pnpm -r build` produz apenas a aplicação web.
- Mudanças em pacotes internos são refletidas imediatamente (sem recompilar).
- Restrição: não aplicável a publicação externa (pacotes não são distribuídos).
