# Show de Centavos API — índice de contexto para agentes

Atualizado: 2026-11-17. Validar todos os detalhes contra o código da branch atual.

## Arquitetura
API Node.js/Express + MongoDB/Mongoose. Frontend separado: `joieloliveira/showDeCentavos-app`, branch `feature/frontend-initial`.

## Orientação de leitura
1. `AGENTS.md` para regras de segurança e fluxo.
2. `src/controllers/bidController.js` para autorização de lances, transação e idempotência.
3. `src/models/Bid.js` e `src/models/WalletTransaction.js` para restrições de unicidade e registros.
4. Rotas de leilão, carteira e depósitos: localizar no código atual, não presumir caminhos.
5. Testes de lance, carteira, concorrência, histórico, vitórias, endereço e SSE: localizar e verificar os comandos disponíveis no repositório.
6. `docs/PROJECT_CONTEXT.md` e `docs/DEVELOPMENT_STATUS.md` do frontend para contexto do produto e homologações.

## Ambiente de desenvolvimento conhecido
MongoDB replica set `walletTestRS` na porta 27018, banco `wallet_test_pix`; API na porta 3001. **Manter `AUCTION_BIDDING_ENABLED=false`.** Não executar `rs.initiate()` novamente.

## Continuidade
Este documento é um índice para recuperação documental (RAG leve), não um serviço RAG vetorial. A integração MCP/GitHub permite acessar os arquivos, mas não mantém memória automaticamente. Codex/agentes devem ler este índice, verificar o estado Git e o código, trabalhar com mudanças pequenas, executar testes relevantes e documentar resultados efetivos. Nenhuma permissão de deploy ou de operação financeira é concedida aqui.
