export interface Wallet {
    id: string;
    userId: string;
    address: string;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface WalletService {
    linkWallet(userId: string, address: string): Promise<Wallet>;
    getWallet(userId: string): Promise<Wallet | null>;
    updateBalance(userId: string, newBalance: number): Promise<Wallet>;
    unlinkWallet(userId: string): Promise<Wallet>;
}

export interface WalletTransaction {
    id: string;
    walletId: string;
    type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
    amount: number;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    createdAt: Date;
    completedAt?: Date;
} 