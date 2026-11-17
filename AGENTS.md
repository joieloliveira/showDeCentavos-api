# Show de Centavos — instruções para agentes (API)

## Antes de trabalhar
- Branch de trabalho: `feature/wallet-pix-deposits`; não alterar `main` sem autorização.
- Leia `docs/PROJECT_CONTEXT.md`, controllers, models, rotas e testes envolvidos. Consulte o frontend irmão `joieloliveira/showDeCentavos-app` (`feature/frontend-initial`) quando necessário.
- Código e testes são fonte de verdade; documentação é um índice de apoio.

## Regras financeiras críticas
- **Nunca ativar `AUCTION_BIDDING_ENABLED=true` sem autorização explícita.**
- Não criar lances financeiros reais, depósitos, débitos ou alterar saldo de usuários como parte de uma demonstração.
- Preservar transações MongoDB, ledger de carteira, índices únicos, idempotência, tratamento de concorrência e rollback.
- Resposta perdida não autoriza novo lance com outra chave; reconciliação deve ser somente leitura (GET).
- Não executar comandos destrutivos de banco, não reconfigurar replica set existente e não fazer deploy por conta própria.
- Não armazenar credenciais, tokens ou segredos na documentação.

## Validação e continuidade
- Testar apenas o escopo modificado, mantendo cenários de concorrência e falha relevantes.
- Distinguir testes executados de testes apenas previstos; nunca inventar aprovação.
- Registrar mudanças e pendências em `docs/PROJECT_CONTEXT.md` e, quando afetar o frontend, em `docs/DEVELOPMENT_STATUS.md` do repositório irmão.
- O usuário executa homologação local e autoriza separadamente qualquer ativação financeira.
