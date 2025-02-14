export interface User {
    id: string;
    discordId: string;
    username: string;
    nickname?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserService {
    register(discordId: string, username: string, nickname?: string): Promise<User>;
    getUser(discordId: string): Promise<User | null>;
    updateUser(discordId: string, updates: Partial<User>): Promise<User>;
    deleteUser(discordId: string): Promise<void>;
} 