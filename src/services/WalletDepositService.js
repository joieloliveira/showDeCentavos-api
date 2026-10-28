
import mongoose from "mongoose";

import User from "../models/User.js";
import WalletDeposit from "../models/WalletDeposit.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const processApprovedWalletDeposit = async ({ depositId }) => {
    if (
        typeof depositId !== "string" ||
        !mongoose.isObjectIdOrHexString(depositId)
    ) {
        return {
            processed: false,
            reason: "INVALID_DEPOSIT_ID"
        };
    }

    let session = null;

    try {
        session = await mongoose.startSession();

        let result = {
            processed: false,
        };

        await session.withTransaction(async () => {
            // Somente depósitos pendentes podem ser creditados.
            const deposit = await WalletDeposit.findOneAndUpdate(
                {
                    _id: depositId,
                    status: "pending",
                    processedAt: null,
                    provider: "manual_test",
                },
                {
                    $set: {
                        status: "approved",
                        processedAt: new Date(),
                    },
                },
                {
                    returnDocument: "after",
                    session,
                }
            );

            // Depósito já processado ou não elegível.
            if (!deposit) {
                return;
            }

            if (
                !Number.isSafeInteger(deposit.amountCents) ||
                deposit.amountCents <= 0
            ) {
                throw new Error("Valor de depósito inválido.");
            }

            // Incrementa o saldo atomicamente.
            const user = await User.findOneAndUpdate(
                {
                    _id: deposit.user,
                    isActive: true,
                },
                {
                    $inc: {
                        "wallet.balanceCents": deposit.amountCents,
                    },
                },
                {
                    returnDocument: "after",
                    session,
                }
            );

            if (!user) {
                throw new Error(
                    "Usuário não encontrado ou inativo."
                );
            }

            const balanceAfterCents =
                user.wallet.balanceCents;

            if (!Number.isSafeInteger(balanceAfterCents)) {
                throw new Error(
                    "Saldo resultante inválido."
                );
            }

            // Registra o crédito na mesma transação.
            await WalletTransaction.create(
                [
                    {
                        user: deposit.user,
                        type: "deposit",
                        amountCents: deposit.amountCents,
                        balanceAfterCents,
                        deposit: deposit._id,
                        description:
                            "Crédito referente a depósito na carteira.",
                    },
                ],
                { session }
            );

            result = {
                processed: true,
                depositId: deposit._id,
                balanceAfterCents,
            };
        });

        return result;
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};
