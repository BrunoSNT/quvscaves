import { prisma } from '../../../core/prisma';
import { User, UserService } from '../types';
import { logger } from '../../../shared/logger';

export class DefaultUserService implements UserService {
    async register(
        discordId: string,
        username: string,
        nickname?: string
    ): Promise<User> {
        try {
            const existingUser = await this.getUser(discordId);
            if (existingUser) {
                throw new Error('User already registered');
            }

            const user = await prisma.user.create({
                data: {
                    discordId,
                    username,
                    nickname: nickname || null
                }
            });

            logger.info(`Registered user ${discordId} with username ${username}`);
            return user;
        } catch (error) {
            logger.error('Error registering user:', error);
            throw error;
        }
    }

    async getUser(discordId: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { discordId }
        });
    }

    async updateUser(
        discordId: string,
        updates: Partial<User>
    ): Promise<User> {
        const user = await this.getUser(discordId);
        if (!user) {
            throw new Error('User not found');
        }

        return prisma.user.update({
            where: { discordId },
            data: updates
        });
    }

    async deleteUser(discordId: string): Promise<void> {
        await prisma.user.delete({
            where: { discordId }
        });

        logger.info(`Deleted user ${discordId}`);
    }
} 