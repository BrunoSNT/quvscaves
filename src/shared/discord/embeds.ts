import { 
    EmbedBuilder, 
    ChatInputCommandInteraction, 
    InteractionReplyOptions,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ColorResolvable,
    BaseGuildTextChannel,
    MessageFlags,
} from 'discord.js';
import { SupportedLanguage } from '../i18n/types';
import { DefaultVoiceService } from '../../features/voice/services/voice';

export interface FormattedResponse {
    channel?: BaseGuildTextChannel;
    title: string;
    description: string;
    color?: ColorResolvable;
    fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
    }>;
    footer?: string;
    thumbnail?: string;
    buttons?: Array<{
        label: string;
        customId: string;
        style?: ButtonStyle;
    }>;
    characterName?: string;
    action?: string;
    response?: string;
    language?: SupportedLanguage;
    voiceType?: 'none' | 'discord' | 'elevenlabs' | 'kokoro' | undefined;
    guild?: any;
    categoryId?: string;
    adventureId?: string;
}

const voiceService = new DefaultVoiceService;

export async function sendFormattedResponse(
    interaction: ChatInputCommandInteraction,
    response: FormattedResponse,
    ephemeral: MessageFlags = MessageFlags.Ephemeral
): Promise<void> {
    const embed = new EmbedBuilder()
        .setTitle(response.title || '🎭 Action')
        .setDescription(response.description || 'No response provided.')
        .setColor(response.color || 0x0099FF);

    if (response.fields) {
        embed.addFields(response.fields);
    }

    if (response.footer) {
        embed.setFooter({ text: response.footer });
    }

    if (response.thumbnail) {
        embed.setThumbnail(response.thumbnail);
    }

    const replyOptions: InteractionReplyOptions = {
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    };

    if (response.buttons) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        response.buttons.forEach(button => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(button.customId)
                    .setLabel(button.label)
                    .setStyle(button.style || ButtonStyle.Primary)
            );
        });
        replyOptions.components = [row];
    }

    if (interaction.replied || interaction.deferred) {
        const { flags, ...editedOptions } = replyOptions;
        await interaction.editReply(editedOptions);
    } else {
        await interaction.reply(replyOptions);
    }
}

export function createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setColor(0xFF0000);
}

export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setColor(0x00FF00);
}

export function createInfoEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description)
        .setColor(0x0099FF);
} 