// Shared UI-test driver for the two native hour/minute selects.
exports.clockField = (scope, name) => {
    const actual = name.startsWith('Actual '), label = name.replace(/ time \(local\)$/, '');
    const group = scope.getByRole('group', { name: label, exact: true });
    const hour = group.getByLabel(`${label} hour`, { exact: true });
    const minute = group.getByLabel(`${label} minute`, { exact: true });
    return {
        async selectOption(value) {
            if (!value) { await hour.selectOption(''); return ['']; }
            const nextHour = actual ? String(new Date(Number(value)).getHours()).padStart(2, '0') : value.split(':')[0];
            if (await hour.inputValue() !== nextHour) await hour.selectOption(nextHour);
            await minute.selectOption(actual ? value : value.split(':')[1]);
            return [value];
        },
        async inputValue() {
            if (actual) return minute.inputValue();
            const h = await hour.inputValue(), m = await minute.inputValue(); return h && m ? `${h}:${m}` : '';
        },
        isEnabled: () => hour.isEnabled(), count: () => group.count(), focus: () => minute.focus(),
        locator: selector => group.locator(selector),
    };
};
