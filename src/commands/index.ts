{
    name: 'character_setting',
    description: 'Update your character\'s background, appearance, or personality',
    options: [
        {
            name: 'character_id',
            description: 'The character to modify',
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true
        },
        {
            name: 'setting_type',
            description: 'Which setting to modify',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'Background Story', value: 'background' },
                { name: 'Appearance', value: 'appearance' },
                { name: 'Personality', value: 'personality' }
            ]
        },
        {
            name: 'value',
            description: 'The new value for the setting',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ]
}, 