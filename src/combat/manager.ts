import { prisma } from '../lib/prisma';
import { Character } from '../types/game';
import { CombatState, CombatParticipant, CombatAction, StatusEffect, CombatLogEntry } from './types';
import { calculateModifier } from '../utils/dice';
import { logger } from '../utils/logger';

export class CombatManager {
    private state: CombatState;

    constructor(state: CombatState) {
        this.state = state;
    }

    static async initiateCombat(adventureId: string, participants: Character[], npcs: Character[] = []): Promise<CombatManager> {
        // Roll initiative for all participants
        const combatParticipants: CombatParticipant[] = [
            ...participants.map(char => ({
                id: `player_${char.id}`,
                characterId: char.id,
                character: char,
                initiative: CombatManager.rollInitiative(char),
                temporaryEffects: [],
                isNPC: false
            })),
            ...npcs.map(npc => ({
                id: `npc_${npc.id}`,
                characterId: npc.id,
                character: npc,
                initiative: CombatManager.rollInitiative(npc),
                temporaryEffects: [],
                isNPC: true
            }))
        ];

        // Sort by initiative
        combatParticipants.sort((a, b) => b.initiative - a.initiative);

        const state: CombatState = {
            id: `combat_${Date.now()}`,
            adventureId,
            round: 1,
            turnOrder: combatParticipants.map(p => p.id),
            currentTurn: 0,
            status: 'ACTIVE',
            participants: combatParticipants,
            log: []
        };

        return new CombatManager(state);
    }

    private static rollInitiative(character: Character): number {
        const dexMod = calculateModifier(character.dexterity);
        return Math.floor(Math.random() * 20) + 1 + dexMod + character.initiative;
    }

    getCurrentParticipant(): CombatParticipant {
        return this.state.participants.find(p => p.id === this.state.turnOrder[this.state.currentTurn])!;
    }

    async performAction(action: CombatAction, targetId?: string): Promise<void> {
        const actor = this.getCurrentParticipant();
        const target = targetId ? this.state.participants.find(p => p.id === targetId) : undefined;

        switch (action) {
            case 'ATTACK':
                if (!target) throw new Error('Attack requires a target');
                await this.handleAttack(actor, target);
                break;
            case 'DEFEND':
                await this.handleDefend(actor);
                break;
            case 'FLEE':
                await this.handleFlee(actor);
                break;
            // Add more actions as needed
        }

        await this.endTurn();
    }

    private async handleAttack(attacker: CombatParticipant, target: CombatParticipant): Promise<void> {
        const attackRoll = Math.floor(Math.random() * 20) + 1;
        const strMod = calculateModifier(attacker.character.strength);
        
        // Apply any attack modifiers from effects
        const attackModifiers = attacker.temporaryEffects
            .filter(effect => effect.effect.target === 'ATTACK')
            .reduce((sum, effect) => sum + effect.effect.value, 0);

        const totalAttack = attackRoll + strMod + attackModifiers;
        const hits = totalAttack >= target.character.armorClass;

        if (hits) {
            // Calculate damage
            const weaponDamage = Math.floor(Math.random() * 8) + 1; // Assuming d8 weapon
            const damageModifiers = attacker.temporaryEffects
                .filter(effect => effect.effect.target === 'DAMAGE')
                .reduce((sum, effect) => sum + effect.effect.value, 0);

            const totalDamage = weaponDamage + strMod + damageModifiers;

            // Update target's health
            await this.updateCharacterHealth(target.character, -totalDamage);

            this.addLogEntry({
                round: this.state.round,
                turn: this.state.currentTurn,
                actorId: attacker.id,
                targetId: target.id,
                action: 'ATTACK',
                details: `Attack roll: ${totalAttack} vs AC ${target.character.armorClass}`,
                outcome: `Hit for ${totalDamage} damage`,
                timestamp: new Date()
            });
        } else {
            this.addLogEntry({
                round: this.state.round,
                turn: this.state.currentTurn,
                actorId: attacker.id,
                targetId: target.id,
                action: 'ATTACK',
                details: `Attack roll: ${totalAttack} vs AC ${target.character.armorClass}`,
                outcome: 'Miss',
                timestamp: new Date()
            });
        }
    }

    private async handleDefend(defender: CombatParticipant): Promise<void> {
        // Add defensive stance effect
        const defenseEffect: StatusEffect = {
            name: 'Defensive Stance',
            duration: 1,
            effect: {
                type: 'BUFF',
                target: 'AC',
                value: 2
            }
        };

        defender.temporaryEffects.push(defenseEffect);

        this.addLogEntry({
            round: this.state.round,
            turn: this.state.currentTurn,
            actorId: defender.id,
            action: 'DEFEND',
            details: 'Takes defensive stance',
            outcome: '+2 AC until next turn',
            timestamp: new Date()
        });
    }

    private async handleFlee(participant: CombatParticipant): Promise<void> {
        const dexCheck = Math.floor(Math.random() * 20) + 1 + calculateModifier(participant.character.dexterity);
        const success = dexCheck >= 15; // DC 15 to flee

        if (success) {
            this.state.status = 'FLED';
        }

        this.addLogEntry({
            round: this.state.round,
            turn: this.state.currentTurn,
            actorId: participant.id,
            action: 'FLEE',
            details: `Flee attempt (DC 15): ${dexCheck}`,
            outcome: success ? 'Successfully fled' : 'Failed to flee',
            timestamp: new Date()
        });
    }

    private async endTurn(): Promise<void> {
        // Update effects durations
        this.state.participants.forEach(participant => {
            participant.temporaryEffects = participant.temporaryEffects
                .map(effect => ({ ...effect, duration: effect.duration - 1 }))
                .filter(effect => effect.duration > 0);
        });

        // Move to next turn
        this.state.currentTurn++;
        if (this.state.currentTurn >= this.state.turnOrder.length) {
            this.state.currentTurn = 0;
            this.state.round++;
        }

        // Check for combat end conditions
        await this.checkCombatEnd();
    }

    private async checkCombatEnd(): Promise<void> {
        const alivePlayers = this.state.participants
            .filter(p => !p.isNPC && p.character.health > 0);
        const aliveNPCs = this.state.participants
            .filter(p => p.isNPC && p.character.health > 0);

        if (alivePlayers.length === 0 || aliveNPCs.length === 0) {
            this.state.status = 'COMPLETED';
        }
    }

    private async updateCharacterHealth(character: Character, change: number): Promise<void> {
        const newHealth = Math.max(0, Math.min(character.health + change, character.maxHealth));
        
        await prisma.character.update({
            where: { id: character.id },
            data: { health: newHealth }
        });

        character.health = newHealth;
    }

    private addLogEntry(entry: Omit<CombatLogEntry, 'id'>): void {
        this.state.log.push(entry);
    }

    getState(): CombatState {
        return this.state;
    }
} 