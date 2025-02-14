export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';

export interface Friendship {
    id: string;
    userId: string;
    friendId: string;
    status: FriendshipStatus;
    createdAt: Date;
    updatedAt: Date;
    user?: {
        id: string;
        username: string;
        characters: Array<{
            id: string;
            name: string;
            class: string;
            level: number;
        }>;
    };
}

export interface FriendRequest {
    id: string;
    fromUser: {
        id: string;
        username: string;
        characters: Array<{
            id: string;
            name: string;
            class: string;
            level: number;
        }>;
    };
    status: FriendshipStatus;
    createdAt: Date;
}

export interface SocialService {
    sendFriendRequest(userId: string, friendId: string): Promise<Friendship>;
    acceptFriendRequest(requestId: string, userId: string): Promise<Friendship>;
    rejectFriendRequest(requestId: string, userId: string): Promise<Friendship>;
    removeFriend(userId: string, friendId: string): Promise<void>;
    listFriends(userId: string): Promise<Friendship[]>;
    listFriendRequests(userId: string): Promise<FriendRequest[]>;
    blockUser(userId: string, blockedUserId: string): Promise<Friendship>;
} 