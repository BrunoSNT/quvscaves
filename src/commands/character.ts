import { 
    ChatInputCommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    Message,
    MessageComponentInteraction,
    StringSelectMenuInteraction,
    ButtonInteraction,
    MessageActionRowComponentBuilder,
    TextChannel
} from 'discord.js';
import { prisma } from '../lib/prisma';
import { generateStats, getRacialBonuses, calculateHealth, getStartingProficiencies } from '../utils/dice';

const RACES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Orc'];
const CLASSES = ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Paladin'];

export async function handleCreateCharacter(interaction: ChatInputCommandInteraction) {
    try {
        // Get user
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.reply({
                content: 'Please register first using `/register`',
                ephemeral: true
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
                ephemeral: true
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
                        label: race,
                        value: race.toLowerCase(),
                        description: `Choose to be a ${race}`
                    })))
            );

        const raceMsg = await interaction.reply({
            content: `Creating character: **${name}**\nChoose your race:`,
            components: [raceRow],
            ephemeral: true
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
                            label: cls,
                            value: cls.toLowerCase(),
                            description: `Choose to be a ${cls}`
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
                content: `Creating character: **${name}** (${race} ${characterClass})\nHow would you like to determine your stats?`,
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
                                .setDisabled(rerollsLeft <= 0 || !stats[statsOrder[currentStatIndex]])
                        );

                    let currentStatIndex = 0;
                    let rerollsRemaining = 3;
                    let currentRolls: number[] = [];
                    const stats: { [key: string]: number } = {};

                    await statsMethodInteraction.update({
                        content: `Rolling stats for **${name}**...\nClick "Roll Next Stat" to roll 4d6 (drop lowest) for ${statsOrder[0].toUpperCase()}\nYou have ${rerollsRemaining} rerolls available.`,
                        components: [rollStatsRow(rerollsRemaining)]
                    });

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
                                finalStats = stats;
                                await rollInteraction.update({
                                    content: `Stats rolled for **${name}**!\n\n${statsDisplay}\n\nLast Roll: ${rollsDisplay}`,
                                    components: []
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
                    break;
                }
                case 'standard': {
                    const standardArray = [15, 14, 13, 12, 10, 8];
                    const statButtons = statsOrder.map((stat, index) => 
                        new ButtonBuilder()
                            .setCustomId(`assign_${stat}`)
                            .setLabel(stat.toUpperCase())
                            .setStyle(2)
                    );

                    const rows = [];
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
                        // Create 3 rows with 2 stats each (6 stats total)
                        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
                        
                        for (let i = 0; i < statsOrder.length; i += 2) {
                            const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
                            const statButtons: ButtonBuilder[] = [];

                            // Add buttons for first stat in pair
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

                            // Add buttons for second stat in pair (if exists)
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

                        // Add confirm button in a separate row
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
            const proficiencies = getStartingProficiencies(characterClass);

            // Create character
            const character = await prisma.character.create({
                data: {
                    name,
                    race,
                    class: characterClass,
                    strength: statsWithBonuses.strength,
                    dexterity: statsWithBonuses.dexterity,
                    constitution: statsWithBonuses.constitution,
                    intelligence: statsWithBonuses.intelligence,
                    wisdom: statsWithBonuses.wisdom,
                    charisma: statsWithBonuses.charisma,
                    maxHealth,
                    health: maxHealth,
                    proficiencies,
                    languages: racialBonuses.languages,
                    userId: user.id
                }
            });

            // Final response
            const response = [
                `✨ Character created successfully! ✨\n`,
                `**${character.name}** - Level 1 ${character.race} ${character.class}`,
                `\nBase Stats:`,
                `- Strength: ${character.strength}`,
                `- Dexterity: ${character.dexterity}`,
                `- Constitution: ${character.constitution}`,
                `- Intelligence: ${character.intelligence}`,
                `- Wisdom: ${character.wisdom}`,
                `- Charisma: ${character.charisma}`,
                `\nDerived Stats:`,
                `- Max Health: ${character.maxHealth}`,
                `\nProficiencies: ${character.proficiencies.join(', ')}`,
                `Languages: ${character.languages.join(', ')}`
            ];

            // Send a new reply instead of updating the old interaction
            await interaction.editReply({
                content: response.join('\n'),
                components: []
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