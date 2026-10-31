/**
 * Auditoria SOMENTE LEITURA. Não corrige, credita nem debita carteiras.
 * Execute: node scripts/auditWallets.js
 * Requer MONGO_URI apontando para o banco que deseja inspecionar.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import WalletTransaction from '../src/models/WalletTransaction.js';

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI não configurada. Nenhuma conexão foi realizada.');
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    const users = await User.find({}, { role: 1, 'wallet.balanceCents': 1 }).lean();
    let alerts = 0;
    for (const user of users) {
      const transactions = await WalletTransaction.find({ user: user._id })
        .sort({ createdAt: 1, _id: 1 })
        .select('type amountCents balanceAfterCents createdAt')
        .lean();
      const balance = user.wallet?.balanceCents ?? 0;
      const problems = [];
      let prior = null;
      let net = 0;
      for (const tx of transactions) {
        if (!Number.isSafeInteger(tx.amountCents) || !Number.isSafeInteger(tx.balanceAfterCents)) {
          problems.push('movimentação com valores não inteiros');
          continue;
        }
        if (prior !== null && prior + tx.amountCents !== tx.balanceAfterCents) {
          problems.push(`cadeia divergente em ${String(tx._id)}`);
        }
        prior = tx.balanceAfterCents;
        net += tx.amountCents;
      }
      if (!Number.isSafeInteger(balance) || balance < 0) problems.push('saldo atual inválido');
      if (prior !== null && prior !== balance) problems.push('último saldo do histórico diferente do saldo atual');
      const impliedOpening = transactions.length ? transactions[0].balanceAfterCents - transactions[0].amountCents : balance;
      if (impliedOpening !== 0) problems.push(`saldo inicial implícito: ${impliedOpening} centavos (verificar origem)`);
      if (transactions.length === 0 && balance !== 0) problems.push('saldo sem movimentações registradas');
      const status = problems.length ? 'REVISAR' : 'OK';
      if (problems.length) alerts++;
      console.log(JSON.stringify({
        userId: String(user._id), role: user.role, status,
        balanceCents: balance, transactionCount: transactions.length,
        netMovementsCents: net, impliedOpeningCents: impliedOpening,
        observations: problems,
      }));
    }
    console.log(`Auditoria somente leitura: ${users.length} contas, ${alerts} conta(s) para revisão.`);
    if (alerts) process.exitCode = 2;
  } catch (error) {
    console.error('Falha na auditoria:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
