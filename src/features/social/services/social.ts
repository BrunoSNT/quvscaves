import { prisma } from '../../../core/prisma';
import { Friendship, FriendRequest, SocialService } from '../types';
import { logger } from '../../../shared/logger';
import { FriendshipStatus } from '../../../../prisma/client';

export class DefaultSocialService implements SocialService {
    async sendFriendRequest(userId: string, friendId: string): Promise<Friendship> {
        // Check if request already exists
        const existingRequest = await prisma.friendship.findFirst({
            where: {
                OR: [
                    { userId, friendId },
                    { userId: friendId, friendId: userId }
                ]
            }
        });

        if (existingRequest) {
            throw new Error('Friend request already exists');
        }

        const friendship = await prisma.friendship.create({
            data: {
                userId,
                friendId,
                status: FriendshipStatus.PENDING
            }
        });

        logger.info(`Friend request sent from ${userId} to ${friendId}`);
        return friendship as Friendship;
    }

    async acceptFriendRequest(requestId: string, userId: string): Promise<Friendship> {
        const request = await prisma.friendship.findUnique({
            where: { id: requestId }
        });

        if (!request) {
            throw new Error('Friend request not found');
        }

        if (request.friendId !== userId) {
            throw new Error('Not authorized to accept this request');
        }

        const friendship = await prisma.friendship.update({
            where: { id: requestId },
            data: { status: FriendshipStatus.ACCEPTED }
        });

        logger.info(`Friend request ${requestId} accepted by ${userId}`);
        return friendship as Friendship;
    }

    async rejectFriendRequest(requestId: string, userId: string): Promise<Friendship> {
        const request = await prisma.friendship.findUnique({
            where: { id: requestId }
        });

        if (!request) {
            throw new Error('Friend request not found');
        }

        if (request.friendId !== userId) {
            throw new Error('Not authorized to reject this request');
        }

        const friendship = await prisma.friendship.update({
            where: { id: requestId },
            data: { status: FriendshipStatus.REJECTED }
        });
        logger.info(`Friend request ${requestId} rejected by ${userId}`);
        return friendship as Friendship;
    }

    async removeFriend(userId: string, friendId: string): Promise<void> {
        await prisma.friendship.deleteMany({
            where: {
                OR: [
                    { userId, friendId },
                    { userId: friendId, friendId: userId }
                ],
                status: FriendshipStatus.ACCEPTED
            }
        });

        logger.info(`Friendship removed between ${userId} and ${friendId}`);
    }

    async listFriends(userId: string): Promise<Friendship[]> {
        return prisma.friendship.findMany({
            where: {
                OR: [
                    { userId },
                    { friendId: userId }
                ],
                status: FriendshipStatus.ACCEPTED
            }
        }) as Promise<Friendship[]>;
    }

    async listFriendRequests(userId: string): Promise<FriendRequest[]> {
        const requests = await prisma.friendship.findMany({
            where: {
                friendId: userId,
                status: FriendshipStatus.PENDING
            },
            include: {
                user: {
                    include: {
                        characters: true
                    }
                }
            }
        });

        return requests.map(req => ({
            id: req.id,
            fromUser: {
                id: req.user.id,
                username: req.user.username,
                characters: req.user.characters.map(char => ({
                    id: char.id,
                    name: char.name,
                    class: char.class,
                    level: char.level
                }))
            },
            status: req.status,
            createdAt: req.createdAt
        })) as FriendRequest[];
    }

    async blockUser(userId: string, blockedUserId: string): Promise<Friendship> {
        // Remove any existing friendship
        await this.removeFriend(userId, blockedUserId);

        // Create blocked relationship
        const friendship = await prisma.friendship.create({
            data: {
                userId,
                friendId: blockedUserId,
                status: FriendshipStatus.BLOCKED
            }
        });

        logger.info(`User ${userId} blocked user ${blockedUserId}`);
        return friendship as Friendship;
    }
} 