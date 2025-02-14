import { prisma } from '../../../core/prisma';
import { Wallet, WalletService } from '../types';
import { logger } from '../../../shared/logger';

export class DefaultWalletService implements WalletService {
    async linkWallet(userId: string, address: string): Promise<Wallet> {
        // Check if wallet already exists
        const existingWallet = await prisma.wallet.findUnique({
            where: { userId }
        });

        if (existingWallet) {
            throw new Error('User already has a linked wallet');
        }

        // Validate wallet address format
        if (!this.isValidWalletAddress(address)) {
            throw new Error('Invalid wallet address format');
        }

        const wallet = await prisma.wallet.create({
            data: {
                userId,
                address,
                balance: 0
            }
        });

        logger.info(`Wallet linked for user ${userId}: ${address}`);
        return wallet;
    }

    async getWallet(userId: string): Promise<Wallet | null> {
        return prisma.wallet.findUnique({
            where: { userId }
        });
    }

    async updateBalance(userId: string, newBalance: number): Promise<Wallet> {
        const wallet = await this.getWallet(userId);
        
        if (!wallet) {
            throw new Error('Wallet not found');
        }

        return prisma.wallet.update({
            where: { userId },
            data: { balance: newBalance }
        });
    }

    async unlinkWallet(userId: string): Promise<Wallet> {
        const wallet = await this.getWallet(userId);
        
        if (!wallet) {
            throw new Error('Wallet not found');
        }

        await prisma.wallet.delete({
            where: { userId }
        });

        logger.info(`Wallet unlinked for user ${userId}`);
        return wallet;
    }

    private isValidWalletAddress(address: string): boolean {
        // Basic Solana address validation
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }
} 