import { SlashCommandBuilder } from 'discord.js';
import { handleAddFriend } from './add';
import { handleRemoveFriend } from './remove';
import { handleAcceptFriend } from './accept';
import { handleListFriends } from './list';

export const socialCommands = [
    new SlashCommandBuilder()
        .setName('add_friend')
        .setDescription('Send a friend request to another player')
        .addUserOption(option =>
            option.setName('user')
            .setDescription('The user to add as friend')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('remove_friend')
        .setDescription('Remove a friend from your friend list')
        .addUserOption(option =>
            option.setName('user')
            .setDescription('The friend to remove')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('accept_friend')
        .setDescription('Accept a friend request')
        .addStringOption(option =>
            option.setName('request_id')
            .setDescription('The friend request ID')
            .setRequired(true)
            .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('list_friends')
        .setDescription('List all your friends'),
    new SlashCommandBuilder()
        .setName('list_friend_requests')
        .setDescription('List all pending friend requests')
];

export {
    handleAddFriend,
    handleRemoveFriend,
    handleAcceptFriend,
    handleListFriends,
}; 