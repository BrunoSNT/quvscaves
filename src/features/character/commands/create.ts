import {
    ChatInputCommandInteraction,
    MessageFlags,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    StringSelectMenuInteraction,
    ButtonBuilder,
    Message,
    ButtonInteraction,
    MessageActionRowComponentBuilder,
    TextChannel,
} from 'discord.js';
import { DefaultCharacterService } from '../services/character';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { CharacterCreationOptions } from '../types';
import { prisma } from '../../../core/prisma';
import { 
    getRacialBonuses, 
    calculateHealth, 
    getStartingProficiencies, 
    calculateMana, 
    calculateArmorClass, 
    getRaceSpeed 
} from '../../../shared/game/calculations';

const characterService = new DefaultCharacterService();

const CLASSES = [
    { name: 'Warrior', value: 'warrior' },
    { name: 'Mage', value: 'mage' },
    { name: 'Rogue', value: 'rogue' },
    { name: 'Cleric', value: 'cleric' },
    { name: 'Ranger', value: 'ranger' },
    { name: 'Paladin', value: 'paladin' }
];

const RACES = [
    { name: 'Elf', value: 'elf' },
    { name: 'Dwarf', value: 'dwarf' },
    { name: 'Halfling', value: 'halfling' },
    { name: 'Orc', value: 'orc' },
    { name: 'Dragonborn', value: 'dragonborn' }
];

export async function handleCreateCharacter(interaction: ChatInputCommandInteraction) {
    try {
        // Get user
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.reply({
                content: 'Please register first using `/register`',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const name = interaction.options.getString('name', true);

        // Check if name exists
        const existingCharacter = await prisma.character.findFirst({
            where: { userId: user.id, name }
        });

        if (existingCharacter) {
            await interaction.reply({
                content: 'You already have a character with this name. Please try again with a different name.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Step 1: Race selection
        const raceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('race_select')
                    .setPlaceholder('Choose your race')
                    .addOptions(RACES.map(race => ({
                        label: race.name,
                        value: race.value,
                        description: `Choose to be a ${race.name}`
                    })))
            );

        const raceMsg = await interaction.reply({
            content: `Creating character: **${name}**\nChoose your race:`,
            components: [raceRow],
            flags: MessageFlags.Ephemeral
        });

        try {
            const raceInteraction = await raceMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const race = raceInteraction.values[0];

            // Step 2: Class selection
            const classRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('class_select')
                        .setPlaceholder('Choose your class')
                        .addOptions(CLASSES.map(cls => ({
                            label: cls.name,
                            value: cls.value,
                            description: `Choose to be a ${cls.name}`
                        })))
                );

            await raceInteraction.update({
                content: `Creating character: **${name}** (${race})\nChoose your class:`,
                components: [classRow]
            });

            const classInteraction = await raceMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const characterClass = classInteraction.values[0];

            // Step 3: Stats method selection
            const statsRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('roll')
                        .setLabel('Roll Stats')
                        .setStyle(1),
                    new ButtonBuilder()
                        .setCustomId('standard')
                        .setLabel('Standard Array')
                        .setStyle(2),
                    new ButtonBuilder()
                        .setCustomId('point_buy')
                        .setLabel('Point Buy')
                        .setStyle(2)
                );

            await classInteraction.update({
                content: `Creating character: **${name}** (${race} ${CLASSES.find(c => c.value === characterClass)?.name})\nHow would you like to determine your stats?`,
                components: [statsRow]
            });

            const statsMethodInteraction = await raceMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as ButtonInteraction;

            let finalStats: { [key: string]: number } = {};
            const statsOrder = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

            switch (statsMethodInteraction.customId) {
                case 'roll': {
                    // Show rolling interface
                    const rollStatsRow = (rerollsLeft: number) => new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('roll_stat')
                                .setLabel('🎲 Roll Next Stat')
                                .setStyle(1),
                            new ButtonBuilder()
                                .setCustomId('reroll')
                                .setLabel(`↩️ Reroll (${rerollsLeft} left)`)
                                .setStyle(2)
                                .setDisabled(rerollsLeft <= 0)
                        );

                    const confirmationRow = (rerollsLeft: number) => new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('confirm_stats')
                                .setLabel('✅ Confirm Stats')
                                .setStyle(1),
                            new ButtonBuilder()
                                .setCustomId('reroll_last')
                                .setLabel(`↩️ Reroll Last (${rerollsLeft} left)`)
                                .setStyle(2)
                                .setDisabled(rerollsLeft <= 0),
                            new ButtonBuilder()
                                .setCustomId('reroll_all')
                                .setLabel('🎲 Reroll All')
                                .setStyle(2)
                        );

                    let currentStatIndex = 0;
                    let rerollsRemaining = 3;
                    let currentRolls: number[] = [];
                    const stats: { [key: string]: number } = {};
                    let confirmed = false;

                    await statsMethodInteraction.update({
                        content: `Rolling stats for **${name}**...\nClick "Roll Next Stat" to roll 4d6 (drop lowest) for ${statsOrder[0].toUpperCase()}\nYou have ${rerollsRemaining} rerolls available.`,
                        components: [rollStatsRow(rerollsRemaining)]
                    });

                    while (!confirmed) {
                        while (currentStatIndex < statsOrder.length) {
                            const rollInteraction = await raceMsg.awaitMessageComponent({
                                filter: i => i.user.id === interaction.user.id,
                                time: 300000
                            }) as ButtonInteraction;

                            if (rollInteraction.customId === 'roll_stat') {
                                const rolls = Array(4).fill(0).map(() => Math.floor(Math.random() * 6) + 1);
                                rolls.sort((a, b) => b - a);
                                const total = rolls.slice(0, 3).reduce((sum, num) => sum + num, 0);
                                currentRolls = rolls;
                                stats[statsOrder[currentStatIndex]] = total;
                                
                                const rollsDisplay = `[${rolls.join(', ')}] → ${total}`;
                                const statsDisplay = statsOrder.map((stat, index) => {
                                    if (index < currentStatIndex + 1) {
                                        return `${stat.toUpperCase()}: ${stats[stat]}`;
                                    }
                                    return `${stat.toUpperCase()}: -`;
                                }).join('\n');

                                if (currentStatIndex < statsOrder.length - 1) {
                                    await rollInteraction.update({
                                        content: `Rolling stats for **${name}**...\n\n${statsDisplay}\n\nLast Roll: ${rollsDisplay}\n\nClick "Roll Next Stat" for ${statsOrder[currentStatIndex + 1].toUpperCase()}\nRerolls remaining: ${rerollsRemaining}`,
                                        components: [rollStatsRow(rerollsRemaining)]
                                    });
                                } else {
                                    const totalStats = Object.values(stats).reduce((sum, val) => sum + val, 0);
                                    await rollInteraction.update({
                                        content: `Stats rolled for **${name}**!\n\n${statsDisplay}\n\nLast Roll: ${rollsDisplay}\nTotal: ${totalStats}\n\nWould you like to keep these stats or reroll?`,
                                        components: [confirmationRow(rerollsRemaining)]
                                    });
                                }
                                currentStatIndex++;
                            } else if (rollInteraction.customId === 'reroll' && currentStatIndex > 0 && rerollsRemaining > 0) {
                                currentStatIndex--;
                                rerollsRemaining--;
                                await rollInteraction.update({
                                    content: `Rolling stats for **${name}**...\nRerolling ${statsOrder[currentStatIndex].toUpperCase()}\nRerolls remaining: ${rerollsRemaining}`,
                                    components: [rollStatsRow(rerollsRemaining)]
                                });
                            }
                        }

                        // Wait for confirmation or further reroll
                        const confirmInteraction = await raceMsg.awaitMessageComponent({
                            filter: i => i.user.id === interaction.user.id,
                            time: 300000
                        }) as ButtonInteraction;

                        if (confirmInteraction.customId === 'confirm_stats') {
                            finalStats = stats;
                            confirmed = true;
                            await confirmInteraction.update({
                                content: `Stats confirmed for **${name}**!\n\n${statsOrder.map(stat => `${stat.toUpperCase()}: ${stats[stat]}`).join('\n')}`,
                                components: []
                            });
                        } else if (confirmInteraction.customId === 'reroll_last' && rerollsRemaining > 0) {
                            currentStatIndex--;
                            rerollsRemaining--;
                            const rolls = Array(4).fill(0).map(() => Math.floor(Math.random() * 6) + 1);
                            rolls.sort((a, b) => b - a);
                            const total = rolls.slice(0, 3).reduce((sum, num) => sum + num, 0);
                            stats[statsOrder[currentStatIndex]] = total;
                            
                            const rollsDisplay = `[${rolls.join(', ')}] → ${total}`;
                            const statsDisplay = statsOrder.map((stat, index) => {
                                return `${stat.toUpperCase()}: ${stats[stat] || '-'}`;
                            }).join('\n');
                            
                            const allStatsTotal = Object.values(stats).reduce((sum, val) => sum + val, 0);
                            await confirmInteraction.update({
                                content: `Stats rolled for **${name}**!\n\n${statsDisplay}\n\nLast Roll: ${rollsDisplay}\nTotal: ${allStatsTotal}\n\nWould you like to keep these stats or reroll?`,
                                components: [confirmationRow(rerollsRemaining)]
                            });
                            currentStatIndex++;
                        } else if (confirmInteraction.customId === 'reroll_all') {
                            currentStatIndex = 0;
                            rerollsRemaining = 3;
                            Object.keys(stats).forEach(key => delete stats[key]);
                            await confirmInteraction.update({
                                content: `Rolling new stats for **${name}**...\nClick "Roll Next Stat" to roll 4d6 (drop lowest) for ${statsOrder[0].toUpperCase()}\nYou have ${rerollsRemaining} rerolls available.`,
                                components: [rollStatsRow(rerollsRemaining)]
                            });
                        }
                    }
                    break;
                }
                case 'standard': {
                    const standardArray = [15, 14, 13, 12, 10, 8];
                    const statButtons = statsOrder.map((stat) => 
                        new ButtonBuilder()
                            .setCustomId(`assign_${stat}`)
                            .setLabel(stat.toUpperCase())
                            .setStyle(2)
                    );

                    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
                    for (let i = 0; i < statButtons.length; i += 3) {
                        rows.push(
                            new ActionRowBuilder<MessageActionRowComponentBuilder>()
                                .addComponents(statButtons.slice(i, i + 3))
                        );
                    }

                    const stats: { [key: string]: number } = {};
                    const usedValues = new Set<number>();

                    await statsMethodInteraction.update({
                        content: `Assigning Standard Array [${standardArray.join(', ')}] for **${name}**\nClick a stat to assign the next value (${standardArray[0]})`,
                        components: rows
                    });

                    while (usedValues.size < standardArray.length) {
                        const assignInteraction = await raceMsg.awaitMessageComponent({
                            filter: i => i.user.id === interaction.user.id,
                            time: 300000
                        }) as ButtonInteraction;

                        const stat = assignInteraction.customId.replace('assign_', '');
                        if (!stats[stat]) {
                            stats[stat] = standardArray[usedValues.size];
                            usedValues.add(standardArray[usedValues.size]);

                            const statsDisplay = statsOrder.map(stat =>
                                `${stat.toUpperCase()}: ${stats[stat] || '-'}`
                            ).join('\n');

                            if (usedValues.size < standardArray.length) {
                                const nextValue = standardArray[usedValues.size];
                                await assignInteraction.update({
                                    content: `Assigning Standard Array for **${name}**\nNext value to assign: ${nextValue}\n\n${statsDisplay}`,
                                    components: rows
                                });
                            } else {
                                finalStats = stats;
                                await assignInteraction.update({
                                    content: `Stats assigned for **${name}**!\n\n${statsDisplay}`,
                                    components: []
                                });
                            }
                        }
                    }
                    break;
                }
                case 'point_buy': {
                    const costs: Record<number, number> = {
                        8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9
                    };
                    let points = 27;
                    const stats: { [key: string]: number } = {};
                    statsOrder.forEach(stat => stats[stat] = 8);

                    const createStatRows = () => {
                        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
                        
                        for (let i = 0; i < statsOrder.length; i += 2) {
                            const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
                            const statButtons: ButtonBuilder[] = [];

                            // First stat in pair
                            statButtons.push(
                                new ButtonBuilder()
                                    .setCustomId(`${statsOrder[i]}_down`)
                                    .setLabel(`${statsOrder[i].slice(0, 3).toUpperCase()} ➖`)
                                    .setStyle(2)
                                    .setDisabled(stats[statsOrder[i]] <= 8),
                                new ButtonBuilder()
                                    .setCustomId(`${statsOrder[i]}_up`)
                                    .setLabel(`${statsOrder[i].slice(0, 3).toUpperCase()} ➕`)
                                    .setStyle(1)
                                    .setDisabled(stats[statsOrder[i]] >= 15 || points < (costs[stats[statsOrder[i]] + 1] - costs[stats[statsOrder[i]]]))
                            );

                            if (i + 1 < statsOrder.length) {
                                statButtons.push(
                                    new ButtonBuilder()
                                        .setCustomId(`${statsOrder[i + 1]}_down`)
                                        .setLabel(`${statsOrder[i + 1].slice(0, 3).toUpperCase()} ➖`)
                                        .setStyle(2)
                                        .setDisabled(stats[statsOrder[i + 1]] <= 8),
                                    new ButtonBuilder()
                                        .setCustomId(`${statsOrder[i + 1]}_up`)
                                        .setLabel(`${statsOrder[i + 1].slice(0, 3).toUpperCase()} ➕`)
                                        .setStyle(1)
                                        .setDisabled(stats[statsOrder[i + 1]] >= 15 || points < (costs[stats[statsOrder[i + 1]] + 1] - costs[stats[statsOrder[i + 1]]]))
                                );
                            }

                            row.addComponents(statButtons);
                            rows.push(row);
                        }

                        rows.push(
                            new ActionRowBuilder<MessageActionRowComponentBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('confirm_stats')
                                        .setLabel('Confirm Stats')
                                        .setStyle(1)
                                )
                        );

                        return rows;
                    };

                    const updatePointBuyMessage = async (interaction: ButtonInteraction) => {
                        const statsDisplay = statsOrder.map(stat => 
                            `${stat.toUpperCase()}: ${stats[stat]}`
                        ).join('\n');

                        await interaction.update({
                            content: `Point Buy for **${name}**\nPoints remaining: ${points}\n\n${statsDisplay}`,
                            components: createStatRows()
                        });
                    };

                    await statsMethodInteraction.update({
                        content: `Point Buy for **${name}**\nPoints remaining: ${points}\n\nAll stats start at 8\nCosts: 8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9\n\nSTR: ${stats.strength} DEX: ${stats.dexterity} CON: ${stats.constitution}\nINT: ${stats.intelligence} WIS: ${stats.wisdom} CHA: ${stats.charisma}`,
                        components: createStatRows()
                    });

                    while (true) {
                        const pointBuyInteraction = await raceMsg.awaitMessageComponent({
                            filter: i => i.user.id === interaction.user.id,
                            time: 300000
                        }) as ButtonInteraction;

                        if (pointBuyInteraction.customId === 'confirm_stats') {
                            finalStats = stats;
                            const statsDisplay = statsOrder.map(stat => 
                                `${stat.toUpperCase()}: ${stats[stat]}`
                            ).join('\n');
                            await pointBuyInteraction.update({
                                content: `Stats confirmed for **${name}**!\nPoints spent: ${27 - points}\n\n${statsDisplay}`,
                                components: []
                            });
                            break;
                        }

                        const [stat, action] = pointBuyInteraction.customId.split('_');
                        if (action === 'up' && stats[stat] < 15) {
                            const cost = costs[stats[stat] + 1] - costs[stats[stat]];
                            if (points >= cost) {
                                points -= cost;
                                stats[stat]++;
                            }
                        } else if (action === 'down' && stats[stat] > 8) {
                            const refund = costs[stats[stat]] - costs[stats[stat] - 1];
                            points += refund;
                            stats[stat]--;
                        }

                        await updatePointBuyMessage(pointBuyInteraction);
                    }
                    break;
                }
            }

            // Apply racial bonuses
            const racialBonuses = getRacialBonuses(race);
            const statsWithBonuses = {
                strength: finalStats.strength + (racialBonuses.strength || 0),
                dexterity: finalStats.dexterity + (racialBonuses.dexterity || 0),
                constitution: finalStats.constitution + (racialBonuses.constitution || 0),
                intelligence: finalStats.intelligence + (racialBonuses.intelligence || 0),
                wisdom: finalStats.wisdom + (racialBonuses.wisdom || 0),
                charisma: finalStats.charisma + (racialBonuses.charisma || 0)
            };

            // Calculate derived stats
            const maxHealth = calculateHealth(1, statsWithBonuses.constitution, characterClass);
            const maxMana = calculateMana(1, statsWithBonuses.intelligence, statsWithBonuses.wisdom, characterClass);
            const proficiencies = getStartingProficiencies(characterClass);
            const armorClass = calculateArmorClass(statsWithBonuses.dexterity, characterClass);
            const initiative = Math.floor((statsWithBonuses.dexterity - 10) / 2);
            const speed = getRaceSpeed(race);

            // Step 4: Background Information
            const backgroundRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('alignment_select')
                        .setPlaceholder('Choose your alignment')
                        .addOptions([
                            { label: 'Lawful Good', value: 'lawful_good' },
                            { label: 'Neutral Good', value: 'neutral_good' },
                            { label: 'Chaotic Good', value: 'chaotic_good' },
                            { label: 'Lawful Neutral', value: 'lawful_neutral' },
                            { label: 'True Neutral', value: 'true_neutral' },
                            { label: 'Chaotic Neutral', value: 'chaotic_neutral' },
                            { label: 'Lawful Evil', value: 'lawful_evil' },
                            { label: 'Neutral Evil', value: 'neutral_evil' },
                            { label: 'Chaotic Evil', value: 'chaotic_evil' }
                        ])
                );

            await raceMsg.edit({
                content: `Almost done with **${name}**! Choose your alignment:`,
                components: [backgroundRow]
            });

            const alignmentInteraction = await raceMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const alignment = alignmentInteraction.values[0].replace('_', ' ');

            // Prepare stats object
            const stats = {
                strength: statsWithBonuses.strength,
                dexterity: statsWithBonuses.dexterity,
                constitution: statsWithBonuses.constitution,
                intelligence: statsWithBonuses.intelligence,
                wisdom: statsWithBonuses.wisdom,
                charisma: statsWithBonuses.charisma,
            };

            // Create character record in the database.
            // Note: Removed unknown fields (armorClass, initiative, speed, and individual stat fields)
            const character = await prisma.character.create({
                data: {
                    name,
                    race,
                    class: characterClass,
                    level: 1,
                    experience: 0,
                    health: maxHealth,
                    maxHealth,
                    mana: maxMana,
                    maxMana,
                    background: "",
                    stats,
                    proficiencies: getStartingProficiencies(characterClass),
                    languages: racialBonuses.languages,
                    user: { connect: { discordId: user.discordId } },
                }
            });

            // Final response with character summary (alignment is displayed here, even though not stored)
            const response = [
                `\n✨ Character created successfully! ✨\n`,
                `**${character.name}**`,
                `Level ${character.level} ${character.race} ${character.class}\n`,
                `Alignment: ${alignment}\n`,
                `📊 Base Stats: ${Object.entries(stats)
                    .map(([key, value]) => `${key.toUpperCase()}: ${value}`)
                    .join(' | ')}\n`,
                `💫 Derived Stats: Health ${maxHealth}, Mana ${maxMana}\n`,
                `\nYou can set your character's background story using:`,
                `📝 /character_settings`,
            ];

            await interaction.editReply({
                content: response.join('\n'),
                components: [],
            });

        } catch (error) {
            await interaction.editReply({
                content: 'Character creation timed out. Please try again.',
                components: []
            });
        }

    } catch (error) {
        console.error('Error creating character:', error);
        await interaction.editReply({
            content: 'Failed to create character. Please try again.',
            components: []
        });
    }
}

export async function handleCharacterSetting(interaction: ChatInputCommandInteraction) {
    try {
        // Get user
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.reply({
                content: 'Please register first using `/register`',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const characterId = interaction.options.getString('character_id', true);

        // Verify character ownership
        const character = await prisma.character.findFirst({
            where: {
                id: characterId,
                userId: user.id
            }
        });

        if (!character) {
            await interaction.reply({
                content: 'Character not found or you do not have permission to modify it.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Show setting type selection menu
        const settingRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('setting_type')
                    .setPlaceholder('Choose what to edit')
                    .addOptions([
                        { 
                            label: 'Background Story',
                            value: 'background',
                            description: 'Your character\'s history and backstory'
                        },
                        { 
                            label: 'Appearance',
                            value: 'appearance',
                            description: 'How your character looks'
                        },
                        { 
                            label: 'Personality',
                            value: 'personality',
                            description: 'Your character\'s traits and behavior'
                        }
                    ])
            );

        const initialMessage = await interaction.reply({
            content: `Editing **${character.name}** (Level ${character.level} ${character.race} ${character.class})\n\nCurrent settings:\nBackground: ${character.background || '(Not set)'}\nAppearance: ${character.appearance || '(Not set)'}\nPersonality: ${character.personality || '(Not set)'}`,
            components: [settingRow],
            flags: MessageFlags.Ephemeral
        });

        // Wait for setting type selection
        const settingInteraction = await initialMessage.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;

        const settingType = settingInteraction.values[0];
        const settingTypeFormatted = settingType.charAt(0).toUpperCase() + settingType.slice(1);

        // Show text input prompt
        await settingInteraction.update({
            content: `Editing **${settingTypeFormatted}** for ${character.name}\n\nCurrent value:\n${character[settingType as keyof typeof character] || '(Not set)'}\n\nPlease type your new ${settingTypeFormatted.toLowerCase()} below:`,
            components: []
        });

        // Create a message collector for the next message
        const filter = (m: Message) => m.author.id === interaction.user.id;
        const collector = (interaction.channel as TextChannel).createMessageCollector({ filter, time: 300000, max: 1 });

        collector.on('collect', async (m: Message) => {
            // Delete user's message to keep things clean
            await m.delete().catch(() => {});

            // Update the character setting
            const updateData: any = {};
            updateData[settingType] = m.content;

            const updatedCharacter = await prisma.character.update({
                where: { id: characterId },
                data: updateData
            });

            // Show confirmation
            await settingInteraction.editReply({
                content: `✨ ${settingTypeFormatted} updated for **${updatedCharacter.name}**!\n\n${settingTypeFormatted}:\n${m.content}`,
                components: []
            });
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                await settingInteraction.editReply({
                    content: 'Setting update timed out. Please try again.',
                    components: []
                });
            }
        });

    } catch (error) {
        console.error('Error updating character setting:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: 'Failed to update character setting. Please try again.',
                flags: MessageFlags.Ephemeral
            });
        } else {
            await interaction.followUp({
                content: 'Failed to update character setting. Please try again.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

function getModifierString(stat: number): string {
    const modifier = Math.floor((stat - 10) / 2);
    if (modifier === 0) return '';
    return modifier > 0 
        ? `\`\`\`diff\n+${modifier}\n\`\`\``  
        : `\`\`\`diff\n${modifier}\n\`\`\``;
} 