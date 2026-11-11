# Validação da carteira PIX — integração

Execute somente em ambiente de testes, com credenciais de teste do Mercado Pago e banco MongoDB descartável configurado como replica set (transações exigem replica set).

## Pré-condições
- Branch `feature/wallet-pix-deposits` atualizada e API iniciada.
- Usuário ativo autenticado, com JWT.
- Banco de testes com índices únicos de WalletDeposit e WalletTransaction criados.
- Webhook do Mercado Pago configurado para o ambiente de testes.
- Não usar pagamentos reais para validar estes cenários.

## Cenários

1. **Criação**: `POST /api/wallet/deposits/pix` com `{"amountCents":100}`. Esperado: 201 com depósito pendente e PIX, ou 202 se o resultado remoto for desconhecido. Registrar depositId.
2. **Autorização**: repetir GET/POST reconcile sem token ou com token de outro usuário. Esperado: 401/403 ou 404; nunca expor depósito de outro usuário.
3. **Valores inválidos**: testar 0, 99, 100001, 1.5, string e null. Esperado: 400.
4. **Antes de pagar**: `GET /api/wallet/deposits/:depositId` e `POST /api/wallet/deposits/:depositId/reconcile`. Esperado: nenhum crédito de saldo.
5. **Pagamento aprovado**: confirmar no provedor de testes e reconciliar. Esperado: depósito approved, processedAt, incremento exato de amountCents e uma única WalletTransaction do tipo deposit.
6. **Webhook repetido**: enviar duas notificações assinadas válidas do mesmo evento. Esperado: nenhum segundo crédito nem segunda transação.
7. **Concorrência**: disparar duas reconciliações do mesmo depósito em paralelo após aprovação. Esperado: saldo incrementado uma vez e uma transação.
8. **Timeout na criação**: simular resposta perdida sem repetir POST de criação. Reconciliar o mesmo depositId. Esperado: localizar no máximo uma cobrança por external_reference, sem gerar outra cobrança.
9. **Busca ambígua/paginada**: simular duas cobranças ou resultados incompletos. Esperado: recuperação conservadora sem crédito.
10. **Falha após claim**: provocar erro na criação de WalletTransaction em ambiente isolado. Esperado: rollback da aprovação e do incremento de saldo.

## Verificações no MongoDB Compass

Para o depositId testado:
- `walletdeposits`: exatamente um documento com providerOrderId e providerPaymentId coerentes, status approved apenas após pagamento.
- `wallettransactions`: exatamente um documento com `deposit: ObjectId(depositId)` e `type: "deposit"`.
- `users.wallet.balanceCents`: saldo final = saldo inicial + amountCents, sem duplicação.

## Observações

O teste unitário `npm test` não substitui estes testes. O formato de retorno de `GET /v1/orders` com filtros e paginação ainda deve ser confirmado contra a API real do Mercado Pago. Evite exibir tokens, dados de pagadores ou QR Codes em logs compartilhados.
